import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { classifyError, estimateCost, findSessionObservation, parseCodexJsonl, scoreText } from './model-routing-lib.mjs';

const redact = (text) => text.replace(/(authorization|api[_-]?key|token)(["'=: ]+)[^\s"']+/giu, '$1$2[REDACTED]');

function argsOf(argv) {
  const args = { phase: 'smoke', repetitions: null, output: null, maxRuns: Infinity, dryRun: false, configs: null, tasks: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') args.dryRun = true;
    else if (value === '--phase') args.phase = argv[++index];
    else if (value === '--repetitions') args.repetitions = Number(argv[++index]);
    else if (value === '--output') args.output = argv[++index];
    else if (value === '--max-runs') args.maxRuns = Number(argv[++index]);
    else if (value === '--configs') args.configs = argv[++index].split(',');
    else if (value === '--tasks') args.tasks = argv[++index].split(',');
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!['smoke', 'screen', 'confirm'].includes(args.phase)) throw new Error(`Unsupported phase: ${args.phase}`);
  return args;
}

const cli = argsOf(process.argv.slice(2));
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const benchmarkRoot = path.join(repoRoot, 'benchmarks/model-routing');
const configsDocument = JSON.parse(await readFile(path.join(benchmarkRoot, 'configs.json'), 'utf8'));
const allTasks = JSON.parse(await readFile(path.join(benchmarkRoot, 'tasks.json'), 'utf8'));
const selectedConfigs = configsDocument[cli.phase === 'smoke' ? 'smoke' : 'screen']
  .filter((config) => !cli.configs || cli.configs.includes(config.id));
const selectedTasks = allTasks.filter((task) => !cli.tasks || cli.tasks.includes(task.id));
const repetitions = cli.repetitions ?? (cli.phase === 'smoke' ? 1 : cli.phase === 'screen' ? 3 : 7);
const outputRoot = path.resolve(cli.output ?? path.join('/tmp', `akasha-model-routing-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`));
const runsRoot = path.join(outputRoot, 'runs');
await mkdir(runsRoot, { recursive: true });

const schedule = [];
for (let repetition = 1; repetition <= repetitions; repetition += 1) {
  for (let offset = 0; offset < selectedConfigs.length; offset += 1) {
    const config = selectedConfigs[(offset + repetition - 1) % selectedConfigs.length];
    const tasks = cli.phase === 'smoke'
      ? selectedTasks.filter((task) => task.id === 'l1-inherit-contract').slice(0, 1)
      : selectedTasks.filter((task) => task.lane === config.lane);
    for (const task of tasks) schedule.push({ config, task, repetition, blockId: `${task.id}-${repetition}` });
  }
}
const boundedSchedule = schedule.slice(0, cli.maxRuns);
await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({
  created_at: new Date().toISOString(),
  phase: cli.phase,
  repetitions,
  dry_run: cli.dryRun,
  schedule: boundedSchedule.map(({ config, task, repetition, blockId }) => ({ config: config.id, task: task.id, repetition, block_id: blockId })),
  price_snapshot: configsDocument.prices_snapshot,
}, null, 2)}\n`);

if (cli.dryRun) {
  console.log(JSON.stringify({ output: outputRoot, runs: boundedSchedule.length, schedule: boundedSchedule.map(({ config, task }) => `${config.id}:${task.id}`) }, null, 2));
  process.exit(0);
}

async function execute({ config, task, repetition, blockId }) {
  const runId = `${task.id}-${config.id}-${repetition}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date();
  const prompt = [
    '이 작업은 읽기 전용 benchmark입니다. 도구를 호출하거나 파일을 수정하지 마세요.',
    '주어진 정보만 사용하고 요청한 JSON 결과 하나만 반환하세요.',
    task.prompt,
  ].join('\n\n');
  const commandArgs = [
    'exec', '--json', '--color', 'never', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check',
    '-m', config.model, '-c', `model_reasoning_effort=${JSON.stringify(config.effort)}`,
    '-c', 'approval_policy="never"', '-s', 'read-only', '-C', os.tmpdir(), prompt,
  ];
  const child = spawn('codex', commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
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
  }, 180_000);
  const exitCode = await new Promise((resolve) => child.on('close', (code) => resolve(code ?? 1)));
  clearTimeout(timer);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  const finishedAt = new Date();
  const parsed = parseCodexJsonl(stdout);
  const observation = await findSessionObservation(path.join(os.homedir(), '.codex/sessions'), parsed.threadId);
  const quality = scoreText(task, parsed.finalMessage);
  const errorType = classifyError({
    timedOut,
    exitCode,
    stderr: outputExceeded ? `${stderr}\noutput limit exceeded` : stderr,
    stdoutErrors: outputExceeded ? [...parsed.errors, 'output limit exceeded'] : parsed.errors,
    observedModel: observation.model,
    requestedModel: config.model,
    qualityScore: quality.score,
  });
  const price = configsDocument.prices_snapshot.models[config.model];
  const record = {
    schema_version: 1,
    run_id: runId,
    block_id: blockId,
    block_attempt: 1,
    replacement_for_run_id: null,
    phase: cli.phase,
    task_id: task.id,
    lane: task.lane,
    config_id: config.id,
    requested_model: config.model,
    observed_model: observation.model,
    requested_effort: config.effort,
    observed_effort: observation.effort,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    wall_ms: finishedAt - startedAt,
    usage: parsed.usage,
    estimated_api_cost_usd: estimateCost(parsed.usage, price),
    first_pass_success: errorType === 'none',
    retry_success: false,
    error_type: errorType,
    infra_invalid: errorType === 'external_dependency',
    quality_score: quality.score,
    rubric_items: quality.items,
    exit_code: exitCode,
    stdout_error_count: parsed.errors.length,
    stderr_excerpt: redact(stderr.slice(0, 2000)),
    final_message: redact(parsed.finalMessage),
    thread_id: parsed.threadId,
  };
  await writeFile(path.join(runsRoot, `${runId}.stdout.jsonl`), redact(stdout), { mode: 0o600 });
  await writeFile(path.join(runsRoot, `${runId}.stderr.txt`), redact(stderr), { mode: 0o600 });
  await appendFile(path.join(outputRoot, 'raw.jsonl'), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ run_id: runId, config: config.id, task: task.id, error_type: errorType, quality: quality.score, tokens: parsed.usage?.total_tokens ?? null, wall_ms: record.wall_ms }));
  return record;
}

let failures = 0;
let completedRuns = 0;
let abortedDueTo = null;
for (const item of boundedSchedule) {
  const record = await execute(item);
  completedRuns += 1;
  if (!['none', 'quality_gate'].includes(record.error_type)) failures += 1;
  if (record.error_type === 'external_dependency') {
    abortedDueTo = 'external_dependency';
    break;
  }
}
console.log(JSON.stringify({ output: outputRoot, planned_runs: boundedSchedule.length, completed_runs: completedRuns, operational_failures: failures, aborted_due_to: abortedDueTo }));
