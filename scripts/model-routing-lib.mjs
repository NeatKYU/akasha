import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const ERROR_TYPES = new Set([
  'none',
  'unsupported',
  'runner_config',
  'model_mismatch',
  'orchestration_internal',
  'external_dependency',
  'timeout',
  'quality_gate',
]);

export function scoreText(task, text) {
  const items = task.rubric.map((item) => {
    const required = item.all_of ?? [];
    const forbidden = item.none_of ?? [];
    const passed = required.every((pattern) => new RegExp(pattern, 'iu').test(text))
      && forbidden.every((pattern) => !new RegExp(pattern, 'iu').test(text));
    return { id: item.id, passed };
  });
  return { items, score: items.filter((item) => item.passed).length / items.length };
}

export function classifyError({ timedOut, exitCode, stderr, stdoutErrors, observedModel, requestedModel, qualityScore }) {
  if (timedOut) return 'timeout';
  const combined = `${stderr}\n${stdoutErrors.join('\n')}`;
  if (/model.*(not found|unsupported|not available|does not exist)|unsupported.*model/iu.test(combined)) return 'unsupported';
  if (/rate.?limit|usage limit|service unavailable|overloaded|connection reset/iu.test(combined)) return 'external_dependency';
  if (exitCode !== 0 && /config|invalid value|unknown option|argument/iu.test(combined)) return 'runner_config';
  if (exitCode !== 0 || stdoutErrors.length > 0 || /internal error|agent thread limit|timeout_ms/iu.test(combined)) return 'orchestration_internal';
  if (observedModel && observedModel !== requestedModel) return 'model_mismatch';
  if (qualityScore < 1) return 'quality_gate';
  return 'none';
}

export function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

export function estimateCost(usage, price) {
  if (!usage || !price) return null;
  const uncached = Math.max(0, usage.input_tokens - usage.cached_input_tokens);
  return ((uncached * price.input) + (usage.cached_input_tokens * price.cached_input) + (usage.output_tokens * price.output)) / 1_000_000;
}

export async function findSessionObservation(sessionRoot, threadId) {
  if (!threadId) return { model: null, effort: null, sessionFile: null };
  const files = [];
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.name.includes(threadId) && entry.name.endsWith('.jsonl')) files.push(fullPath);
    }
  }
  await walk(sessionRoot);
  if (files.length !== 1) return { model: null, effort: null, sessionFile: files[0] ?? null };
  let model = null;
  let effort = null;
  for (const line of (await readFile(files[0], 'utf8')).split('\n')) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'turn_context') {
        model = event.payload?.model ?? model;
        effort = event.payload?.effort ?? event.payload?.reasoning_effort ?? effort;
      }
    } catch {}
  }
  return { model, effort, sessionFile: files[0] };
}

export function parseCodexJsonl(stdout) {
  const events = [];
  const errors = [];
  let threadId = null;
  let usage = null;
  let finalMessage = '';
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      events.push(event);
      if (event.type === 'thread.started') threadId = event.thread_id;
      if (event.type === 'turn.completed' && event.usage) {
        usage = {
          ...event.usage,
          total_tokens: event.usage.input_tokens + event.usage.output_tokens,
        };
      }
      if (event.type === 'error') errors.push(event.message ?? JSON.stringify(event));
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') finalMessage = event.item.text ?? finalMessage;
    } catch (error) {
      errors.push(`invalid-jsonl:${error.message}`);
    }
  }
  return { events, errors, threadId, usage, finalMessage };
}
