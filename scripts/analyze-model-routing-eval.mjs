import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ERROR_TYPES, percentile } from './model-routing-lib.mjs';

function parseArgs(argv) {
  const args = { input: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') args.input = argv[++index];
    else if (argv[index] === '--output') args.output = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!args.input) throw new Error('--input is required');
  return args;
}

function round(value, digits = 6) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(value.toFixed(digits));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rng(seed = 0x5a17) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function bootstrapMean(values, samples = 1000) {
  if (!values.length) return [null, null];
  const random = rng();
  const means = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const selected = [];
    for (let index = 0; index < values.length; index += 1) selected.push(values[Math.floor(random() * values.length)]);
    means.push(mean(selected));
  }
  return [round(percentile(means, 0.025)), round(percentile(means, 0.975))];
}

export function analyzeRecords(records) {
  const ids = new Set();
  for (const record of records) {
    if (!record.run_id || ids.has(record.run_id)) throw new Error(`duplicate or missing run_id: ${record.run_id}`);
    ids.add(record.run_id);
    if (!ERROR_TYPES.has(record.error_type)) throw new Error(`invalid error_type: ${record.error_type}`);
    if (!record.usage || !Number.isFinite(record.usage.total_tokens) || record.usage.total_tokens < 0) throw new Error(`missing or invalid usage: ${record.run_id}`);
    if (record.observed_model && record.observed_model !== record.requested_model) throw new Error(`model mismatch: ${record.run_id}`);
  }
  const valid = records.filter((record) => !record.infra_invalid);
  const groups = new Map();
  for (const record of valid) {
    const key = `${record.lane}\u0000${record.config_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const summaries = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => a.run_id.localeCompare(b.run_id));
    const [lane, configId] = key.split('\u0000');
    const qualities = group.map((record) => record.quality_score);
    const tokens = group.map((record) => record.usage.total_tokens);
    const wall = group.map((record) => record.wall_ms);
    const costs = group.map((record) => record.estimated_api_cost_usd).filter(Number.isFinite);
    const [qualityLow, qualityHigh] = bootstrapMean(qualities);
    summaries.push({
      lane,
      config_id: configId,
      model: group[0].requested_model,
      effort: group[0].requested_effort,
      runs: group.length,
      first_pass_success_rate: round(group.filter((record) => record.first_pass_success).length / group.length),
      confirmed_failure_rate: round(group.filter((record) => !record.first_pass_success && !record.retry_success).length / group.length),
      quality_mean: round(mean(qualities)),
      quality_ci95: [qualityLow, qualityHigh],
      tokens_p50: percentile(tokens, 0.5),
      tokens_p90: percentile(tokens, 0.9),
      wall_ms_p50: percentile(wall, 0.5),
      wall_ms_p90: percentile(wall, 0.9),
      cost_usd_p50: round(percentile(costs, 0.5)),
      error_counts: Object.fromEntries([...ERROR_TYPES].map((type) => [type, group.filter((record) => record.error_type === type).length])),
      hard_gate_passed: group.every((record) => ['none', 'quality_gate'].includes(record.error_type)) && mean(qualities) >= 0.95,
    });
  }
  summaries.sort((a, b) => a.lane.localeCompare(b.lane) || b.hard_gate_passed - a.hard_gate_passed || b.quality_mean - a.quality_mean || a.cost_usd_p50 - b.cost_usd_p50 || a.config_id.localeCompare(b.config_id));
  return {
    schema_version: 1,
    total_records: records.length,
    infra_invalid_records: records.length - valid.length,
    summaries,
    winners: ['L1', 'L2', 'L3'].map((lane) => summaries.find((summary) => summary.lane === lane && summary.hard_gate_passed) ?? null),
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const cli = parseArgs(process.argv.slice(2));
  const lines = (await readFile(cli.input, 'utf8')).split('\n').filter(Boolean);
  const result = analyzeRecords(lines.map((line) => JSON.parse(line)));
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (cli.output) await writeFile(path.resolve(cli.output), output);
  process.stdout.write(output);
}
