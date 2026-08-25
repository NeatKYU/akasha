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

// scorer 규칙 버전. provenance에 기록되며, 규칙을 바꾸면 함께 올린다.
export const REGEX_SCORER_VERSION = 'regex-rubric-1';
export const CONTRACT_VALIDATOR_VERSION = 'akasha-contract-2';
export const STDERR_CLASSIFIER_VERSION = 'stderr-attribution-1';

// stderr의 ERROR 줄을 "누구 탓인가"로 나눈다. 승격 게이트가 `internal_errors === 0`을 요구하므로
// 귀속이 틀리면 게이트가 측정 대상과 무관한 이유로 영구히 닫힌다. 실제로 codex CLI의
// `failed to renew cache TTL: missing field supports_parallel_tool_calls`가 배치마다 수십 건씩
// 잡혀 아카샤 탓으로 집계되고 있었다.
//
// 분류 기준은 메시지 문구가 아니라 발신 주체다. 문구를 계속 덧붙이는 방식은 진짜 오류까지
// 가릴 수 있다. Rust tracing 형식(`<ts> ERROR <crate>::<module>: <msg>`)의 crate 이름으로
// CLI 자체 subsystem을 식별한다.
const STDERR_ERROR_LINE = /\bERROR\b|internal error|thread limit/iu;
// 전송·서비스 계층. 원본을 보존한 채 infra_invalid로 빼는 기존 축이다.
const STDERR_EXTERNAL = /503 Service Unavailable|connection reset|rate.?limit/iu;
const TRACING_TARGET = /\bERROR\s+([a-z][a-z0-9_]*)(?:::[a-z0-9_:]+)?:/iu;

// CLI 런타임 자체의 하위 시스템. 관측된 것만 넣는다. 목록에 없는 crate는 계속 internal로
// 집계되므로, 새 유형이 나오면 조용히 묻히지 않고 게이트에서 드러나 판단을 강제한다.
export const RUNTIME_ERROR_TARGETS = new Set(['codex_models_manager']);

export function stderrTracingTarget(line) {
  const match = line.match(TRACING_TARGET);
  return match ? match[1].toLowerCase() : null;
}

export function classifyStderrLines(stderr) {
  const lines = (stderr ?? '').split('\n').filter((line) => STDERR_ERROR_LINE.test(line));
  const external = [];
  const runtime = [];
  const internal = [];
  for (const line of lines) {
    if (STDERR_EXTERNAL.test(line)) external.push(line);
    else if (RUNTIME_ERROR_TARGETS.has(stderrTracingTarget(line))) runtime.push(line);
    else internal.push(line);
  }
  return { lines, external, runtime, internal };
}

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

// 과업 품질과 계약 준수는 다른 축이므로 한 점수로 합산하지 않는다. rubric을 레이어별로
// 따로 채점해서, 어느 레이어가 움직였는지 사후에 분리할 수 있게 한다.
// 항목이 없는 레이어는 0/0을 0점으로 만들지 않고 score를 null로 둔다.
export function scoreRubricLayers(layers, text) {
  return Object.fromEntries(Object.entries(layers).map(([name, rubric]) => [
    name,
    rubric.length === 0 ? { items: [], score: null } : scoreText({ rubric }, text),
  ]));
}

const REVIEW_CLASSIFICATIONS = new Set(['위반', '근거 있는 확인', '지식베이스에 근거 없음']);
const CHANGE_STATUSES = new Set(['introduced_by_diff', 'pre_existing', 'not_in_diff', 'ambiguous', 'not_applicable']);
const REQUIRED_FINDING_FIELDS = [
  'classification', 'location', 'diff_evidence', 'change_status', 'basis', 'knowledge_path', 'source_url'
];

export function validateAkashaReview(text, {
  codeReview = true,
  requireParentFields = true,
  defaultKnowledgeLimit = 2,
  maxKnowledgeLimit = 3,
  maxFindings = 5,
  maxKnowledgeGaps = 3,
  diffText = null,
} = {}) {
  const errors = [];
  let value = null;
  try { value = JSON.parse(text); } catch (error) {
    return { valid: false, errors: [`invalid-json: ${error.message}`], value: null };
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') errors.push('response must be one JSON object');
  for (const field of ['findings', 'knowledge_gaps']) {
    if (!Array.isArray(value?.[field])) errors.push(`${field} must be an array`);
  }
  if (Array.isArray(value?.findings) && value.findings.length > maxFindings) {
    errors.push(`findings must contain at most ${maxFindings} items`);
  }
  if (Array.isArray(value?.knowledge_gaps) && value.knowledge_gaps.length > maxKnowledgeGaps) {
    errors.push(`knowledge_gaps must contain at most ${maxKnowledgeGaps} items`);
  }
  if (!value?.knowledge_selection || !Array.isArray(value.knowledge_selection.paths)) {
    errors.push('knowledge_selection.paths must be an array');
  }
  if (value?.knowledge_selection && !Object.hasOwn(value.knowledge_selection, 'exception')) {
    errors.push('knowledge_selection.exception is required');
  }
  const selectedPaths = value?.knowledge_selection?.paths;
  const selectionException = value?.knowledge_selection?.exception;
  if (Array.isArray(selectedPaths)) {
    if (new Set(selectedPaths).size !== selectedPaths.length) errors.push('knowledge_selection.paths must be unique');
    for (const selectedPath of selectedPaths) {
      if (typeof selectedPath !== 'string' || !selectedPath.startsWith('knowledge/')) {
        errors.push('knowledge_selection.paths must be plugin-root-relative knowledge/ paths');
      }
    }
    if (selectedPaths.length > maxKnowledgeLimit) {
      errors.push(`knowledge_selection.paths exceeds maximum ${maxKnowledgeLimit}`);
    }
    if (selectedPaths.length > defaultKnowledgeLimit) {
      if (!selectionException || typeof selectionException !== 'object' || Array.isArray(selectionException)) {
        errors.push('knowledge_selection.exception is required above the default limit');
      } else {
        for (const field of ['reason_code', 'reason', 'path']) {
          if (!selectionException[field]) errors.push(`knowledge_selection.exception.${field} is required`);
        }
        if (typeof selectionException.path !== 'string' || !selectionException.path.startsWith('knowledge/')) {
          errors.push('knowledge_selection.exception.path must be a plugin-root-relative knowledge/ path');
        } else if (!selectedPaths.includes(selectionException.path)) {
          errors.push('knowledge_selection.exception.path must identify a selected path');
        }
      }
    } else if (selectionException !== null) {
      errors.push('knowledge_selection.exception must be null within the default limit');
    }
  }
  if (requireParentFields) {
    if (!Array.isArray(value?.model_routes)) errors.push('model_routes must be an array');
    if (!Array.isArray(value?.fallbacks)) errors.push('fallbacks must be an array');
  }
  // 역할 축소가 조용히 통과하지 못하게 한다. 실측 사례: 부모가 4개 역할을 한 항목으로 묶고
  // spawned:false로 처리해 5역할 과업을 1역할로 줄였는데 exit 0 + 계약 유효로 통과했다.
  for (const [index, route] of (Array.isArray(value?.model_routes) ? value.model_routes : []).entries()) {
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      errors.push(`model_routes[${index}] must be an object`);
      continue;
    }
    if (typeof route.role !== 'string' || route.role.length === 0) {
      errors.push(`model_routes[${index}].role must be a non-empty string`);
    } else if (/[/,]/u.test(route.role)) {
      errors.push(`model_routes[${index}].role must name exactly one role: ${route.role}`);
    }
    if (route.spawned === false && Array.isArray(route.risk_signals) && route.risk_signals.length > 0) {
      errors.push(`model_routes[${index}] declares risk_signals but was not spawned: ${route.role}`);
    }
  }
  const diffByPath = new Map();
  let currentDiffPath = null;
  for (const line of diffText?.split('\n') ?? []) {
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (header) {
      currentDiffPath = header[2];
      diffByPath.set(currentDiffPath, { removed: [], added: [] });
      continue;
    }
    if (!currentDiffPath) continue;
    if (line.startsWith('-') && !line.startsWith('---')) diffByPath.get(currentDiffPath).removed.push(line);
    if (line.startsWith('+') && !line.startsWith('+++')) diffByPath.get(currentDiffPath).added.push(line);
  }
  for (const [index, finding] of (value?.findings ?? []).entries()) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
      errors.push(`findings[${index}] must be an object`);
      continue;
    }
    for (const field of REQUIRED_FINDING_FIELDS) {
      if (!Object.hasOwn(finding, field)) errors.push(`findings[${index}].${field} is required`);
    }
    if (!REVIEW_CLASSIFICATIONS.has(finding.classification)) {
      errors.push(`findings[${index}].classification is invalid`);
    }
    if (!CHANGE_STATUSES.has(finding.change_status)) errors.push(`findings[${index}].change_status is invalid`);
    if (finding.knowledge_path !== null
      && (typeof finding.knowledge_path !== 'string' || !finding.knowledge_path.startsWith('knowledge/')))
      errors.push(`findings[${index}].knowledge_path must be null or a plugin-root-relative knowledge/ path`);
    if (finding.knowledge_path !== null && Array.isArray(selectedPaths) && !selectedPaths.includes(finding.knowledge_path)) {
      errors.push(`findings[${index}].knowledge_path was not selected`);
    }
    const evidence = finding.diff_evidence;
    if (evidence !== null) {
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
        errors.push(`findings[${index}].diff_evidence must be an object or null`);
      } else {
        if (!evidence.path || typeof evidence.path !== 'string') {
          errors.push(`findings[${index}].diff_evidence.path is required`);
        } else if (diffText !== null && !diffByPath.has(evidence.path)) {
          errors.push(`findings[${index}].diff_evidence.path is absent from scoped diff`);
        }
        for (const field of ['removed_tokens', 'added_tokens']) {
          if (!Array.isArray(evidence[field])) errors.push(`findings[${index}].diff_evidence.${field} must be an array`);
          else for (const token of evidence[field]) {
            const fileDiff = diffByPath.get(evidence.path);
            const relevantLines = field === 'removed_tokens' ? fileDiff?.removed ?? [] : fileDiff?.added ?? [];
            if (typeof token !== 'string' || token.length === 0 || token.includes('\n')) {
              errors.push(`findings[${index}].diff_evidence.${field} must contain non-empty single-line tokens`);
            } else if (token.length > 80) {
              errors.push(`findings[${index}].diff_evidence.${field} token exceeds 80 characters`);
            } else if (diffText !== null && !relevantLines.some((line) => line.includes(token))) {
              errors.push(`findings[${index}].diff_evidence token is absent from scoped diff: ${token}`);
            }
          }
        }
      }
    }
    if (codeReview && finding.classification === '위반'
      && (finding.change_status !== 'introduced_by_diff' || !evidence
        || ((evidence.removed_tokens?.length ?? 0) + (evidence.added_tokens?.length ?? 0) === 0))) {
      errors.push(`findings[${index}] violation lacks direct diff evidence`);
    }
  }
  return { valid: errors.length === 0, errors, value };
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
