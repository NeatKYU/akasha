import assert from 'node:assert/strict';
import { analyzeRecords } from './analyze-model-routing-eval.mjs';
import { analyzeAkashaRouting } from './analyze-akasha-routing-ab.mjs';
import { classifyError, scoreText } from './model-routing-lib.mjs';

const task = { rubric: [{ id: 'a', all_of: ['부모', '상속'] }, { id: 'b', all_of: ['자동', '아닙'] }, { id: 'c', none_of: ['무조건 위반'] }] };
assert.equal(scoreText(task, '부모 설정을 상속하며 자동 변경은 아닙니다.').score, 1);
assert.equal(scoreText(task, '부모 설정을 상속하며 자동 변경은 아닙니다. 무조건 위반').score, 2 / 3);
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
    passingRows.push({ task_id: taskId, condition: 'inherit', infra_invalid: false, exact_roles: true, exact_models: true, quality_score_regex: 1, total_usage: { total_tokens: 100 }, wall_ms: 1000, estimated_api_cost_usd: 1, internal_errors: 0 });
    passingRows.push({ task_id: taskId, condition: 'routed', infra_invalid: false, exact_roles: true, exact_models: true, quality_score_regex: 0.98, total_usage: { total_tokens: 85 }, wall_ms: 1000, estimated_api_cost_usd: 1, internal_errors: 0 });
  }
}
const promoted = analyzeAkashaRouting(passingRows);
assert.equal(promoted.decision, 'promote');
assert.equal(promoted.tasks.r2.decision, 'promote');
const unsafeRows = passingRows.map((row, index) => index === 1 ? { ...row, internal_errors: 1 } : row);
assert.equal(analyzeAkashaRouting(unsafeRows).tasks.r2.decision_reason, 'safety_gate');
const belowQuality = passingRows.map((row) => row.condition === 'routed' ? { ...row, quality_score_regex: 0.97996 } : row);
assert.equal(analyzeAkashaRouting(belowQuality).tasks.r2.decision_reason, 'quality_gate');
const belowEfficiency = passingRows.map((row) => row.condition === 'routed' ? { ...row, total_usage: { total_tokens: 85.005 }, quality_score_regex: 0.98 } : row);
assert.equal(analyzeAkashaRouting(belowEfficiency).tasks.r2.decision_reason, 'efficiency_gate');
console.log('model-routing eval tests passed');
