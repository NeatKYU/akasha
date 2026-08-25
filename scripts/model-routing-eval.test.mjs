import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeRecords } from './analyze-model-routing-eval.mjs';
import { analyzeAkashaRouting } from './analyze-akasha-routing-ab.mjs';
import { classifyError, classifyStderrLines, CONTRACT_VALIDATOR_VERSION, scoreRubricLayers, scoreText, stderrTracingTarget, validateAkashaReview } from './model-routing-lib.mjs';
import { combineHashes, gitProvenance, hashFiles, hashPluginSubject, hashTree, PLUGIN_READ_DIRS } from './provenance.mjs';
import { assertRuleCoverage, MATCHER_VERSION, scoreResponse } from './akasha-key-scorer.mjs';
import { compareMetric, minimumDetectableEffect, permutationTest } from './analyze-akasha-version-ab.mjs';

const task = { rubric: [{ id: 'a', all_of: ['부모', '상속'] }, { id: 'b', all_of: ['자동', '아닙'] }, { id: 'c', none_of: ['무조건 위반'] }] };
assert.equal(scoreText(task, '부모 설정을 상속하며 자동 변경은 아닙니다.').score, 1);
assert.equal(scoreText(task, '부모 설정을 상속하며 자동 변경은 아닙니다. 무조건 위반').score, 2 / 3);
const qualityContractTask = {
  rubric: [
    { id: 'direct-change', all_of: ['diff_evidence', 'introduced_by_diff'] },
    { id: 'selection', all_of: ['knowledge_selection', 'paths', 'exception'] },
    { id: 'no-false-removal', none_of: ['alertdialog[^\\n]{0,80}(제거|삭제|없애)'] },
  ],
};
assert.equal(
  scoreText(qualityContractTask, 'diff_evidence: button -> div\nchange_status: introduced_by_diff\nknowledge_selection: { paths: [], exception: null }').score,
  1
);
assert.equal(
  scoreText(qualityContractTask, 'alertdialog 속성이 제거됨').score,
  0
);
const validReview = JSON.stringify({
  findings: [{
    classification: '위반',
    location: 'components/Dialog.tsx:10',
    diff_evidence: {
      path: 'components/Dialog.tsx',
      removed_tokens: ['<button>'],
      added_tokens: ['<div>'],
    },
    change_status: 'introduced_by_diff',
    basis: 'keyboard regression',
    knowledge_path: 'knowledge/design/modal-dialog-accessibility.md',
    source_url: 'https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/',
  }],
  knowledge_gaps: [],
  knowledge_selection: { paths: ['knowledge/design/modal-dialog-accessibility.md'], exception: null },
  model_routes: [],
  fallbacks: [],
});
assert.equal(validateAkashaReview(validReview).valid, true);
const validDiff = 'diff --git a/components/Dialog.tsx b/components/Dialog.tsx\n-<button>\n+<div>';
assert.equal(validateAkashaReview(validReview, { diffText: validDiff }).valid, true);
assert.equal(validateAkashaReview(validReview, {
  diffText: 'diff --git a/components/Dialog.tsx b/components/Dialog.tsx\n-<button>\n+<span>',
}).valid, false);
assert.equal(validateAkashaReview(validReview, {
  diffText: 'diff --git a/real/file.ts b/real/file.ts\n-<button>\n+<div>',
}).valid, false);
assert.equal(validateAkashaReview('not-json').valid, false);
assert.equal(validateAkashaReview(JSON.stringify({ ...JSON.parse(validReview), findings: [null] })).valid, false);
assert.equal(validateAkashaReview(JSON.stringify({
  ...JSON.parse(validReview),
  findings: Array.from({ length: 6 }, () => JSON.parse(validReview).findings[0]),
})).valid, false);
assert.equal(validateAkashaReview(JSON.stringify({
  ...JSON.parse(validReview),
  knowledge_selection: {
    paths: ['knowledge/design/modal-dialog-accessibility.md', 'knowledge/b.md', 'knowledge/c.md'],
    exception: null,
  },
})).valid, false);
assert.equal(validateAkashaReview(JSON.stringify({
  ...JSON.parse(validReview),
  knowledge_selection: {
    paths: ['knowledge/design/modal-dialog-accessibility.md', 'knowledge/b.md', 'knowledge/c.md'],
    exception: {
      reason_code: 'independent_high_risk_finding',
      reason: 'separate auth boundary',
      path: 'knowledge/c.md',
    },
  },
})).valid, true);
assert.equal(validateAkashaReview(JSON.stringify({
  ...JSON.parse(validReview),
  knowledge_selection: {
    paths: ['knowledge/design/modal-dialog-accessibility.md', 'knowledge/b.md', 'knowledge/c.md'],
    exception: {
      reason_code: 'independent_high_risk_finding',
      reason: 'separate auth boundary',
      path: 'knowledge/not-selected.md',
    },
  },
})).valid, false);
assert.equal(validateAkashaReview(JSON.stringify({
  ...JSON.parse(validReview),
  findings: [{ ...JSON.parse(validReview).findings[0], change_status: 'not_in_diff' }],
})).valid, false);
assert.equal(classifyError({ timedOut: true, exitCode: 1, stderr: '', stdoutErrors: [], observedModel: null, requestedModel: 'x', qualityScore: 0 }), 'timeout');
assert.equal(classifyError({ timedOut: false, exitCode: 1, stderr: 'model is not available', stdoutErrors: [], observedModel: null, requestedModel: 'x', qualityScore: 0 }), 'unsupported');
assert.equal(classifyError({ timedOut: false, exitCode: 1, stderr: '', stdoutErrors: ["You've hit your usage limit."], observedModel: null, requestedModel: 'x', qualityScore: 0 }), 'external_dependency');
assert.equal(classifyError({ timedOut: false, exitCode: 0, stderr: '', stdoutErrors: [], observedModel: 'y', requestedModel: 'x', qualityScore: 1 }), 'model_mismatch');
assert.equal(classifyError({ timedOut: false, exitCode: 0, stderr: '', stdoutErrors: [], observedModel: 'x', requestedModel: 'x', qualityScore: 0.5 }), 'quality_gate');

function record(id, overrides = {}) {
  return {
    run_id: id,
    lane: 'L1',
    config_id: 'luna-low',
    requested_model: 'gpt-5.6-luna',
    observed_model: 'gpt-5.6-luna',
    requested_effort: 'low',
    usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10, total_tokens: 110 },
    wall_ms: 1000,
    estimated_api_cost_usd: 0.001,
    quality_score: 1,
    first_pass_success: true,
    retry_success: false,
    error_type: 'none',
    infra_invalid: false,
    ...overrides,
  };
}
const ordered = [record('b', { wall_ms: 2000 }), record('a')];
const reversed = [...ordered].reverse();
assert.deepEqual(analyzeRecords(ordered), analyzeRecords(reversed));
assert.equal(analyzeRecords([...ordered, record('infra', { infra_invalid: true, error_type: 'external_dependency' })]).infra_invalid_records, 1);
assert.throws(() => analyzeRecords([record('dup'), record('dup')]), /duplicate/);
assert.throws(() => analyzeRecords([record('missing', { usage: null })]), /usage/);
assert.throws(() => analyzeRecords([record('mismatch', { observed_model: 'gpt-5.5' })]), /mismatch/);

const integration = analyzeAkashaRouting([
  { task_id: 'r2', condition: 'inherit', infra_invalid: false, exact_roles: true, exact_models: true, quality_score_regex: 1, total_usage: { total_tokens: 100 }, wall_ms: 1000, estimated_api_cost_usd: 1, internal_errors: 0 },
  { task_id: 'r2', condition: 'routed', infra_invalid: false, exact_roles: true, exact_models: true, quality_score_regex: 1, total_usage: { total_tokens: 120 }, wall_ms: 1200, estimated_api_cost_usd: 2, internal_errors: 0 },
  { task_id: 'r3', condition: 'inherit', infra_invalid: false, exact_roles: true, exact_models: true, quality_score_regex: 1, total_usage: { total_tokens: 200 }, wall_ms: 2000, estimated_api_cost_usd: 2, internal_errors: 0 },
  { task_id: 'r3', condition: 'routed', infra_invalid: false, exact_roles: true, exact_models: true, quality_score_regex: 0.75, total_usage: { total_tokens: 250 }, wall_ms: 2500, estimated_api_cost_usd: 4, internal_errors: 1 },
]);
assert.equal(integration.decision, 'keep_inherit');
assert.match(integration.decision_reason, /underpowered/);
assert.equal(integration.tasks.r2.delta.tokens_percent, 20);

const passingRows = [];
for (const taskId of ['r2', 'r3']) {
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    passingRows.push({ task_id: taskId, condition: 'inherit', infra_invalid: false, exact_roles: true, exact_models: true, quality_contract_valid: true, quality_score_regex: 1, total_usage: { total_tokens: 100 }, wall_ms: 1000, estimated_api_cost_usd: 1, internal_errors: 0 });
    passingRows.push({ task_id: taskId, condition: 'routed', infra_invalid: false, exact_roles: true, exact_models: true, quality_contract_valid: true, quality_score_regex: 0.98, total_usage: { total_tokens: 85 }, wall_ms: 1000, estimated_api_cost_usd: 1, internal_errors: 0 });
  }
}
const promoted = analyzeAkashaRouting(passingRows);
assert.equal(promoted.decision, 'promote');
assert.equal(promoted.tasks.r2.decision, 'promote');
const unsafeRows = passingRows.map((row, index) => index === 1 ? { ...row, internal_errors: 1 } : row);
assert.equal(analyzeAkashaRouting(unsafeRows).tasks.r2.decision_reason, 'safety_gate');
const invalidContractRows = passingRows.map((row, index) => index === 1 ? { ...row, quality_contract_valid: false } : row);
assert.equal(analyzeAkashaRouting(invalidContractRows).tasks.r2.decision_reason, 'quality_contract_gate');
const belowQuality = passingRows.map((row) => row.condition === 'routed' ? { ...row, quality_score_regex: 0.97996 } : row);
assert.equal(analyzeAkashaRouting(belowQuality).tasks.r2.decision_reason, 'quality_gate');
const belowEfficiency = passingRows.map((row) => row.condition === 'routed' ? { ...row, total_usage: { total_tokens: 85.005 }, quality_score_regex: 0.98 } : row);
assert.equal(analyzeAkashaRouting(belowEfficiency).tasks.r2.decision_reason, 'efficiency_gate');

// --- 채점 레이어 분리: 계약 항목은 과업 품질 점수에 합산되지 않는다 ---
const layeredRubrics = {
  task: [{ id: 'open-control', all_of: ['열기'] }, { id: 'client-boundary', all_of: ['서버'] }],
  contract: [{ id: 'diff-evidence', all_of: ['diff_evidence', 'introduced_by_diff'] }],
  false_positive: [],
};
const contractOnlyText = scoreRubricLayers(layeredRubrics, 'diff_evidence introduced_by_diff');
assert.equal(contractOnlyText.task.score, 0);
assert.equal(contractOnlyText.contract.score, 1);
assert.equal(contractOnlyText.false_positive.score, null);
assert.deepEqual(contractOnlyText.false_positive.items, []);
const taskOnlyText = scoreRubricLayers(layeredRubrics, '열기 상태와 서버 경계');
assert.equal(taskOnlyText.task.score, 1);
assert.equal(taskOnlyText.contract.score, 0);
assert.equal(
  scoreRubricLayers(layeredRubrics, '열기 상태와 서버 경계 diff_evidence introduced_by_diff').task.score,
  taskOnlyText.task.score
);
// 과거 A/B와 같은 정의를 유지하려면 품질 rubric은 tasks.json 항목 수 그대로여야 한다.
const layerTaskCatalog = JSON.parse(await readFile(new URL('../benchmarks/model-routing/tasks.json', import.meta.url), 'utf8'));
assert.equal(layerTaskCatalog.find((item) => item.id === 'l2-dialog-review').rubric.length, 5);
assert.equal(layerTaskCatalog.find((item) => item.id === 'l3-cross-layer-review').rubric.length, 8);

// --- provenance 해시 ---
const provenanceRoot = await mkdtemp(path.join(os.tmpdir(), 'provenance-test-'));
await mkdir(path.join(provenanceRoot, 'nested'), { recursive: true });
await writeFile(path.join(provenanceRoot, 'a.txt'), 'alpha');
await writeFile(path.join(provenanceRoot, 'nested/b.txt'), 'beta');
const firstTree = await hashTree(provenanceRoot);
assert.equal(firstTree.hash, (await hashTree(provenanceRoot)).hash);
assert.equal(firstTree.file_count, 2);
assert.deepEqual(firstTree.files.map((file) => file.path), ['a.txt', 'nested/b.txt']);
await writeFile(path.join(provenanceRoot, 'nested/b.txt'), 'beta!');
assert.notEqual((await hashTree(provenanceRoot)).hash, firstTree.hash);
assert.equal((await hashTree(path.join(provenanceRoot, 'absent'))).exists, false);
assert.deepEqual((await hashFiles(provenanceRoot, ['a.txt', 'absent.txt'])).missing, ['absent.txt']);
assert.equal(combineHashes({ a: '1', b: '2' }), combineHashes({ b: '2', a: '1' }));
assert.notEqual(combineHashes({ a: '1' }), combineHashes({ a: '2' }));
await rm(provenanceRoot, { recursive: true, force: true });
// git status --porcelain 첫 줄의 선행 공백을 지우면 경로 첫 글자가 잘린다(실측 회귀).
const gitFixture = await mkdtemp(path.join(os.tmpdir(), 'provenance-git-'));
const gitRun = (args) => new Promise((resolve, reject) => {
  const child = spawn('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: gitFixture, stdio: 'ignore' });
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} failed`))));
});
await gitRun(['init', '--quiet']);
await writeFile(path.join(gitFixture, 'alpha.txt'), 'one');
await gitRun(['add', '.']);
await gitRun(['commit', '--quiet', '-m', 'init']);
await writeFile(path.join(gitFixture, 'alpha.txt'), 'two');
const fixtureState = await gitProvenance(gitFixture);
assert.equal(fixtureState.dirty_tracked, true);
assert.deepEqual(fixtureState.modified_paths, ['alpha.txt']);
assert.equal(fixtureState.commit?.length, 40);
await writeFile(path.join(gitFixture, 'beta.txt'), 'new');
assert.deepEqual((await gitProvenance(gitFixture)).untracked_paths, ['beta.txt']);
await rm(gitFixture, { recursive: true, force: true });

// --- 플러그인 subject 해시: codex가 읽는 하위 트리만 대상으로 한다 ---
async function makePluginTree(version, knowledgeBody) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plugin-tree-'));
  await mkdir(path.join(root, 'skills/akasha'), { recursive: true });
  await mkdir(path.join(root, 'knowledge/design'), { recursive: true });
  await mkdir(path.join(root, 'agents'), { recursive: true });
  await mkdir(path.join(root, '.claude-plugin'), { recursive: true });
  await writeFile(path.join(root, 'skills/akasha/SKILL.md'), '# skill');
  await writeFile(path.join(root, 'knowledge/design/dialog.md'), knowledgeBody);
  await writeFile(path.join(root, 'agents/akasha-design.md'), '# design');
  await writeFile(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ version }));
  return root;
}
const pluginOld = await makePluginTree('0.14.0', '# dialog');
const pluginRenamed = await makePluginTree('0.15.0', '# dialog');
const pluginChanged = await makePluginTree('0.14.0', '# dialog 규칙 추가');
// 버전 문자열만 다른 트리는 읽는 내용이 같으므로 subject가 같아야 한다.
assert.equal((await hashPluginSubject(pluginOld)).hash, (await hashPluginSubject(pluginRenamed)).hash);
assert.notEqual((await hashTree(pluginOld)).hash, (await hashTree(pluginRenamed)).hash);
// 읽는 지식 문서가 달라지면 subject가 달라져야 한다.
assert.notEqual((await hashPluginSubject(pluginOld)).hash, (await hashPluginSubject(pluginChanged)).hash);
assert.deepEqual((await hashPluginSubject(pluginOld)).read_dirs, ['skills', 'knowledge', 'agents']);
assert.ok(PLUGIN_READ_DIRS.includes('roles'));
for (const root of [pluginOld, pluginRenamed, pluginChanged]) await rm(root, { recursive: true, force: true });

const gitShape = await gitProvenance(new URL('..', import.meta.url).pathname);
assert.equal(typeof gitShape.dirty_tracked, 'boolean');
for (const field of ['commit', 'commit_short', 'branch', 'describe', 'modified_count', 'untracked_count']) {
  assert.ok(field in gitShape, `gitProvenance missing ${field}`);
}

// --- 분석기: provenance 일관성과 레이어 지표 ---
const stamp = { schema_version: 1, subject_hash: 's1', harness_hash: 'h1', fixtures_hash: 'f1', plugin_commit: 'abc1234' };
const stampedRows = passingRows.map((row) => ({
  ...row,
  quality_score_scope: 'task_rubric_only',
  provenance: stamp,
  contract_score_regex: 1,
  false_positive_guard_score: row.task_id === 'r2' ? 1 : null,
}));
const stamped = analyzeAkashaRouting(stampedRows);
assert.equal(stamped.provenance.consistent, true);
assert.equal(stamped.decision, 'promote');
assert.equal(stamped.tasks.r2.routed.contract_regex_mean, 1);
assert.equal(stamped.tasks.r2.routed.false_positive_guard_mean, 1);
assert.equal(stamped.tasks.r3.routed.false_positive_guard_mean, null);
const mixedSubject = stampedRows.map((row, index) => (index === 0 ? { ...row, provenance: { ...stamp, subject_hash: 's2' } } : row));
const mixed = analyzeAkashaRouting(mixedSubject);
assert.equal(mixed.provenance.consistent, false);
assert.deepEqual(mixed.provenance.subject_hashes.sort(), ['s1', 's2']);
assert.equal(mixed.decision, 'keep_inherit');
assert.equal(mixed.decision_reason, 'provenance_gate');
const mixedScope = stampedRows.map((row, index) => (index === 0 ? { ...row, quality_score_scope: 'task_plus_contract' } : row));
assert.equal(analyzeAkashaRouting(mixedScope).decision_reason, 'provenance_gate');
// 스탬프 이전 실행 기록은 게이트를 켜지 않는다.
assert.equal(analyzeAkashaRouting(passingRows).provenance.consistent, null);
assert.equal(analyzeAkashaRouting(passingRows).decision, 'promote');


// --- 역할 축소가 계약을 통과하지 못한다 (실측: 06-r3-B-rep2) ---
const withRoutes = (routes) => JSON.stringify({ ...JSON.parse(validReview), model_routes: routes });
const okRoute = { role: 'qa', mode: 'inherit', model: 'inherited', reasoning_effort: 'inherited', reason: 'E2E 변경', risk_signals: ['flaky'] };
assert.equal(validateAkashaReview(withRoutes([okRoute])).valid, true);
// 여러 역할을 한 항목으로 묶으면 위반
assert.equal(validateAkashaReview(withRoutes([{ ...okRoute, role: 'platform/security/data/backend' }])).valid, false);
assert.match(
  validateAkashaReview(withRoutes([{ ...okRoute, role: 'platform,security' }])).errors.join('\n'),
  /must name exactly one role/
);
// 위험 신호를 적어놓고 실행하지 않으면 위반
assert.match(
  validateAkashaReview(withRoutes([{ ...okRoute, spawned: false }])).errors.join('\n'),
  /declares risk_signals but was not spawned/
);
// 위험 신호 없이 spawn 실패를 보고하는 것은 허용 (모델 라우팅 계약의 역할 누락 보고)
assert.equal(validateAkashaReview(withRoutes([{ ...okRoute, spawned: false, risk_signals: [] }])).valid, true);
assert.equal(validateAkashaReview(withRoutes([null])).valid, false);
assert.equal(validateAkashaReview(withRoutes([{ mode: 'inherit' }])).valid, false);
assert.equal(CONTRACT_VALIDATOR_VERSION, 'akasha-contract-2');

// --- 정답 키 ↔ 채점기 규칙 대조 (r3-K2가 키에만 있고 규칙에 없던 실제 사례) ---
const keyUrl = (name) => new URL(`../benchmarks/model-routing/answer-keys/${name}.json`, import.meta.url);
const r2Keys = JSON.parse(await readFile(keyUrl('r2'), 'utf8'));
const r3Keys = JSON.parse(await readFile(keyUrl('r3'), 'utf8'));
const r3Coverage = assertRuleCoverage('r3', r3Keys);
assert.deepEqual(r3Coverage.missing_rules, []);
assert.deepEqual(r3Coverage.orphan_rules, []);
assert.ok(r3Coverage.scored_keys.includes('r3-K2'));
assert.equal(r3Coverage.scored_keys.length, 8);
assert.equal(assertRuleCoverage('r2', r2Keys).scored_keys.length, 4);
assert.equal(r3Keys.version, 'final-3');
assert.equal(MATCHER_VERSION, 'matcher-3');
assert.throws(
  () => assertRuleCoverage('r3', { ...r3Keys, expected_findings: [...r3Keys.expected_findings, { key_id: 'r3-K9', required: true }] }),
  /r3-K9/
);

// r3-K2: schema.prisma의 @unique 제거를 diff 증거로 확정하면 커버, 증거가 없으면 미커버.
const uniqueFinding = {
  classification: '위반',
  location: 'prisma/schema.prisma:12',
  change_status: 'introduced_by_diff',
  diff_evidence: { path: 'prisma/schema.prisma', removed_tokens: ['ownerId String @unique'], added_tokens: ['ownerId String'] },
  basis: 'owner당 project 중복 허용',
  knowledge_path: 'knowledge/data/unique-constraint-integrity.md',
  source_url: 'https://example.invalid/prisma-unique',
};
const k2Covered = scoreResponse('r3', JSON.stringify({ findings: [uniqueFinding], knowledge_gaps: [] }), r3Keys);
assert.equal(k2Covered.perKey['r3-K2'], true);
assert.equal(k2Covered.perKey['r3-K3'], false);
assert.equal(k2Covered.finding_audit[0].grounding, '적합');
const k2NoEvidence = scoreResponse('r3', JSON.stringify({
  findings: [{ ...uniqueFinding, diff_evidence: { path: 'prisma/schema.prisma', removed_tokens: ['ownerId String'], added_tokens: [] } }],
  knowledge_gaps: [],
}), r3Keys);
assert.equal(k2NoEvidence.perKey['r3-K2'], false);
// final-3: 분류를 따지지 않는다. 근거 문서가 '제거 자체의 위반 단정'을 금지하므로
// `근거 있는 확인`으로 서술해도 확정 효과를 짚었으면 커버다(실측 03·11·14·19).
for (const classification of ['근거 있는 확인', '지식베이스에 근거 없음']) {
  const scored = scoreResponse('r3', JSON.stringify({
    findings: [{ ...uniqueFinding, classification, basis: 'UNIQUE 제거로 중복 ownerId가 허용된다. 의도·migration 근거는 diff에 없다.' }],
    knowledge_gaps: [],
  }), r3Keys);
  assert.equal(scored.perKey['r3-K2'], true, `${classification} 분류도 커버여야 한다`);
}
// 증거는 있으나 확정 효과를 말하지 않으면 미커버 (K3와 구분)
assert.equal(scoreResponse('r3', JSON.stringify({
  findings: [{ ...uniqueFinding, classification: '지식베이스에 근거 없음', basis: '대응 migration 산출물이 없어 적용 여부를 확인할 근거가 부족하다.' }],
  knowledge_gaps: [],
}), r3Keys).perKey['r3-K2'], false);
// 근거 공백(K3)은 별도 축이며 K2와 함께 커버될 수 있다.
const bothAxes = scoreResponse('r3', JSON.stringify({
  findings: [uniqueFinding],
  knowledge_gaps: ['기존 데이터 중복 여부와 migration 계획 근거가 없다'],
}), r3Keys);
assert.equal(bothAxes.perKey['r3-K2'], true);
assert.equal(bothAxes.perKey['r3-K3'], true);

// --- stderr 귀속 분류 ---
// 관측된 codex CLI 버그는 아카샤 탓이 아니므로 게이트에서 빠져야 한다.
const cliBug = [
  '2026-08-24T07:53:55.132862Z ERROR codex_models_manager::manager: failed to renew cache TTL: missing field `supports_parallel_tool_calls` at line 97 column 5',
  '2026-08-24T07:53:59.112117Z ERROR codex_models_manager::manager: failed to load models cache: missing field `supports_parallel_tool_calls` at line 97 column 5',
].join('\n');
const cliOnly = classifyStderrLines(cliBug);
assert.equal(cliOnly.lines.length, 2);
assert.equal(cliOnly.runtime.length, 2);
assert.equal(cliOnly.internal.length, 0);
assert.equal(cliOnly.external.length, 0);

// tracing target 추출
assert.equal(stderrTracingTarget('2026-01-01T00:00:00Z ERROR codex_models_manager::manager: boom'), 'codex_models_manager');
assert.equal(stderrTracingTarget('ERROR some_other_crate::mod: boom'), 'some_other_crate');
assert.equal(stderrTracingTarget('no error line here'), null);

// 목록에 없는 crate는 계속 internal이다 — 새 유형이 조용히 묻히면 안 된다.
const unknownCrate = classifyStderrLines('ERROR codex_core::spawn: failed to start agent thread');
assert.equal(unknownCrate.runtime.length, 0);
assert.equal(unknownCrate.internal.length, 1);

// 오케스트레이션 오류는 target이 없어도 internal로 남는다.
const orchestration = classifyStderrLines('agent thread limit reached');
assert.equal(orchestration.internal.length, 1);
assert.equal(orchestration.runtime.length, 0);

// 전송 계층은 기존대로 external
const transport = classifyStderrLines('ERROR codex_models_manager::manager: 503 Service Unavailable');
assert.equal(transport.external.length, 1);
assert.equal(transport.runtime.length, 0);

// 섞인 stderr에서 세 갈래가 각각 잡힌다.
const mixedStderr = classifyStderrLines([
  'ERROR codex_models_manager::manager: failed to renew cache TTL',
  'ERROR transport: connection reset by peer',
  'internal error: contract validation failed',
  'unrelated info line',
].join('\n'));
assert.equal(mixedStderr.lines.length, 3);
assert.equal(mixedStderr.runtime.length, 1);
assert.equal(mixedStderr.external.length, 1);
assert.equal(mixedStderr.internal.length, 1);

// --- 유의성 검정 ---
// 판정이 이 함수에 걸려 있으므로 값 자체를 고정한다.
// 완전히 겹치는 두 집단은 구분되지 않는다.
assert.equal(permutationTest([5, 5, 5, 5], [5, 5, 5, 5]).p, 1);

// 완전히 분리된 두 집단이라도 n=3+3에서 얻을 수 있는 최소 양측 p는 2/C(6,3)=0.1이다.
// 표본이 작으면 아무리 차이가 커도 0.05 아래로 못 내려간다는 사실을 고정해 둔다.
const separated = permutationTest([1, 2, 3], [10, 11, 12]);
assert.equal(separated.p, 0.1);
assert.equal(separated.exact, true);
assert.equal(separated.method, 'exact_enumeration');

// 표본이 부족하면 p를 만들어내지 않는다.
assert.equal(permutationTest([1], [2]).p, null);
assert.equal(permutationTest([1], [2]).method, 'insufficient_n');

// 결정적이어야 한다 — 같은 입력이면 같은 보고서가 나와야 재현이 성립한다.
const repeatA = [12, 15, 11, 19, 14, 13, 17, 16, 12, 18];
const repeatB = [22, 25, 21, 29, 24, 23, 27, 26, 22, 28];
assert.equal(permutationTest(repeatA, repeatB).p, permutationTest(repeatA, repeatB).p);

// MDE는 분산이 클수록 커진다.
const tight = minimumDetectableEffect([100, 101, 99, 100, 100], [100, 101, 99, 100, 100]);
const loose = minimumDetectableEffect([50, 150, 60, 140, 100], [50, 150, 60, 140, 100]);
assert.ok(loose > tight, 'MDE must grow with variance');

// 관측 차이가 MDE보다 작고 유의하지 않으면 "효과 없음"이 아니라 "판정 불가"다.
const rowsA = repeatA.map((v) => ({ x: v }));
const rowsB = repeatA.map((v) => ({ x: v + 1 }));
const small = compareMetric(rowsA, rowsB, (r) => r.x);
assert.equal(small.significant, false);
assert.equal(small.verdict, 'underpowered');

// 유의하고 감소했으면 improved
const big = compareMetric(repeatB.map((v) => ({ x: v })), repeatA.map((v) => ({ x: v })), (r) => r.x);
assert.equal(big.significant, true);
assert.equal(big.verdict, 'improved');


// --- 실전 세션 inspector ---
// Claude Code 전사 형태(2026-08-25 실측)를 합성해 루트 해석·경로 실재 판정·알림 파싱·도구 경계 지표를 고정한다.
{
  const { buildRecord, loadClaudeSession, parseTaskNotifications, expandShellVars, stripWrapping } = await import('./inspect-akasha-session.mjs');
  assert.equal(expandShellVars('ROOT=/a/b && cat "$ROOT/knowledge/x.md" ${ROOT}/y'), 'ROOT=/a/b && cat "/a/b/knowledge/x.md" /a/b/y');
  assert.equal(expandShellVars('cat ${CLAUDE_PLUGIN_ROOT}/knowledge/x.md'), 'cat ${CLAUDE_PLUGIN_ROOT}/knowledge/x.md');
  const parsed = parseTaskNotifications(['<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<result>x =&gt; y</result>\n<usage><subagent_tokens>12</subagent_tokens><tool_uses>3</tool_uses><duration_ms>40</duration_ms></usage>\n</task-notification>']);
  assert.equal(parsed.get('a1').result, 'x => y');
  assert.equal(parsed.get('a1').tool_uses, 3);
  const wrapped = stripWrapping('[harness: subagent output matched instruction-shaped pattern(s): settings-json. …]\n\n```json\n{"a":1}\n```');
  assert.deepEqual(wrapped, { text: '{"a":1}', harness_prefixed: true, fenced: true });

  const inspectorRoot = await mkdtemp(path.join(os.tmpdir(), 'inspector-test-'));
  const pluginRoot = path.join(inspectorRoot, 'akasha');
  await mkdir(path.join(pluginRoot, 'knowledge', 'qa'), { recursive: true });
  await mkdir(path.join(pluginRoot, 'agents'), { recursive: true });
  await writeFile(path.join(pluginRoot, 'knowledge', 'INDEX.md'), '# index\n');
  await writeFile(path.join(pluginRoot, 'knowledge', 'qa', 'test-isolation.md'), '# doc\n');
  await writeFile(path.join(pluginRoot, 'agents', 'akasha-qa.md'), '---\nname: akasha-qa\n---\n');
  const projectDir = path.join(inspectorRoot, 'projects', 'proj');
  const sessionId = 'sess-1';
  await mkdir(path.join(projectDir, sessionId, 'subagents'), { recursive: true });
  const usage = { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 };
  const stamp = (index) => `2026-08-25T00:00:${String(index).padStart(2, '0')}.000Z`;
  const base = { sessionId, cwd: '/proj', version: '2.1.0', isSidechain: false };
  const assistant = (index, content, id) => ({ ...base, type: 'assistant', timestamp: stamp(index), message: { id, role: 'assistant', model: 'claude-test', usage, content } });
  const user = (index, content, extra = {}) => ({ ...base, type: 'user', timestamp: stamp(index), message: { role: 'user', content }, ...extra });
  const childResult = '```json\n{"findings":[],"knowledge_gaps":[],"knowledge_selection":{"paths":["knowledge/qa/test-isolation.md"],"exception":null}}\n```';
  const notification = `<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<result>${childResult}</result>\n<usage><subagent_tokens>100</subagent_tokens><tool_uses>2</tool_uses><duration_ms>1000</duration_ms></usage>\n</task-notification>`;
  const parentFinal = JSON.stringify({ findings: [], knowledge_gaps: [], knowledge_selection: { paths: ['knowledge/qa/test-isolation.md'], exception: null }, model_routes: [{ role: 'qa', mode: 'inherit', model: 'inherited', reasoning_effort: 'inherited', reason: 'r', risk_signals: [] }], fallbacks: [] });
  const parentLines = [
    user(1, '<command-message>akasha:akasha</command-message>\n<command-name>/akasha:akasha</command-name>\n<command-args>검토</command-args>'),
    user(2, `Base directory for this skill: ${pluginRoot}/skills/akasha\n\n# 아카샤\n1. ${pluginRoot} 가 실제 경로로 치환되어 있으면`),
    assistant(3, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `ROOT=${pluginRoot} && test -f "$ROOT/knowledge/INDEX.md" && test -f "$ROOT/knowledge/qa/runtime-baseline.md"` } }], 'm1'),
    user(4, [{ type: 'tool_result', tool_use_id: 't1', content: 'MISS' }]),
    assistant(5, [{ type: 'tool_use', id: 't1b', name: 'Bash', input: { command: `ls ${pluginRoot}/knowledge/qa/` } }], 'm2'),
    user(6, [{ type: 'tool_result', tool_use_id: 't1b', content: 'test-isolation.md' }]),
    assistant(7, [{ type: 'tool_use', id: 't2', name: 'Agent', input: { subagent_type: 'akasha:akasha-qa', description: 'qa', prompt: 'selected_knowledge_paths:\n- knowledge/qa/test-isolation.md' } }], 'm3'),
    user(8, [{ type: 'tool_result', tool_use_id: 't2', content: 'Async agent launched successfully.' }], { toolUseResult: { status: 'async_launched', agentId: 'a1' } }),
    assistant(9, [{ type: 'tool_use', id: 't3', name: 'Agent', input: { subagent_type: 'akasha:akasha-ai', description: 'ai', prompt: 'selected_knowledge_paths: []' } }], 'm4'),
    user(10, [{ type: 'tool_result', tool_use_id: 't3', content: 'Async agent launched successfully.' }], { toolUseResult: { status: 'async_launched', agentId: 'a2' } }),
    { type: 'system', subtype: 'stop_hook_summary', isSidechain: false, timestamp: stamp(11) },
    { type: 'queue-operation', operation: 'enqueue', timestamp: stamp(12), sessionId, content: notification },
    { type: 'attachment', isSidechain: false, timestamp: stamp(13), attachment: { type: 'queued_command', prompt: notification } },
    assistant(14, [{ type: 'text', text: parentFinal }], 'm5'),
  ];
  await writeFile(path.join(projectDir, `${sessionId}.jsonl`), parentLines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  const child = (agentId, agentType, lines) => Promise.all([
    writeFile(path.join(projectDir, sessionId, 'subagents', `agent-${agentId}.jsonl`), lines.map((line) => JSON.stringify({ ...line, isSidechain: true, agentId })).join('\n') + '\n'),
    writeFile(path.join(projectDir, sessionId, 'subagents', `agent-${agentId}.meta.json`), JSON.stringify({ agentType, description: agentType, spawnDepth: 1 })),
  ]);
  await child('a1', 'akasha:akasha-qa', [
    user(8, 'packet'),
    assistant(9, [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: `${pluginRoot}/knowledge/qa/test-isolation.md` } }], 'c-m1'),
    user(10, [{ type: 'tool_result', tool_use_id: 'c1', content: '# doc' }]),
    assistant(11, [{ type: 'text', text: childResult }], 'c-m2'),
  ]);
  await child('a2', 'akasha:akasha-ai', [
    user(10, 'packet'),
    assistant(11, [{ type: 'tool_use', id: 'c2', name: 'Bash', input: { command: 'git diff' } }], 'c-m3'),
    user(12, [{ type: 'tool_result', tool_use_id: 'c2', content: 'Error: tool Bash is not allowed', is_error: true }]),
    assistant(13, [{ type: 'text', text: 'partial' }], 'c-m4'),
  ]);
  const session = await loadClaudeSession(path.join(projectDir, `${sessionId}.jsonl`));
  const record = await buildRecord(session, { pluginRoot: null, expectRoles: ['ai', 'qa'], condition: 'real', taskId: 'real' });
  assert.equal(record.plugin_root, pluginRoot);
  assert.equal(record.plugin_root_substituted, true);
  assert.equal(record.plugin_root_literal_in_tools, false);
  assert.deepEqual(record.actual_roles, ['ai', 'qa']);
  assert.equal(record.exact_roles, true);
  assert.deepEqual(record.knowledge_paths_read, ['knowledge/qa/test-isolation.md']);
  assert.equal(record.knowledge_bypass, false);
  // 부모가 없는 이름을 시도했고(hallucinated_name), 나열 뒤 실재 이름으로 다시 골랐다(recovered).
  assert.deepEqual(record.knowledge_paths_unresolved, [`${pluginRoot}/knowledge/qa/runtime-baseline.md`]);
  assert.deepEqual(record.unresolved_signatures, { hallucinated_name: 1 });
  assert.equal(record.recovered_after_unresolved, true);
  assert.deepEqual(record.parent_knowledge_paths_read, []);
  assert.equal(record.parent_calls_before_first_spawn, 2);
  // 알림이 없는 spawn 은 끝나지 않은 자식이다.
  assert.equal(record.run_complete, false);
  assert.deepEqual(record.spawn_failures, [{ agent_type: 'akasha:akasha-ai', status: 'launched_no_result', error: null }]);
  assert.equal(record.spawns[0].status, 'completed');
  assert.equal(record.spawns[0].duration_ms, 1000);
  // 도구 경계: 시도했고 거부됐으면 held(tested). 시도가 없으면 untested.
  assert.equal(record.tool_boundary_tested, true);
  assert.equal(record.tool_boundary_held, true);
  assert.deepEqual(record.tool_boundary_violations, []);
  assert.equal(record.runtime_errors, 1);
  assert.equal(record.stop_hook_runs, 1);
  assert.equal(record.quality_contract_valid, true);
  const qaChild = record.children.find((row) => row.role === 'qa');
  assert.equal(qaChild.completed, true);
  assert.equal(qaChild.contract_valid, false);
  assert.equal(qaChild.contract_valid_lenient, true);
  assert.equal(qaChild.output_fenced, true);
  assert.equal(record.child_contract_valid_lenient_count, 1);
  assert.equal(record.total_usage.input_tokens, record.root_usage.input_tokens + qaChild.usage.input_tokens + record.children.find((row) => row.role === 'ai').usage.input_tokens);
  await rm(inspectorRoot, { recursive: true, force: true });
}

console.log('model-routing eval tests passed');
