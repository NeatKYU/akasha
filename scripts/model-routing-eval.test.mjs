import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeRecords } from './analyze-model-routing-eval.mjs';
import { analyzeAkashaRouting } from './analyze-akasha-routing-ab.mjs';
import { classifyError, scoreRubricLayers, scoreText, validateAkashaReview } from './model-routing-lib.mjs';
import { combineHashes, gitProvenance, hashFiles, hashPluginSubject, hashTree, PLUGIN_READ_DIRS } from './provenance.mjs';
import { assertRuleCoverage, MATCHER_VERSION, scoreResponse } from './akasha-key-scorer.mjs';

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

console.log('model-routing eval tests passed');
