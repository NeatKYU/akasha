import { spawn } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { classifyError, estimateCost, parseCodexJsonl, scoreText, validateAkashaReview } from './model-routing-lib.mjs';

const redact = (text) => text.replace(/(authorization|api[_-]?key|token)(["'=: ]+)[^\s"']+/giu, '$1$2[REDACTED]');

function parseArgs(argv) {
  const args = { output: null, repetitions: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') args.output = argv[++index];
    else if (argv[index] === '--repetitions') args.repetitions = Number(argv[++index]);
    else if (argv[index] === '--help') {
      console.log('Usage: node scripts/run-akasha-routing-ab.mjs --output DIR [--repetitions N]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!args.output) throw new Error('--output is required');
  return args;
}

const cli = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fixtureSourceRoot = path.join(repoRoot, 'benchmarks/model-routing/integration-fixtures');
const taskCatalog = JSON.parse(await readFile(path.join(repoRoot, 'benchmarks/model-routing/tasks.json'), 'utf8'));
const configCatalog = JSON.parse(await readFile(path.join(repoRoot, 'benchmarks/model-routing/configs.json'), 'utf8'));
const diffContractRubric = [
  { id: 'diff-evidence', all_of: ['diff_evidence', 'introduced_by_diff'] },
  { id: 'knowledge-selection', all_of: ['knowledge_selection', 'paths', 'exception'] },
];
const qualityTask = {
  r2: {
    ...taskCatalog.find((task) => task.id === 'l2-dialog-review'),
    rubric: [
      ...taskCatalog.find((task) => task.id === 'l2-dialog-review').rubric,
      ...diffContractRubric,
      { id: 'no-alertdialog-removal-false-positive', none_of: ['alertdialog[^\\n]{0,80}(제거|삭제|없애)'] },
    ],
  },
  r3: {
    ...taskCatalog.find((task) => task.id === 'l3-cross-layer-review'),
    rubric: [
      ...taskCatalog.find((task) => task.id === 'l3-cross-layer-review').rubric,
      ...diffContractRubric,
    ],
  },
};
const fixtures = {};
const expectedRoles = {
  r2: ['design', 'frontend'],
  r3: ['backend', 'data', 'platform', 'qa', 'security'],
};
const outputRoot = path.resolve(cli.output);
const runsRoot = path.join(outputRoot, 'runs');
await mkdir(runsRoot, { recursive: true });

async function command(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: 'ignore' });
  const exitCode = await new Promise((resolve) => child.on('close', (code) => resolve(code ?? 1)));
  if (exitCode !== 0) throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`);
}

async function commandOutput(commandName, args, cwd) {
  const child = spawn(commandName, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve) => child.on('close', (code) => resolve(code ?? 1)));
  if (exitCode !== 0) throw new Error(`${commandName} ${args.join(' ')} failed in ${cwd}: ${stderr}`);
  return stdout.trim();
}

async function overlayChanged(sourceRoot, destinationRoot, relative = '') {
  const directory = path.join(sourceRoot, relative);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const nextRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      await mkdir(path.join(destinationRoot, nextRelative), { recursive: true });
      await overlayChanged(sourceRoot, destinationRoot, nextRelative);
    } else {
      await cp(path.join(sourceRoot, nextRelative), path.join(destinationRoot, nextRelative), { force: true });
    }
  }
}

for (const taskId of ['r2', 'r3']) {
  const taskRoot = await mkdtemp(path.join(os.tmpdir(), `akasha-routing-${taskId}-`));
  await cp(path.join(fixtureSourceRoot, taskId), taskRoot, { recursive: true });
  await command('git', ['init', '--quiet'], taskRoot);
  await command('git', ['add', '.'], taskRoot);
  await overlayChanged(path.join(taskRoot, 'changed'), taskRoot);
  const changedFiles = (await commandOutput('git', ['diff', '--name-only'], taskRoot)).split('\n').filter(Boolean).sort();
  const expectedFiles = taskId === 'r2'
    ? ['components/Dialog.tsx']
    : ['.github/workflows/release.yml', 'app/api/projects/route.ts', 'prisma/schema.prisma', 'tests/projects.spec.ts'];
  if (JSON.stringify(changedFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`fixture ${taskId} diff mismatch: ${changedFiles.join(',')}`);
  }
  fixtures[taskId] = taskRoot;
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

async function childSessions(parentThreadId, sinceMs) {
  const results = [];
  const files = await recentSessionFiles(path.join(os.homedir(), '.codex/sessions'), sinceMs - 2000);
  for (const file of files) {
    let meta = null;
    let model = null;
    let effort = null;
    let usage = null;
    let errors = 0;
    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'session_meta') meta = event.payload;
        if (event.type === 'turn_context') {
          model = event.payload?.model ?? model;
          effort = event.payload?.effort ?? event.payload?.reasoning_effort ?? effort;
        }
        if (event.type === 'event_msg' && event.payload?.type === 'token_count') usage = event.payload?.info?.total_token_usage ?? usage;
        if (event.type === 'error' || event.payload?.type === 'error') errors += 1;
      } catch {}
    }
    if (meta?.parent_thread_id !== parentThreadId) continue;
    const agentPath = meta.source?.subagent?.thread_spawn?.agent_path ?? meta.agent_path ?? '';
    results.push({
      thread_id: meta.id,
      role: agentPath.split('/').filter(Boolean).at(-1)?.replace(/^akasha_/, '').replace(/_review$/, '') ?? null,
      model,
      effort,
      usage,
      error_count: errors,
    });
  }
  return results.sort((a, b) => (a.role ?? '').localeCompare(b.role ?? ''));
}

function addUsage(rootUsage, children) {
  const fields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
  return Object.fromEntries(fields.map((field) => [field, (rootUsage?.[field] ?? 0) + children.reduce((sum, child) => sum + (child.usage?.[field] ?? 0), 0)]));
}

function costOf(usage, model) {
  return estimateCost(usage, configCatalog.prices_snapshot.models[model]);
}

async function runOne(taskId, condition, repetition) {
  const runId = `${taskId}-${condition}-${repetition}-${randomUUID().slice(0, 8)}`;
  const taskRoot = fixtures[taskId];
  const taskText = await readFile(path.join(taskRoot, 'task.txt'), 'utf8');
  const scopedDiff = await commandOutput('git', ['diff'], taskRoot);
  const childEffort = taskId === 'r2' ? 'medium' : 'high';
  const override = condition === 'routed'
    ? `선택한 모든 child에 model gpt-5.5와 reasoning_effort ${childEffort}를 명시적으로 적용하세요.`
    : '모델과 reasoning effort는 production 기본 상속 계약을 사용하세요.';
  const prompt = `$akasha Benchmark ${condition}. ${override} stdin 작업을 읽기 전용으로 수행하고 Akasha 보고 형식을 지키세요.`;
  const startedAt = new Date();
  const args = [
    'exec', '--json', '--color', 'never', '-m', 'gpt-5.6-terra',
    '-c', 'model_reasoning_effort="medium"', '-c', 'approval_policy="never"',
    '-s', 'read-only', '-C', taskRoot, prompt,
  ];
  const child = spawn('codex', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(taskText);
  let stdout = '';
  let stderr = '';
  let outputExceeded = false;
  const appendBounded = (current, chunk) => {
    const next = current + chunk;
    if (Buffer.byteLength(next) <= 5_000_000) return next;
    outputExceeded = true;
    child.kill('SIGTERM');
    return next.slice(0, 5_000_000);
  };
  child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
  let timedOut = false;
  let forceKillTimer = null;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  }, 480_000);
  const exitCode = await new Promise((resolve) => child.on('close', (code) => resolve(code ?? 1)));
  clearTimeout(timer);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  const finishedAt = new Date();
  const parsed = parseCodexJsonl(stdout);
  const children = await childSessions(parsed.threadId, startedAt.getTime());
  const totalUsage = addUsage(parsed.usage, children);
  const quality = scoreText(qualityTask[taskId], parsed.finalMessage);
  const expected = expectedRoles[taskId];
  const qualityContract = validateAkashaReview(parsed.finalMessage, {
    defaultKnowledgeLimit: expected.length * 2,
    maxKnowledgeLimit: expected.length * 3,
    maxFindings: 8,
    diffText: scopedDiff,
  });
  const actualRoles = children.map((item) => item.role).filter(Boolean).sort();
  const exactRoles = JSON.stringify(actualRoles) === JSON.stringify([...expected].sort());
  const expectedChildModel = condition === 'routed' ? 'gpt-5.5' : 'gpt-5.6-terra';
  const expectedChildEffort = condition === 'routed' ? childEffort : 'medium';
  const exactModels = children.length === expected.length && children.every((item) => item.model === expectedChildModel && item.effort === expectedChildEffort);
  const rootCost = costOf(parsed.usage, 'gpt-5.6-terra') ?? 0;
  const childCost = children.reduce((sum, item) => sum + (costOf(item.usage, item.model) ?? 0), 0);
  const internalErrors = parsed.errors.length + children.reduce((sum, item) => sum + item.error_count, 0)
    + qualityContract.errors.length
    + (/(internal error|agent thread limit|timeout_ms)/iu.test(stderr) ? 1 : 0);
  const errorType = classifyError({
    timedOut,
    exitCode,
    stderr: outputExceeded ? `${stderr}\noutput limit exceeded` : stderr,
    stdoutErrors: outputExceeded ? [...parsed.errors, 'output limit exceeded'] : parsed.errors,
    observedModel: 'gpt-5.6-terra',
    requestedModel: 'gpt-5.6-terra',
    qualityScore: quality.score,
  });
  const record = {
    schema_version: 1,
    run_id: runId,
    task_id: taskId,
    condition,
    repetition,
    root_model: 'gpt-5.6-terra',
    root_effort: 'medium',
    expected_child_model: expectedChildModel,
    expected_child_effort: expectedChildEffort,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    wall_ms: finishedAt - startedAt,
    timed_out: timedOut,
    exit_code: exitCode,
    root_usage: parsed.usage,
    total_usage: totalUsage,
    estimated_api_cost_usd: rootCost + childCost,
    children,
    exact_roles: exactRoles,
    exact_models: exactModels,
    quality_score_regex: quality.score,
    rubric_items: quality.items,
    quality_contract_valid: qualityContract.valid,
    quality_contract_errors: qualityContract.errors,
    error_type: errorType,
    infra_invalid: errorType === 'external_dependency',
    internal_errors: errorType === 'orchestration_internal' ? internalErrors : 0,
    final_message: redact(parsed.finalMessage),
    error_detail: redact(parsed.errors.join('\n')),
    stderr_excerpt: redact(stderr.slice(0, 2000)),
    thread_id: parsed.threadId,
  };
  await writeFile(path.join(runsRoot, `${runId}.stdout.jsonl`), redact(stdout), { mode: 0o600 });
  await writeFile(path.join(runsRoot, `${runId}.stderr.txt`), redact(stderr), { mode: 0o600 });
  await appendFile(path.join(outputRoot, 'raw.jsonl'), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ run_id: runId, task: taskId, condition, roles: actualRoles, exact_roles: exactRoles, exact_models: exactModels, quality: quality.score, tokens: totalUsage.total_tokens, wall_ms: record.wall_ms, error_type: errorType, internal_errors: record.internal_errors }));
  return record;
}

const schedule = [];
for (let repetition = 1; repetition <= cli.repetitions; repetition += 1) {
  const conditions = repetition % 2 === 1 ? ['inherit', 'routed'] : ['routed', 'inherit'];
  for (const taskId of ['r2', 'r3']) for (const condition of conditions) schedule.push({ taskId, condition, repetition });
}
await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({ created_at: new Date().toISOString(), repetitions: cli.repetitions, schedule }, null, 2)}\n`);
let completedRuns = 0;
let abortedDueTo = null;
for (const item of schedule) {
  const record = await runOne(item.taskId, item.condition, item.repetition);
  completedRuns += 1;
  if (record.error_type === 'external_dependency') {
    abortedDueTo = /usage limit/iu.test(record.error_detail + record.stderr_excerpt) ? 'usage_limit' : 'external_dependency';
    break;
  }
}
console.log(JSON.stringify({ output: outputRoot, planned_runs: schedule.length, completed_runs: completedRuns, aborted_due_to: abortedDueTo }));
