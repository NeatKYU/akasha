import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { percentile } from './model-routing-lib.mjs';

function round(value, digits = 4) {
  return value === null ? null : Number(value.toFixed(digits));
}

function meanValue(rows, key) {
  return rows.reduce((sum, row) => sum + key(row), 0) / rows.length;
}

function summarize(rows) {
  if (rows.length === 0) return null;
  const mean = (key) => rows.reduce((sum, row) => sum + key(row), 0) / rows.length;
  return {
    runs: rows.length,
    exact_roles_rate: round(mean((row) => Number(row.exact_roles))),
    exact_models_rate: round(mean((row) => Number(row.exact_models))),
    quality_mean: round(mean((row) => row.quality_score_regex)),
    tokens_p50: percentile(rows.map((row) => row.total_usage.total_tokens), 0.5),
    wall_ms_p50: percentile(rows.map((row) => row.wall_ms), 0.5),
    estimated_api_cost_usd_p50: round(percentile(rows.map((row) => row.estimated_api_cost_usd), 0.5), 6),
    internal_errors: rows.reduce((sum, row) => sum + row.internal_errors, 0),
  };
}

export function analyzeAkashaRouting(records) {
  const isInfraInvalid = (row) => row.infra_invalid === true
    || (row.exit_code !== 0 && (row.total_usage?.total_tokens ?? 0) === 0 && row.final_message === '');
  const valid = records.filter((row) => !isInfraInvalid(row));
  const result = {
    schema_version: 1,
    total_records: records.length,
    infra_invalid_records: records.length - valid.length,
    tasks: {},
    decision: 'keep_inherit',
    decision_reason: null,
  };
  for (const taskId of ['r2', 'r3']) {
    const inherit = valid.filter((row) => row.task_id === taskId && row.condition === 'inherit');
    const routed = valid.filter((row) => row.task_id === taskId && row.condition === 'routed');
    const baseline = summarize(inherit);
    const candidate = summarize(routed);
    result.tasks[taskId] = { inherit: baseline, routed: candidate, delta: null, decision: 'keep_inherit', decision_reason: null };
    if (baseline && candidate) {
      result.tasks[taskId].delta = {
        quality_points: round((candidate.quality_mean - baseline.quality_mean) * 100, 2),
        tokens_percent: round(((candidate.tokens_p50 / baseline.tokens_p50) - 1) * 100, 2),
        wall_percent: round(((candidate.wall_ms_p50 / baseline.wall_ms_p50) - 1) * 100, 2),
        cost_percent: round(((candidate.estimated_api_cost_usd_p50 / baseline.estimated_api_cost_usd_p50) - 1) * 100, 2),
      };
    }
    const task = result.tasks[taskId];
    const powered = baseline?.runs >= 3 && candidate?.runs >= 3;
    const safe = candidate?.internal_errors === 0 && candidate?.exact_models_rate === 1 && candidate?.exact_roles_rate === 1;
    const baselineQualityRaw = inherit.length ? meanValue(inherit, (row) => row.quality_score_regex) : null;
    const candidateQualityRaw = routed.length ? meanValue(routed, (row) => row.quality_score_regex) : null;
    const qualityPass = baselineQualityRaw !== null && candidateQualityRaw !== null
      && candidateQualityRaw >= baselineQualityRaw * 0.98;
    const rawEfficiencyChanges = baseline && candidate ? [
      ((percentile(routed.map((row) => row.total_usage.total_tokens), 0.5) / percentile(inherit.map((row) => row.total_usage.total_tokens), 0.5)) - 1) * 100,
      ((percentile(routed.map((row) => row.wall_ms), 0.5) / percentile(inherit.map((row) => row.wall_ms), 0.5)) - 1) * 100,
      ((percentile(routed.map((row) => row.estimated_api_cost_usd), 0.5) / percentile(inherit.map((row) => row.estimated_api_cost_usd), 0.5)) - 1) * 100,
    ] : [];
    const efficiencyPass = rawEfficiencyChanges.some((value) => value <= -15);
    if (!powered) task.decision_reason = 'underpowered';
    else if (!safe) task.decision_reason = 'safety_gate';
    else if (!qualityPass) task.decision_reason = 'quality_gate';
    else if (!efficiencyPass) task.decision_reason = 'efficiency_gate';
    else {
      task.decision = 'promote';
      task.decision_reason = 'all_gates_passed';
    }
  }
  const decisions = Object.values(result.tasks).map((task) => task.decision);
  if (decisions.every((decision) => decision === 'promote')) {
    result.decision = 'promote';
    result.decision_reason = 'all_tasks_passed';
  } else if (decisions.some((decision) => decision === 'promote')) {
    result.decision = 'partial_promote';
    result.decision_reason = 'only_selected_tasks_passed';
  } else {
    result.decision_reason = Object.values(result.tasks).map((task) => `${task.decision_reason}`).join(',');
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const inputIndex = process.argv.indexOf('--input');
  const outputIndex = process.argv.indexOf('--output');
  if (inputIndex < 0) throw new Error('--input is required');
  const records = (await readFile(process.argv[inputIndex + 1], 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  const summary = analyzeAkashaRouting(records);
  const rendered = `${JSON.stringify(summary, null, 2)}\n`;
  if (outputIndex >= 0) await writeFile(process.argv[outputIndex + 1], rendered);
  else process.stdout.write(rendered);
}
