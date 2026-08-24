import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('usage: node analyze-codex-ab.mjs ROOT');
const artifacts = path.join(root, 'artifacts');

function mean(values) {
  return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 4) {
  return value === null ? null : Number(value.toFixed(digits));
}

function normalize(record) {
  const stderrLines = String(record.stderr_excerpt ?? '').split('\n');
  const cacheWarnings = (record.stderr_error_lines ?? []).filter((line) => /codex_models_manager::manager/iu.test(line));
  const externalWarnings = (record.stderr_error_lines ?? []).filter((line) => /503 Service Unavailable|connection reset|rate.?limit/iu.test(line));
  const childErrors = record.children.reduce((sum, child) => sum + (child.error_count ?? 0), 0);
  const parseErrors = record.stdout_parse_errors?.length ?? 0;
  const successful = record.exit_code === 0 && Boolean(record.final_message);
  return {
    ...record,
    successful,
    infra_invalid: !successful && /503 Service Unavailable|connection reset|rate.?limit|usage limit/iu.test(stderrLines.join('\n')),
    normalized_error_type: successful ? (record.quality_score_regex < 1 ? 'quality_gate' : 'none') : record.error_type,
    cli_model_cache_warnings: cacheWarnings.length,
    external_warnings: externalWarnings.length,
    orchestration_internal_errors: childErrors + parseErrors,
  };
}

function summarize(rows) {
  return {
    runs: rows.length,
    quality_regex_mean: round(mean(rows.map((row) => row.quality_score_regex))),
    tokens_p50: median(rows.map((row) => row.total_usage.total_tokens)),
    tokens_total: rows.reduce((sum, row) => sum + row.total_usage.total_tokens, 0),
    input_tokens_total: rows.reduce((sum, row) => sum + row.total_usage.input_tokens, 0),
    cached_input_tokens_total: rows.reduce((sum, row) => sum + row.total_usage.cached_input_tokens, 0),
    output_tokens_total: rows.reduce((sum, row) => sum + row.total_usage.output_tokens, 0),
    reasoning_tokens_total: rows.reduce((sum, row) => sum + row.total_usage.reasoning_output_tokens, 0),
    wall_ms_p50: median(rows.map((row) => row.wall_ms)),
    wall_ms_total: rows.reduce((sum, row) => sum + row.wall_ms, 0),
    estimated_cost_usd_total: round(rows.reduce((sum, row) => sum + (row.estimated_api_cost_usd ?? 0), 0), 6),
    exact_roles_rate: round(mean(rows.map((row) => Number(row.exact_roles)))),
    exact_models_rate: round(mean(rows.map((row) => Number(row.exact_models)))),
    knowledge_documents_read_mean: round(mean(rows.map((row) => row.knowledge_documents_read))),
    knowledge_documents_read_total: rows.reduce((sum, row) => sum + row.knowledge_documents_read, 0),
    grounded_citation_rate_mean: round(mean(rows.map((row) => row.grounded_citation_rate))),
    orchestration_internal_errors: rows.reduce((sum, row) => sum + row.orchestration_internal_errors, 0),
    cli_model_cache_warnings: rows.reduce((sum, row) => sum + row.cli_model_cache_warnings, 0),
    external_warnings: rows.reduce((sum, row) => sum + row.external_warnings, 0),
  };
}

function delta(a, b) {
  const percent = (baseline, candidate) => round(((candidate / baseline) - 1) * 100, 2);
  return {
    quality_regex_points: round((b.quality_regex_mean - a.quality_regex_mean) * 100, 2),
    tokens_p50_percent: percent(a.tokens_p50, b.tokens_p50),
    tokens_total_percent: percent(a.tokens_total, b.tokens_total),
    wall_p50_percent: percent(a.wall_ms_p50, b.wall_ms_p50),
    wall_total_percent: percent(a.wall_ms_total, b.wall_ms_total),
    cost_total_percent: percent(a.estimated_cost_usd_total, b.estimated_cost_usd_total),
    knowledge_documents_percent: percent(a.knowledge_documents_read_total, b.knowledge_documents_read_total),
  };
}

const raw = (await readFile(path.join(artifacts, 'raw.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
const byRunId = new Map();
for (const record of raw) byRunId.set(record.run_id, record);
const records = [...byRunId.values()].map(normalize).sort((a, b) => a.run_id.localeCompare(b.run_id));
await writeFile(path.join(artifacts, 'enriched.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n');

const valid = records.filter((record) => record.successful && !record.infra_invalid);
const summary = {
  schema_version: 1,
  runtime: 'Codex CLI',
  total_records: records.length,
  valid_records: valid.length,
  powered: ['r2', 'r3'].every((taskId) => ['A', 'B'].every((condition) =>
    valid.filter((row) => row.task_id === taskId && row.condition === condition).length >= 3)),
  by_task: {},
  overall: {},
};
for (const taskId of ['r2', 'r3']) {
  const a = summarize(valid.filter((row) => row.task_id === taskId && row.condition === 'A'));
  const b = summarize(valid.filter((row) => row.task_id === taskId && row.condition === 'B'));
  summary.by_task[taskId] = { A: a, B: b, delta: delta(a, b) };
}
const overallA = summarize(valid.filter((row) => row.condition === 'A'));
const overallB = summarize(valid.filter((row) => row.condition === 'B'));
summary.overall = { A: overallA, B: overallB, delta: delta(overallA, overallB) };
await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

const pairs = [];
const key = [];
for (const taskId of ['r2', 'r3']) {
  for (const repetition of [1, 2, 3]) {
    const rows = valid.filter((row) => row.task_id === taskId && row.repetition === repetition);
    if (rows.length !== 2) continue;
    const xCondition = taskId === 'r2'
      ? (repetition === 2 ? 'B' : 'A')
      : (repetition === 2 ? 'A' : 'B');
    const x = rows.find((row) => row.condition === xCondition);
    const y = rows.find((row) => row.condition !== xCondition);
    pairs.push({
      pair_id: `${taskId}-rep${repetition}`,
      task_id: taskId,
      response_x: x.final_message,
      response_y: y.final_message,
    });
    key.push({ pair_id: `${taskId}-rep${repetition}`, x: x.condition, y: y.condition });
  }
}
await writeFile(path.join(artifacts, 'blind-pairs.json'), JSON.stringify(pairs, null, 2) + '\n');
await writeFile(path.join(artifacts, 'blind-key.json'), JSON.stringify(key, null, 2) + '\n', { mode: 0o600 });
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
