// 플러그인 버전 A/B runner — 기준선(A)과 후보(B) 플러그인 트리를 조건으로 두고 같은 과업을 반복 실행한다.
// benchmarks/model-routing/archived-traces/*/run-codex-ab.mjs를 대체한다. 승격하면서 바꾼 것:
//   1. plugin_commit 하드코딩 문자열 → 조건별 내용 해시(실제로 잰 값)
//   2. 계약 검증 없음 → validateAkashaReview를 축으로 추가(품질 점수에는 합산하지 않음)
//   3. 단일 rubric 점수 → task/contract/false_positive 레이어 분리 채점
// 조건마다 플러그인이 다르므로 subject 해시는 배치 단위가 아니라 조건 단위로 찍는다.
import { spawn } from 'node:child_process';
import { appendFile, cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  classifyError,
  classifyStderrLines,
  CONTRACT_VALIDATOR_VERSION,
  estimateCost,
  parseCodexJsonl,
  REGEX_SCORER_VERSION,
  scoreRubricLayers,
  STDERR_CLASSIFIER_VERSION,
  validateAkashaReview,
} from './model-routing-lib.mjs';
import { MATCHER_VERSION as KEY_SCORER_MATCHER_VERSION } from './akasha-key-scorer.mjs';
import {
  combineHashes,
  gitProvenance,
  hashFiles,
  hashPluginSubject,
  hashTree,
  PLUGIN_READ_DIRS,
  PROVENANCE_SCHEMA_VERSION,
  tryCommandOutput,
} from './provenance.mjs';

const USAGE = 'Usage: node scripts/run-akasha-version-ab.mjs --output DIR --baseline PLUGIN_DIR '
  + '[--candidate PLUGIN_DIR] [--repetitions N] [--start-at N] [--only A|B] [--task r2|r3] [--no-snapshot] [--dry-run]';

function parseArgs(argv) {
  const args = { output: null, baseline: null, candidate: null, repetitions: 3, startAt: 1, only: null, tasks: null, snapshot: true, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') args.output = argv[++index];
    else if (argv[index] === '--baseline') args.baseline = argv[++index];
    else if (argv[index] === '--candidate') args.candidate = argv[++index];
    else if (argv[index] === '--repetitions') args.repetitions = Number(argv[++index]);
    else if (argv[index] === '--start-at') args.startAt = Number(argv[++index]);
    else if (argv[index] === '--only') args.only = argv[++index];
    // 실패가 한 태스크에 몰려 있을 때 그 태스크만 반복해 표본을 모은다. 태스크를 섞으면
    // 태스크 간 평균 차이가 분산으로 들어가 같은 런 수로도 검정력이 떨어진다.
    else if (argv[index] === '--task') (args.tasks ??= []).push(argv[++index]);
    else if (argv[index] === '--no-snapshot') args.snapshot = false;
    else if (argv[index] === '--dry-run') args.dryRun = true;
    else if (argv[index] === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!args.output) throw new Error('--output is required');
  if (!args.baseline) throw new Error('--baseline is required (기준선 플러그인 트리 경로)');
  if (args.only && !['A', 'B'].includes(args.only)) throw new Error('--only must be A or B');
  for (const taskId of args.tasks ?? []) {
    if (!['r2', 'r3'].includes(taskId)) throw new Error(`--task must be r2 or r3 (got ${taskId})`);
  }
  return args;
}

const cli = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outputRoot = path.resolve(cli.output);
const runsRoot = path.join(outputRoot, 'runs');
const fixtureSourceRoot = path.join(repoRoot, 'benchmarks/model-routing/integration-fixtures');
const answerKeyDir = path.join(repoRoot, 'benchmarks/model-routing/answer-keys');
const taskCatalog = JSON.parse(await readFile(path.join(repoRoot, 'benchmarks/model-routing/tasks.json'), 'utf8'));
const configCatalog = JSON.parse(await readFile(path.join(repoRoot, 'benchmarks/model-routing/configs.json'), 'utf8'));
await mkdir(runsRoot, { recursive: true });

const model = 'gpt-5.6-terra';
const effort = 'medium';
const conditions = {
  A: { label: 'baseline', pluginDir: path.resolve(cli.baseline) },
  B: { label: 'candidate', pluginDir: path.resolve(cli.candidate ?? path.join(repoRoot, 'akasha')) },
};

// 계약 준수는 별도 축이다. 품질 점수(quality_score_regex)는 tasks.json rubric만으로 계산한다.
const RUBRIC_LAYOUT_VERSION = 'layers-1/task-only-quality';
const contractRubric = [
  { id: 'diff-evidence', all_of: ['diff_evidence', 'introduced_by_diff'] },
  { id: 'knowledge-selection', all_of: ['knowledge_selection', 'paths', 'exception'] },
];
const falsePositiveRubric = {
  r2: [{ id: 'no-alertdialog-removal-false-positive', none_of: ['alertdialog[^\\n]{0,80}(제거|삭제|없애)'] }],
  r3: [],
};
const taskConfig = {
  r2: {
    expectedRoles: ['design', 'frontend'],
    qualityTask: taskCatalog.find((item) => item.id === 'l2-dialog-review'),
    changedFiles: ['components/Dialog.tsx'],
  },
  r3: {
    expectedRoles: ['backend', 'data', 'platform', 'qa', 'security'],
    qualityTask: taskCatalog.find((item) => item.id === 'l3-cross-layer-review'),
    changedFiles: ['.github/workflows/release.yml', 'app/api/projects/route.ts', 'prisma/schema.prisma', 'tests/projects.spec.ts'],
  },
};
const rubricLayers = Object.fromEntries(Object.entries(taskConfig).map(([taskId, config]) => [taskId, {
  task: config.qualityTask.rubric,
  contract: contractRubric,
  false_positive: falsePositiveRubric[taskId],
}]));
const rubricLayerIds = Object.fromEntries(Object.entries(rubricLayers).map(([taskId, layers]) => [
  taskId,
  Object.fromEntries(Object.entries(layers).map(([name, rubric]) => [name, rubric.map((item) => item.id)])),
]));

// stderr에는 CLI 인증 오류가 섞일 수 있어 가린다. final_message와 stdout은 채점 입력이므로
// 원문을 유지한다(저장된 과거 응답과 같은 조건에서 채점해야 key scorer 규칙이 그대로 적용된다).
const redact = (text) => text.replace(/(authorization|api[_-]?key|token)(["'=: ]+)[^\s"']+/giu, '$1$2[REDACTED]');

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
      resolve({ exitCode: code ?? 1, stdout, stderr, timedOut, outputExceeded, wallMs: Date.now() - started });
    });
  });
}

async function assertPluginTree(condition) {
  const { pluginDir } = conditions[condition];
  let entries;
  try { entries = await readdir(pluginDir, { withFileTypes: true }); } catch {
    throw new Error(`${condition} 플러그인 트리를 읽을 수 없다: ${pluginDir}`);
  }
  const names = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  for (const required of ['skills', 'knowledge']) {
    if (!names.has(required)) throw new Error(`${condition} 플러그인 트리에 ${required}/ 가 없다: ${pluginDir}`);
  }
  if (!names.has('agents') && !names.has('roles')) {
    throw new Error(`${condition} 플러그인 트리에 agents/ 또는 roles/ 가 없다: ${pluginDir}`);
  }
}

async function readDeclaredVersion(pluginDir) {
  for (const relative of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    try {
      return JSON.parse(await readFile(path.join(pluginDir, relative), 'utf8')).version ?? null;
    } catch {}
  }
  return null;
}

async function prepareFixture(condition, taskId, runId) {
  const pluginSource = conditions[condition].pluginDir;
  const runRoot = path.join(runsRoot, runId, 'fixture');
  const agentsRoot = path.join(runRoot, '.agents');
  await mkdir(agentsRoot, { recursive: true });
  await cp(path.join(fixtureSourceRoot, taskId), runRoot, { recursive: true });
  for (const directory of PLUGIN_READ_DIRS) {
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
  const changed = (await runCommand('git', ['diff', '--name-only'], runRoot)).stdout.trim().split('\n').filter(Boolean).sort();
  const expected = [...taskConfig[taskId].changedFiles].sort();
  if (JSON.stringify(changed) !== JSON.stringify(expected)) {
    throw new Error(`fixture ${taskId} diff mismatch: ${changed.join(',')}`);
  }
  const scopedDiff = (await runCommand('git', ['diff'], runRoot)).stdout;
  // 스탬프한 subject와 codex가 실제로 읽을 트리가 같은지 매 run 확인한다.
  const prepared = await hashPluginSubject(agentsRoot);
  if (prepared.hash !== subjects[condition].hash) {
    throw new Error(`${runId}: 준비된 .agents가 스탬프한 subject와 다르다 (${prepared.hash} != ${subjects[condition].hash})`);
  }
  return { runRoot, scopedDiff };
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

// knowledgeReads 는 도구 호출 입력에 등장한 `knowledge/...md` 문자열을 전부 센다. 그래서
// 존재하지 않는 파일에 대한 실패한 test -f / sed 도 "읽은 문서"로 잡힌다. 실제로 그런 런이
// 있었다(없는 문서 2건을 인용하고 "근거 없음"을 반환했는데 지표상 docs=2). 트리에 실재하는
// 경로만 남겨 지표가 실제 근거를 세게 한다.
const realKnowledgeCache = new Map();
async function realKnowledgePaths(condition) {
  if (realKnowledgeCache.has(condition)) return realKnowledgeCache.get(condition);
  const root = path.join(conditions[condition].pluginDir, 'knowledge');
  const found = new Set();
  async function walk(dir, prefix) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(next, `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.md')) found.add(`knowledge/${prefix}${entry.name}`);
    }
  }
  await walk(root, '');
  realKnowledgeCache.set(condition, found);
  return found;
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

const costOf = (usage) => estimateCost(usage, configCatalog.prices_snapshot.models[model]);

for (const condition of ['A', 'B']) await assertPluginTree(condition);

// --- provenance ---
const harnessFiles = [
  'scripts/run-akasha-version-ab.mjs',
  'scripts/model-routing-lib.mjs',
  'scripts/akasha-key-scorer.mjs',
  'scripts/provenance.mjs',
  'benchmarks/model-routing/tasks.json',
  'benchmarks/model-routing/configs.json',
];
const [gitState, fixtureTree, answerKeyTree, harnessTree, codexVersion] = await Promise.all([
  gitProvenance(repoRoot),
  hashTree(fixtureSourceRoot),
  hashTree(answerKeyDir),
  hashFiles(repoRoot, harnessFiles),
  tryCommandOutput('codex', ['--version'], repoRoot),
]);
const harnessHash = combineHashes({ scripts: harnessTree.hash, fixtures: fixtureTree.hash, answer_keys: answerKeyTree.hash });
const subjects = {};
for (const condition of ['A', 'B']) {
  const subject = await hashPluginSubject(conditions[condition].pluginDir);
  subjects[condition] = {
    ...subject,
    role: conditions[condition].label,
    declared_version: await readDeclaredVersion(conditions[condition].pluginDir),
    full_tree: (await hashTree(conditions[condition].pluginDir)).hash,
  };
}
if (subjects.A.hash === subjects.B.hash) {
  throw new Error('A와 B의 플러그인 내용이 동일하다. 버전 비교가 성립하지 않는다.');
}
let snapshotRelative = null;
if (cli.snapshot) {
  const snapshotRoot = path.join(outputRoot, 'snapshot');
  await mkdir(snapshotRoot, { recursive: true });
  for (const condition of ['A', 'B']) {
    await cp(conditions[condition].pluginDir, path.join(snapshotRoot, `plugin-${condition}`), { recursive: true });
  }
  await cp(fixtureSourceRoot, path.join(snapshotRoot, 'integration-fixtures'), { recursive: true });
  if (answerKeyTree.exists) await cp(answerKeyDir, path.join(snapshotRoot, 'answer-keys'), { recursive: true });
  for (const relative of harnessFiles) {
    const destination = path.join(snapshotRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(repoRoot, relative), destination, { force: true });
  }
  snapshotRelative = 'snapshot';
}
const provenance = {
  schema_version: PROVENANCE_SCHEMA_VERSION,
  experiment: 'plugin-version-ab',
  captured_at: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, node: process.version },
  git: gitState,
  subjects,
  subject_read_dirs: PLUGIN_READ_DIRS,
  harness: { hash: harnessHash, scripts: harnessTree, fixtures: fixtureTree, answer_keys: answerKeyTree },
  scoring: {
    quality_score_scope: 'task_rubric_only',
    rubric_layout_version: RUBRIC_LAYOUT_VERSION,
    rubric_layer_ids: rubricLayerIds,
    regex_scorer_version: REGEX_SCORER_VERSION,
    contract_validator_version: CONTRACT_VALIDATOR_VERSION,
    key_scorer_matcher_version: KEY_SCORER_MATCHER_VERSION,
    stderr_classifier_version: STDERR_CLASSIFIER_VERSION,
  },
  execution: {
    codex_cli_version: codexVersion.ok ? codexVersion.stdout : null,
    model,
    effort,
    repetitions: cli.repetitions,
    tasks: cli.tasks ?? ['r2', 'r3'],
    sandbox: 'read-only',
    isolation: '--ignore-user-config --ignore-rules + 프로젝트 로컬 .agents/(조건별 플러그인 트리 복사)',
    prompt_policy: 'task.txt 앞에 리터럴 $akasha만 붙이며 조건 간 바이트 동일',
    snapshot: snapshotRelative,
  },
};
const stampFor = (condition) => ({
  schema_version: PROVENANCE_SCHEMA_VERSION,
  experiment: 'plugin-version-ab',
  condition_role: conditions[condition].label,
  subject_hash: subjects[condition].hash,
  subject_full_tree_hash: subjects[condition].full_tree,
  subject_declared_version: subjects[condition].declared_version,
  subject_source: subjects[condition].root,
  plugin_commit: gitState.commit_short,
  git_describe: gitState.describe,
  git_dirty_tracked: gitState.dirty_tracked,
  harness_hash: harnessHash,
  fixtures_hash: fixtureTree.hash,
  answer_keys_hash: answerKeyTree.exists ? answerKeyTree.hash : null,
  rubric_layout_version: RUBRIC_LAYOUT_VERSION,
  regex_scorer_version: REGEX_SCORER_VERSION,
  contract_validator_version: CONTRACT_VALIDATOR_VERSION,
  key_scorer_matcher_version: KEY_SCORER_MATCHER_VERSION,
  stderr_classifier_version: STDERR_CLASSIFIER_VERSION,
  codex_cli_version: provenance.execution.codex_cli_version,
});
await writeFile(path.join(outputRoot, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o600 });

const schedule = [];
for (let repetition = 1; repetition <= cli.repetitions; repetition += 1) {
  const fullOrder = repetition % 2 === 1 ? ['r2', 'r3'] : ['r3', 'r2'];
  const taskOrder = cli.tasks ? fullOrder.filter((taskId) => cli.tasks.includes(taskId)) : fullOrder;
  for (const taskId of taskOrder) {
    const aFirst = taskId === 'r2' ? repetition % 2 === 1 : repetition % 2 === 0;
    for (const condition of (aFirst ? ['A', 'B'] : ['B', 'A'])) schedule.push({ repetition, taskId, condition });
  }
}
await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({
  schema_version: 2,
  created_at: new Date().toISOString(),
  repetitions: cli.repetitions,
  conditions: Object.fromEntries(Object.entries(conditions).map(([key, value]) => [key, {
    role: value.label,
    plugin_dir: value.pluginDir,
    subject_hash: subjects[key].hash,
    declared_version: subjects[key].declared_version,
  }])),
  provenance: { A: stampFor('A'), B: stampFor('B') },
  schedule,
}, null, 2)}\n`);

console.log(JSON.stringify({
  provenance: {
    A: { role: 'baseline', version: subjects.A.declared_version, subject_hash: subjects.A.hash.slice(0, 16), dir: subjects.A.root },
    B: { role: 'candidate', version: subjects.B.declared_version, subject_hash: subjects.B.hash.slice(0, 16), dir: subjects.B.root },
    harness_hash: harnessHash.slice(0, 16),
    git_describe: gitState.describe,
    snapshot: snapshotRelative,
  },
}));

if (cli.dryRun) {
  for (const taskId of ['r2', 'r3']) {
    for (const condition of ['A', 'B']) {
      const { scopedDiff } = await prepareFixture(condition, taskId, `dryrun-${taskId}-${condition}`);
      console.log(JSON.stringify({ dry_run_fixture: `${taskId}/${condition}`, diff_bytes: scopedDiff.length }));
    }
  }
  console.log(JSON.stringify({ dry_run: true, output: outputRoot, planned_runs: schedule.length }));
  process.exit(0);
}

for (let index = 0; index < schedule.length; index += 1) {
  if (index + 1 < cli.startAt) continue;
  const item = schedule[index];
  if (cli.only && item.condition !== cli.only) continue;
  const runId = `${String(index + 1).padStart(2, '0')}-${item.taskId}-${item.condition}-rep${item.repetition}`;
  const { runRoot, scopedDiff } = await prepareFixture(item.condition, item.taskId, runId);
  const taskText = (await readFile(path.join(runRoot, 'task.txt'), 'utf8')).trim();
  const prompt = `$akasha ${taskText}`;
  process.stdout.write(`START ${runId} ${new Date().toISOString()}\n`);
  const startedAt = Date.now();
  const execution = await runCommand('codex', [
    'exec', '--json', '--color', 'never',
    '--ignore-user-config', '--ignore-rules',
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
  const layers = scoreRubricLayers(rubricLayers[item.taskId], parsed.finalMessage);
  const quality = layers.task;
  const expectedRoles = [...taskConfig[item.taskId].expectedRoles].sort();
  const contract = validateAkashaReview(parsed.finalMessage, {
    defaultKnowledgeLimit: expectedRoles.length * 2,
    maxKnowledgeLimit: expectedRoles.length * 3,
    maxFindings: 8,
    diffText: scopedDiff,
  });
  const actualRoles = children.map((child) => child.role).filter(Boolean).sort();
  const mentionedKnowledgePaths = [...new Set(children.flatMap((child) => child.knowledge_paths_read))].sort();
  const realKnowledge = await realKnowledgePaths(item.condition);
  const knowledgePaths = mentionedKnowledgePaths.filter((entry) => realKnowledge.has(entry));
  // 트리에 없는데 시도된 경로. 환각·경로 해석 실패의 직접 증거다.
  const unresolvedKnowledgePaths = mentionedKnowledgePaths.filter((entry) => !realKnowledge.has(entry));
  const citedPaths = [...new Set(parsed.finalMessage.match(/(?:\.agents\/)?knowledge\/[a-z0-9_./-]+\.md/giu) ?? [])]
    .map((cited) => cited.replace(/^\.agents\//u, ''));
  const grounded = citedPaths.filter((cited) => knowledgePaths.includes(cited));
  const stderrClasses = classifyStderrLines(execution.stderr);
  const stderrErrorLines = stderrClasses.lines;
  const externalWarningLines = stderrClasses.external;
  const runtimeErrorLines = stderrClasses.runtime;
  const internalErrorLines = stderrClasses.internal;
  // 승격 게이트가 보는 값. CLI 런타임 오류는 측정 대상 밖이므로 여기서 뺀다.
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
    schema_version: 2,
    run_id: runId,
    runtime: 'codex',
    experiment: 'plugin-version-ab',
    task_id: item.taskId,
    condition: item.condition,
    condition_role: conditions[item.condition].label,
    repetition: item.repetition,
    provenance: stampFor(item.condition),
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
    knowledge_paths_unresolved: unresolvedKnowledgePaths,
    knowledge_paths_unresolved_count: unresolvedKnowledgePaths.length,
    // 역할은 떴는데 지식 문서를 하나도 열지 않은 실행. 자식들이 전부 "지식베이스에 근거
    // 없음"을 반환해도 계약은 구조상 유효하므로 조용히 정상 응답이 된다. 별도 축으로 센다.
    knowledge_bypass: actualRoles.length > 0 && knowledgePaths.length === 0,
    cited_knowledge_paths: citedPaths,
    grounded_knowledge_citations: grounded,
    grounded_citation_rate: citedPaths.length ? grounded.length / citedPaths.length : 0,
    quality_score_scope: 'task_rubric_only',
    quality_score_regex: quality.score,
    rubric_items: quality.items,
    contract_score_regex: layers.contract.score,
    contract_rubric_items: layers.contract.items,
    false_positive_guard_score: layers.false_positive.score,
    false_positive_rubric_items: layers.false_positive.items,
    rubric_layer_ids: rubricLayerIds[item.taskId],
    quality_contract_valid: contract.valid,
    quality_contract_errors: contract.errors,
    error_type: errorType,
    infra_invalid: errorType === 'external_dependency',
    internal_errors: internalErrors,
    // CLI 런타임 탓으로 분류해 게이트에서 뺀 건수. 숨기지 않고 별도 축으로 계속 보고한다.
    runtime_errors: runtimeErrorLines.length,
    intermediate_errors: stderrErrorLines.length + parsed.errors.length + children.reduce((sum, child) => sum + child.error_count, 0),
    stderr_error_lines: stderrErrorLines.map(redact),
    external_warning_lines: externalWarningLines.map(redact),
    runtime_error_lines: runtimeErrorLines.map(redact),
    internal_error_lines: internalErrorLines.map(redact),
    final_message: parsed.finalMessage,
    stdout_parse_errors: parsed.errors,
    stderr_excerpt: redact(execution.stderr.slice(0, 3_000)),
    thread_id: parsed.threadId,
    command_argv: ['codex', 'exec', '-m', model, '-C', runRoot],
  };
  await writeFile(path.join(runsRoot, runId, 'stdout.jsonl'), execution.stdout, { mode: 0o600 });
  await writeFile(path.join(runsRoot, runId, 'stderr.txt'), redact(execution.stderr), { mode: 0o600 });
  await writeFile(path.join(runsRoot, runId, 'record.json'), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await appendFile(path.join(outputRoot, 'raw.jsonl'), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  process.stdout.write(`DONE ${runId} exit=${record.exit_code} error=${record.error_type} quality=${record.quality_score_regex.toFixed(3)} contract_valid=${record.quality_contract_valid} tokens=${record.total_usage.total_tokens} wall_ms=${record.wall_ms} roles=${record.actual_roles.join(',')} docs=${record.knowledge_documents_read} unresolved=${record.knowledge_paths_unresolved_count} internal_errors=${record.internal_errors} runtime_errors=${record.runtime_errors}${record.knowledge_bypass ? ' KNOWLEDGE_BYPASS' : ''}\n`);
  if (record.infra_invalid || record.timed_out) {
    process.stdout.write(`ABORT ${record.error_type} ${runId}\n`);
    break;
  }
}
