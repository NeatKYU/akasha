import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  classifyError,
  estimateCost,
  parseCodexJsonl,
  scoreText,
} from 'file:///Users/sun/dev/client/agent-knowledge-base/scripts/model-routing-lib.mjs';

const root = process.argv[2];
if (!root) throw new Error('usage: node run-codex-ab.mjs ROOT [START_INDEX]');
const startAt = Number(process.argv[3] ?? 1);
const repetitions = 3;
const model = 'gpt-5.6-terra';
const effort = 'medium';
const tasks = JSON.parse(await readFile(path.join(root, 'B/benchmarks/model-routing/tasks.json'), 'utf8'));
const configs = JSON.parse(await readFile(path.join(root, 'B/benchmarks/model-routing/configs.json'), 'utf8'));
const taskConfig = {
  r2: {
    expectedRoles: ['design', 'frontend'],
    qualityTask: tasks.find((item) => item.id === 'l2-dialog-review'),
  },
  r3: {
    expectedRoles: ['backend', 'data', 'platform', 'qa', 'security'],
    qualityTask: tasks.find((item) => item.id === 'l3-cross-layer-review'),
  },
};
const runsRoot = path.join(root, 'artifacts/runs');
await mkdir(runsRoot, { recursive: true });

function runCommand(command, args, cwd, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputExceeded = false;
    const appendBounded = (current, chunk) => {
      const next = current + chunk;
      if (Buffer.byteLength(next) <= 8_000_000) return next;
      outputExceeded = true;
      child.kill('SIGTERM');
      return next.slice(0, 8_000_000);
    };
    child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
        outputExceeded,
        wallMs: Date.now() - started,
      });
    });
  });
}

async function prepareFixture(condition, taskId, runId) {
  const fixtureSource = path.join(root, 'B/benchmarks/model-routing/integration-fixtures', taskId);
  const pluginSource = path.join(root, condition, 'akasha');
  const runRoot = path.join(runsRoot, runId, 'fixture');
  const agentsRoot = path.join(runRoot, '.agents');
  await mkdir(agentsRoot, { recursive: true });
  await cp(fixtureSource, runRoot, { recursive: true });
  await cp(path.join(pluginSource, 'skills'), path.join(agentsRoot, 'skills'), { recursive: true });
  await cp(path.join(pluginSource, 'knowledge'), path.join(agentsRoot, 'knowledge'), { recursive: true });
  for (const directory of ['roles', 'agents']) {
    try {
      await cp(path.join(pluginSource, directory), path.join(agentsRoot, directory), { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const [command, args] of [
    ['git', ['init', '--quiet']],
    ['git', ['add', '.']],
    ['git', ['-c', 'user.name=akasha-benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '--quiet', '-m', 'baseline']],
  ]) {
    const result = await runCommand(command, args, runRoot);
    if (result.exitCode !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`);
  }
  await cp(path.join(runRoot, 'changed'), runRoot, { recursive: true, force: true });
  return runRoot;
}

async function recentSessionFiles(directory, sinceMs, output = []) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await recentSessionFiles(fullPath, sinceMs, output);
    else if (entry.name.endsWith('.jsonl') && (await stat(fullPath)).mtimeMs >= sinceMs) output.push(fullPath);
  }
  return output;
}

function knowledgeReads(lines) {
  const result = new Set();
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type !== 'response_item' || event.payload?.type !== 'custom_tool_call') continue;
    const input = String(event.payload?.input ?? '');
    for (const match of input.matchAll(/(?:\.agents\/)?(knowledge\/[a-z0-9_./-]+\.md)/giu)) result.add(match[1]);
  }
  return [...result].sort();
}

async function childSessions(parentThreadId, sinceMs) {
  const results = [];
  const files = await recentSessionFiles(path.join(os.homedir(), '.codex/sessions'), sinceMs - 2_000);
  for (const file of files) {
    let meta = null;
    let observedModel = null;
    let observedEffort = null;
    let usage = null;
    let errorCount = 0;
    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'session_meta') meta = event.payload;
        if (event.type === 'turn_context') {
          observedModel = event.payload?.model ?? observedModel;
          observedEffort = event.payload?.effort ?? event.payload?.reasoning_effort ?? observedEffort;
        }
        if (event.type === 'event_msg' && event.payload?.type === 'token_count') usage = event.payload?.info?.total_token_usage ?? usage;
        if (event.type === 'error' || event.payload?.type === 'error') errorCount += 1;
      } catch {}
    }
    if (meta?.parent_thread_id !== parentThreadId) continue;
    const agentPath = meta.source?.subagent?.thread_spawn?.agent_path ?? meta.agent_path ?? '';
    results.push({
      thread_id: meta.id,
      role: agentPath.split('/').filter(Boolean).at(-1)?.replace(/^akasha_/, '').replace(/_review$/, '') ?? null,
      model: observedModel,
      effort: observedEffort,
      usage,
      knowledge_paths_read: knowledgeReads(lines),
      error_count: errorCount,
    });
  }
  return results.sort((a, b) => (a.role ?? '').localeCompare(b.role ?? ''));
}

function addUsage(rootUsage, children) {
  const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
  return Object.fromEntries(fields.map((field) => [
    field,
    (rootUsage?.[field] ?? 0) + children.reduce((sum, child) => sum + (child.usage?.[field] ?? 0), 0),
  ]));
}

function costOf(usage) {
  return estimateCost(usage, configs.prices_snapshot.models[model]);
}

const schedule = [];
for (let repetition = 1; repetition <= repetitions; repetition += 1) {
  const taskOrder = repetition % 2 === 1 ? ['r2', 'r3'] : ['r3', 'r2'];
  for (const taskId of taskOrder) {
    const aFirst = taskId === 'r2' ? repetition % 2 === 1 : repetition % 2 === 0;
    for (const condition of (aFirst ? ['A', 'B'] : ['B', 'A'])) schedule.push({ repetition, taskId, condition });
  }
}

const cliVersion = (await runCommand('codex', ['--version'], root)).stdout.trim();
await writeFile(path.join(root, 'artifacts/manifest.json'), `${JSON.stringify({
  schema_version: 1,
  runtime: 'Codex CLI',
  cli_version: cliVersion,
  baseline_commit: '92c3cbd0256f9000c06e23a01f03bc2a6293039f',
  candidate_commit: '2e027c89a27ae81146e8d57f906f38ed9b57326b',
  model,
  effort,
  repetitions,
  schedule,
  prompt_policy: 'task.txt prefixed with literal $akasha; byte-identical across conditions',
  isolation: '--ignore-user-config plus project-local .agents skill/roles-or-agents/knowledge',
}, null, 2)}\n`);

for (let index = 0; index < schedule.length; index += 1) {
  if (index + 1 < startAt) continue;
  const item = schedule[index];
  const runId = `${String(index + 1).padStart(2, '0')}-${item.taskId}-${item.condition}-rep${item.repetition}`;
  const runRoot = await prepareFixture(item.condition, item.taskId, runId);
  const taskText = (await readFile(path.join(runRoot, 'task.txt'), 'utf8')).trim();
  const prompt = `$akasha ${taskText}`;
  process.stdout.write(`START ${runId} ${new Date().toISOString()}\n`);
  const startedAt = Date.now();
  const execution = await runCommand('codex', [
    'exec',
    '--json',
    '--color', 'never',
    '--ignore-user-config',
    '--ignore-rules',
    '--enable', 'multi_agent',
    '-m', model,
    '-c', `model_reasoning_effort="${effort}"`,
    '-c', 'approval_policy="never"',
    '-c', 'agents.enabled=true',
    '-c', 'agents.max_concurrent_threads_per_session=8',
    '-s', 'read-only',
    '-C', runRoot,
    prompt,
  ], runRoot, 480_000);
  const parsed = parseCodexJsonl(execution.stdout);
  const children = await childSessions(parsed.threadId, startedAt);
  const totalUsage = addUsage(parsed.usage, children);
  const quality = scoreText(taskConfig[item.taskId].qualityTask, parsed.finalMessage);
  const expectedRoles = [...taskConfig[item.taskId].expectedRoles].sort();
  const actualRoles = children.map((child) => child.role).filter(Boolean).sort();
  const knowledgePaths = [...new Set(children.flatMap((child) => child.knowledge_paths_read))].sort();
  const citedPaths = [...new Set(parsed.finalMessage.match(/(?:\.agents\/)?knowledge\/[a-z0-9_./-]+\.md/giu) ?? [])]
    .map((item) => item.replace(/^\.agents\//u, ''));
  const grounded = citedPaths.filter((item) => knowledgePaths.includes(item));
  const stderrErrorLines = execution.stderr.split('\n').filter((line) => /\bERROR\b|internal error|thread limit/iu.test(line));
  const externalWarningLines = stderrErrorLines.filter((line) => /503 Service Unavailable|connection reset|rate.?limit/iu.test(line));
  const internalErrorLines = stderrErrorLines.filter((line) => !externalWarningLines.includes(line));
  const internalErrors = parsed.errors.length
    + children.reduce((sum, child) => sum + child.error_count, 0)
    + internalErrorLines.length;
  let errorType = classifyError({
    timedOut: execution.timedOut,
    exitCode: execution.exitCode,
    stderr: execution.outputExceeded ? `${execution.stderr}\noutput limit exceeded` : execution.stderr,
    stdoutErrors: execution.outputExceeded ? [...parsed.errors, 'output limit exceeded'] : parsed.errors,
    observedModel: model,
    requestedModel: model,
    qualityScore: quality.score,
  });
  if (execution.exitCode === 0 && parsed.finalMessage) errorType = quality.score < 1 ? 'quality_gate' : 'none';
  const record = {
    schema_version: 1,
    run_id: runId,
    runtime: 'codex',
    task_id: item.taskId,
    condition: item.condition,
    repetition: item.repetition,
    plugin_commit: item.condition === 'A' ? '92c3cbd' : '2e027c8',
    root_model: model,
    root_effort: effort,
    started_at: new Date(startedAt).toISOString(),
    wall_ms: execution.wallMs,
    timed_out: execution.timedOut,
    exit_code: execution.exitCode,
    root_usage: parsed.usage,
    total_usage: totalUsage,
    estimated_api_cost_usd: costOf(totalUsage),
    children,
    expected_roles: expectedRoles,
    actual_roles: actualRoles,
    exact_roles: JSON.stringify(actualRoles) === JSON.stringify(expectedRoles),
    exact_models: children.length === expectedRoles.length
      && children.every((child) => child.model === model && child.effort === effort),
    knowledge_paths_read: knowledgePaths,
    knowledge_documents_read: knowledgePaths.length,
    cited_knowledge_paths: citedPaths,
    grounded_knowledge_citations: grounded,
    grounded_citation_rate: citedPaths.length ? grounded.length / citedPaths.length : 0,
    quality_score_regex: quality.score,
    rubric_items: quality.items,
    error_type: errorType,
    infra_invalid: errorType === 'external_dependency',
    internal_errors: internalErrors,
    intermediate_errors: stderrErrorLines.length + parsed.errors.length + children.reduce((sum, child) => sum + child.error_count, 0),
    stderr_error_lines: stderrErrorLines,
    external_warning_lines: externalWarningLines,
    final_message: parsed.finalMessage,
    stdout_parse_errors: parsed.errors,
    stderr_excerpt: execution.stderr.slice(0, 3_000),
    thread_id: parsed.threadId,
  };
  await writeFile(path.join(runsRoot, runId, 'stdout.jsonl'), execution.stdout, { mode: 0o600 });
  await writeFile(path.join(runsRoot, runId, 'stderr.txt'), execution.stderr, { mode: 0o600 });
  await writeFile(path.join(runsRoot, runId, 'record.json'), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await appendFile(path.join(root, 'artifacts/raw.jsonl'), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  process.stdout.write(`DONE ${runId} exit=${record.exit_code} error=${record.error_type} quality=${record.quality_score_regex.toFixed(3)} tokens=${record.total_usage.total_tokens} wall_ms=${record.wall_ms} roles=${record.actual_roles.join(',')} docs=${record.knowledge_documents_read} internal_errors=${record.internal_errors}\n`);
  if (record.infra_invalid || record.timed_out) {
    process.stdout.write(`ABORT ${record.error_type} ${runId}\n`);
    break;
  }
}
