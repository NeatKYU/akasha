#!/usr/bin/env node
// 실전 세션 전사 하나를 analyze-akasha-version-ab.mjs 가 읽는 record 로 뽑는다.
//
// 하네스(run-akasha-version-ab.mjs)는 raw.jsonl 을 직접 만들지만 실전 실행은 전사만 남긴다.
//   Claude Code : $CLAUDE_CONFIG_DIR/projects/<cwd 인코딩>/<session>.jsonl
//                 + <session>/subagents/agent-<id>.jsonl (+ .meta.json)
//   Codex       : ~/.codex/sessions/YYYY/MM/DD/rollout-*-<thread>.jsonl (자식은 parent_thread_id 로 연결)
// 두 형식을 같은 중간 표현으로 읽은 뒤 하네스와 같은 이름의 지표를 계산한다. 그래야 실전에서
// 새 실패 모드를 찾았을 때 하네스 가드(knowledge_bypass, unresolved_path_rate …)가 그대로 적용된다.
//
// Claude Code 전사에서 실측으로 확인한 형태(2026-08-25, cli 2.1.x):
//   - 스킬 호출은 user 줄 두 개로 온다. 첫 줄은 <command-name>/<command-args>, 둘째 줄이
//     "Base directory for this skill: …" 로 시작하는 렌더링된 SKILL.md 다. 첫 줄만 보면 루트를 못 찾는다.
//   - Agent 도구는 비동기로 뜬다. tool_result.toolUseResult 는 {status:"async_launched", agentId} 뿐이고,
//     자식의 반환값은 나중에 <task-notification>…<result>…</result> 로 온다. 부모가 쉬고 있을 때 오면
//     user 줄, 부모가 턴 중간(도구 실행 중)에 받으면 queue-operation 줄 + attachment.queued_command 로
//     기록된다. 알림이 없는 spawn 은 끝나지 않은 자식이다(세션이 중간에 끊긴 경우). 알림 본문은 `>` 가
//     `&gt;` 로 이스케이프되고, 자식 출력이 지시문 모양이면 `[harness: …]` 접두어가 붙는다.
//   - 자식이 완료될 때마다 부모 턴이 끝나므로 Stop 훅이 자식 수만큼 돈다(system.subtype=stop_hook_summary).
//   - 큰 도구 출력은 <persisted-output> 으로 파일에 저장되고 부모가 다시 읽어야 한다(읽기 예산을 먹는다).
//
// 하네스와 다른 점(의도된 차이):
//   - knowledge_paths_read      : 자식이 언급한 실재 경로만 (하네스와 같음). 부모가 연 경로는
//                                 parent_knowledge_paths_read 로 따로 둔다 — SKILL.md 는 부모가
//                                 지식 문서를 열지 않도록 규정하므로 이 값은 0 이어야 정상이다.
//   - knowledge_paths_unresolved: 부모+자식 합집합. 하네스는 자식만 봤지만 실전에서 잡으려는
//                                 환각·루트 오인은 부모에서 먼저 일어난다.
//   - quality_score_regex       : 실전에는 정답 키가 없으므로 null (quality_score_scope: unscored).
//   - estimated_api_cost_usd    : 가격표에 없는 모델이면 null. 추정치로 채우지 않는다.
//
// 사용:
//   node scripts/inspect-akasha-session.mjs --latest                         # 현재 cwd 의 최신 Claude Code 세션
//   node scripts/inspect-akasha-session.mjs --session <uuid> [--config-dir ~/.claude-b]
//   node scripts/inspect-akasha-session.mjs --file <rollout-or-transcript.jsonl>
//   옵션: --runtime claude-code|codex|auto  --plugin-root <dir>  --expect-roles ai,qa
//         --condition B --task-id real --output record.json --append raw.jsonl --quiet
import { readdir, readFile, stat, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROVENANCE_SCHEMA_VERSION, hashPluginSubject, hashTree, hashFile, gitProvenance } from './provenance.mjs';
import { CONTRACT_VALIDATOR_VERSION, validateAkashaReview } from './model-routing-lib.mjs';

export const INSPECTOR_VERSION = 'session-inspector-2';
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const KNOWLEDGE_PATH = /[\w.@~${}/-]*knowledge\/[\w./-]*\.md/gu;
const LISTING_COMMAND = /\b(ls|rg --files|find|tree)\b[^\n;&|]*knowledge|Glob|knowledge\/[\w/-]*\*/u;
const PLUGIN_ROOT_LITERAL = '${CLAUDE_PLUGIN_ROOT}';

// --- CLI ---
export function parseArgs(argv) {
  const cli = {
    file: null, session: null, latest: false, runtime: 'auto', configDir: null, projectDir: null,
    cwd: process.cwd(), pluginRoot: null, expectRoles: null, condition: 'real', taskId: 'real',
    output: null, append: null, quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--file': cli.file = next(); break;
      case '--session': cli.session = next(); break;
      case '--latest': cli.latest = true; break;
      case '--runtime': cli.runtime = next(); break;
      case '--config-dir': cli.configDir = next(); break;
      case '--project-dir': cli.projectDir = next(); break;
      case '--cwd': cli.cwd = path.resolve(next()); break;
      case '--plugin-root': cli.pluginRoot = path.resolve(next()); break;
      case '--expect-roles': cli.expectRoles = next().split(',').map((s) => s.trim()).filter(Boolean).sort(); break;
      case '--condition': cli.condition = next(); break;
      case '--task-id': cli.taskId = next(); break;
      case '--output': cli.output = next(); break;
      case '--append': cli.append = next(); break;
      case '--quiet': cli.quiet = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  if (!cli.file && !cli.session && !cli.latest) throw new Error('--file, --session, --latest 중 하나가 필요하다');
  return cli;
}

// Claude Code 는 cwd 를 영숫자 외 문자를 '-' 로 바꿔 projects/ 하위 디렉터리 이름으로 쓴다.
export const encodeProjectDir = (cwd) => cwd.replace(/[^A-Za-z0-9]/gu, '-');

async function listJsonl(directory, recursive = false, output = []) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (recursive) await listJsonl(full, true, output); continue; }
    if (entry.name.endsWith('.jsonl')) output.push({ path: full, mtimeMs: (await stat(full)).mtimeMs });
  }
  return output;
}

async function readLines(file) {
  return (await readFile(file, 'utf8')).split('\n').filter((line) => line.trim()).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

export async function locateTranscript(cli) {
  if (cli.file) {
    const file = path.resolve(cli.file);
    const runtime = cli.runtime !== 'auto' ? cli.runtime
      : (path.basename(file).startsWith('rollout-') || file.includes(`${path.sep}.codex${path.sep}`)) ? 'codex' : 'claude-code';
    return { file, runtime };
  }
  const runtime = cli.runtime === 'auto' ? 'claude-code' : cli.runtime;
  if (runtime === 'codex') {
    const files = await listJsonl(path.join(os.homedir(), '.codex/sessions'), true);
    const candidates = files.filter((f) => path.basename(f.path).startsWith('rollout-'));
    if (cli.session) {
      const hit = candidates.find((f) => f.path.includes(cli.session));
      if (!hit) throw new Error(`codex rollout not found for session ${cli.session}`);
      return { file: hit.path, runtime };
    }
    // --latest: 부모 rollout(parent_thread_id 없음) 중 최신. cwd 가 맞는 것을 우선한다.
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const candidate of candidates.slice(0, 400)) {
      const lines = await readLines(candidate.path);
      const meta = lines.find((line) => line.type === 'session_meta')?.payload;
      if (!meta || meta.parent_thread_id) continue;
      if (meta.cwd && cli.cwd && meta.cwd !== cli.cwd) continue;
      return { file: candidate.path, runtime };
    }
    throw new Error('no parent codex rollout found');
  }
  const configDir = cli.configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
  const projectDir = cli.projectDir ?? path.join(configDir, 'projects', encodeProjectDir(cli.cwd));
  if (cli.session) return { file: path.join(projectDir, `${cli.session}.jsonl`), runtime };
  const files = (await listJsonl(projectDir)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (files.length === 0) throw new Error(`no transcripts under ${projectDir}`);
  return { file: files[0].path, runtime };
}

// --- 공통 도우미 ---
function emptyUsage() {
  return { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
}

// Anthropic usage → 하네스(codex)와 같은 필드. input_tokens 는 캐시 포함 총 입력이다.
function anthropicUsage(usage) {
  if (!usage) return null;
  const fresh = usage.input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  return {
    input_tokens: fresh + write + read,
    cached_input_tokens: read,
    cache_write_input_tokens: write,
    output_tokens: output,
    reasoning_output_tokens: usage.output_tokens_details?.thinking_tokens ?? 0,
    total_tokens: fresh + write + read + output,
  };
}

function addUsage(target, usage) {
  if (!usage) return target;
  for (const key of Object.keys(target)) target[key] += usage[key] ?? 0;
  return target;
}

// 스트리밍 전사는 같은 message.id 를 블록마다 한 줄씩 남기고 usage 는 마지막 줄이 완전하다.
function sumAssistantUsage(lines) {
  const byMessage = new Map();
  const models = new Set();
  let effort = null;
  for (const line of lines) {
    if (line.type !== 'assistant' || !line.message) continue;
    const id = line.message.id ?? line.uuid;
    byMessage.set(id, line.message.usage ?? byMessage.get(id) ?? null);
    if (line.message.model) models.add(line.message.model);
    if (line.effort) effort = line.effort;
  }
  const usage = emptyUsage();
  for (const entry of byMessage.values()) addUsage(usage, anthropicUsage(entry));
  return { usage, messages: byMessage.size, models: [...models], effort };
}

const asText = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((block) => block?.text ?? (typeof block?.content === 'string' ? block.content : '')).join('\n') : '');

const unescapeXml = (text) => text.replace(/&gt;/gu, '>').replace(/&lt;/gu, '<').replace(/&quot;/gu, '"').replace(/&amp;/gu, '&');

// `ROOT=/x/y` 처럼 같은 명령 안에서 정의한 셸 변수를 `$ROOT/…`·`${ROOT}/…` 에 펼친다.
// 정의되지 않은 변수(${CLAUDE_PLUGIN_ROOT} 가 치환되지 않은 채 남은 경우 등)는 그대로 둔다.
export function expandShellVars(text) {
  const vars = {};
  for (const match of text.matchAll(/\b([A-Z_][A-Z0-9_]*)=("?)(\/[\w.@~/-]+)\2/gu)) vars[match[1]] = match[3];
  if (Object.keys(vars).length === 0) return text;
  return text.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/gu, (all, name) => vars[name] ?? all);
}

function toolCallsOf(lines) {
  const calls = [];
  const results = new Map();
  for (const line of lines) {
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (line.type === 'assistant' && block.type === 'tool_use') {
        calls.push({ index: calls.length, id: block.id, name: block.name, input: block.input ?? {}, input_text: JSON.stringify(block.input ?? {}), timestamp: line.timestamp ?? null });
      } else if (line.type === 'user' && block.type === 'tool_result') {
        const text = asText(block.content);
        results.set(block.tool_use_id, { is_error: block.is_error === true, text: text.slice(0, 400), persisted: text.startsWith('<persisted-output>'), tool_use_result: line.toolUseResult ?? null });
      }
    }
  }
  for (const call of calls) call.result = results.get(call.id) ?? null;
  return calls;
}

function roleOf(agentType) {
  const match = /^(?:akasha:)?akasha-([a-z]+)$/u.exec(agentType ?? '');
  return match ? match[1] : null;
}

const lastAssistantText = (lines) => [...lines].reverse().map((line) => (line.type === 'assistant' && Array.isArray(line.message?.content)
  ? line.message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n') : ''))
  .find((text) => text.trim()) ?? '';

// --- Claude Code 전사 ---
// user 줄에 실린 <task-notification> 을 agentId → {status, result, …} 로 모은다.
export function parseTaskNotifications(userTexts) {
  const notifications = new Map();
  for (const text of userTexts) {
    for (const match of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/gu)) {
      const body = match[1];
      const field = (name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'u').exec(body)?.[1] ?? null;
      const id = field('task-id');
      if (!id) continue;
      const number = (name) => { const raw = field(name); return raw === null ? null : Number(raw); };
      // 같은 task-id 가 여러 번(큐 enqueue/dequeue, 재알림) 나올 수 있다. 결과가 있는 첫 알림을 지킨다.
      if (notifications.get(id)?.result?.trim()) continue;
      notifications.set(id, {
        status: field('status') ?? 'unknown',
        result: unescapeXml(field('result') ?? ''),
        subagent_tokens: number('subagent_tokens'),
        tool_uses: number('tool_uses'),
        duration_ms: number('duration_ms'),
      });
    }
  }
  return notifications;
}

export async function loadClaudeSession(file) {
  const lines = await readLines(file);
  const parentLines = lines.filter((line) => line.isSidechain !== true);
  const first = parentLines.find((line) => line.type === 'user');
  const sessionId = first?.sessionId ?? path.basename(file, '.jsonl');
  // 스킬 호출은 user 줄 두 개(명령 줄 + 렌더링된 SKILL.md)로 오므로 모든 user 줄을 본다.
  const userTexts = parentLines.filter((line) => line.type === 'user').map((line) => asText(line.message?.content ?? ''));
  const commandText = userTexts.find((text) => /<command-name>/u.test(text)) ?? '';
  const skillText = userTexts.find((text) => /Base directory for this skill:/u.test(text)) ?? '';
  const skillInvoked = /<command-name>([^<]+)<\/command-name>/u.exec(commandText)?.[1] ?? null;
  const commandArgs = /<command-args>([\s\S]*?)<\/command-args>/u.exec(commandText)?.[1]?.trim() ?? null;
  const skillBase = /Base directory for this skill: (\S+?)\/skills\/akasha\b/u.exec(skillText)?.[1] ?? null;
  const rootUsage = sumAssistantUsage(parentLines);
  const toolCalls = toolCallsOf(parentLines);
  // 알림은 user 줄(부모 유휴 시) 또는 queue-operation/queued_command(부모 턴 중간) 로 온다.
  const queuedTexts = [
    ...lines.filter((line) => line.type === 'queue-operation').map((line) => String(line.content ?? '')),
    ...lines.filter((line) => line.type === 'attachment' && line.attachment?.type === 'queued_command').map((line) => String(line.attachment.prompt ?? '')),
  ];
  const notifications = parseTaskNotifications([...userTexts, ...queuedTexts]);
  const spawns = toolCalls.filter((call) => call.name === 'Agent' || call.name === 'Task').map((call) => {
    const launch = call.result?.tool_use_result ?? null;
    const agentId = launch?.agentId ?? null;
    const notification = agentId ? notifications.get(agentId) ?? null : null;
    let status;
    if (!call.result) status = 'missing';
    else if (call.result.is_error) status = 'error';
    else if (notification) status = notification.status;
    else if (launch?.status === 'async_launched') status = 'launched_no_result';
    else status = 'completed';
    return {
      index: call.index,
      tool: call.name,
      agent_type: call.input.subagent_type ?? null,
      description: call.input.description ?? null,
      model_override: call.input.model ?? null,
      prompt_bytes: Buffer.byteLength(call.input.prompt ?? ''),
      prompt: call.input.prompt ?? '',
      status,
      agent_id: agentId,
      error: call.result?.is_error ? call.result.text : null,
      result_text: notification?.result ?? null,
      duration_ms: notification?.duration_ms ?? null,
      reported_tokens: notification?.subagent_tokens ?? null,
      reported_tool_uses: notification?.tool_uses ?? null,
    };
  });
  const timestamps = lines.map((line) => line.timestamp).filter(Boolean).sort();
  const finalText = lastAssistantText(parentLines);
  const children = [];
  const subagentDir = path.join(path.dirname(file), sessionId, 'subagents');
  for (const entry of (await listJsonl(subagentDir)).sort((a, b) => a.path.localeCompare(b.path))) {
    const childLines = await readLines(entry.path);
    let meta = null;
    try { meta = JSON.parse(await readFile(entry.path.replace(/\.jsonl$/u, '.meta.json'), 'utf8')); } catch {}
    const agentId = path.basename(entry.path, '.jsonl').replace(/^agent-/u, '');
    const attribution = childLines.find((line) => line.attributionAgent)?.attributionAgent ?? null;
    const agentType = meta?.agentType ?? attribution;
    const childUsage = sumAssistantUsage(childLines);
    const childCalls = toolCallsOf(childLines);
    const notification = notifications.get(agentId) ?? null;
    // 알림의 <result> 가 부모가 실제로 받은 값이다. 없으면(끊긴 자식) 전사의 마지막 텍스트를 쓴다.
    const lastText = notification?.result?.trim() ? notification.result : lastAssistantText(childLines);
    children.push({
      agent_id: agentId,
      agent_type: agentType,
      role: roleOf(agentType),
      description: meta?.description ?? null,
      spawn_depth: meta?.spawnDepth ?? null,
      model: childUsage.models[0] ?? null,
      effort: childUsage.effort,
      usage: childUsage.usage,
      messages: childUsage.messages,
      tool_calls: childCalls,
      final_text: lastText,
      completed: notification ? notification.status === 'completed' : false,
      duration_ms: notification?.duration_ms ?? null,
    });
  }
  const attachments = lines.filter((line) => line.type === 'attachment').map((line) => line.attachment ?? {});
  return {
    runtime: 'claude-code',
    file,
    session_id: sessionId,
    cwd: first?.cwd ?? null,
    cli_version: first?.version ?? null,
    entrypoint: first?.entrypoint ?? null,
    started_at: timestamps[0] ?? null,
    ended_at: timestamps.at(-1) ?? null,
    prompt: commandArgs ?? asText(first?.message?.content ?? '').slice(0, 400),
    skill_invoked: skillInvoked,
    skill_text_seen: Boolean(skillText),
    plugin_root_hint: skillBase,
    // 치환 판정은 렌더링된 SKILL.md 본문 기준이다. 사용자가 명령 인자에 적은 리터럴은 세지 않는다.
    plugin_root_literal_in_skill: skillText.includes(PLUGIN_ROOT_LITERAL),
    plugin_root_literal_in_tools: toolCalls.some((call) => call.input_text.includes(PLUGIN_ROOT_LITERAL)),
    root_model: rootUsage.models[0] ?? null,
    root_effort: rootUsage.effort,
    root_usage: rootUsage.usage,
    root_messages: rootUsage.messages,
    tool_calls: toolCalls,
    spawns,
    children,
    final_message: finalText,
    stop_hook_runs: parentLines.filter((line) => line.type === 'system' && line.subtype === 'stop_hook_summary').length,
    hook_blocking_errors: attachments.filter((attachment) => attachment.type === 'hook_blocking_error').length,
    tool_results_persisted: toolCalls.filter((call) => call.result?.persisted).length,
    system_errors: parentLines.filter((line) => line.type === 'system' && (line.level === 'error' || line.isApiErrorMessage)).map((line) => String(line.content ?? '').slice(0, 200)),
  };
}

// --- Codex rollout ---
function codexUsage(lines) {
  let usage = null;
  for (const line of lines) {
    if (line.type === 'event_msg' && line.payload?.type === 'token_count') usage = line.payload.info?.total_token_usage ?? usage;
  }
  return usage ? { ...emptyUsage(), ...usage } : emptyUsage();
}

function codexToolCalls(lines) {
  const calls = [];
  for (const line of lines) {
    if (line.type !== 'response_item') continue;
    const payload = line.payload ?? {};
    if (payload.type === 'custom_tool_call') {
      calls.push({ index: calls.length, id: payload.call_id, name: payload.name, input: payload.input, input_text: String(payload.input ?? ''), result: null });
    } else if (payload.type === 'function_call') {
      calls.push({ index: calls.length, id: payload.call_id, name: payload.name, input: payload.arguments, input_text: String(payload.arguments ?? ''), result: null });
    }
  }
  const outputs = new Map();
  for (const line of lines) {
    const payload = line.payload ?? {};
    if (line.type === 'response_item' && /_output$/u.test(payload.type ?? '')) {
      const text = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '');
      outputs.set(payload.call_id, { is_error: /^\s*(error|failed)/iu.test(text), text: text.slice(0, 400), persisted: false, tool_use_result: null });
    }
  }
  for (const call of calls) call.result = outputs.get(call.id) ?? null;
  return calls;
}

function codexFinalMessage(lines) {
  const agentMessages = lines.filter((line) => line.type === 'event_msg' && line.payload?.type === 'agent_message');
  return agentMessages.at(-1)?.payload?.message ?? '';
}

export async function loadCodexSession(file) {
  const lines = await readLines(file);
  const meta = lines.find((line) => line.type === 'session_meta')?.payload ?? {};
  const turn = lines.find((line) => line.type === 'turn_context')?.payload ?? {};
  const userMessage = lines.find((line) => line.type === 'event_msg' && line.payload?.type === 'user_message')?.payload?.message ?? '';
  const timestamps = lines.map((line) => line.timestamp).filter(Boolean).sort();
  const startedMs = Date.parse(timestamps[0] ?? meta.timestamp ?? 0);
  const toolCalls = codexToolCalls(lines);
  const spawns = toolCalls.filter((call) => call.name === 'spawn_agent').map((call) => {
    let args = {};
    try { args = JSON.parse(call.input_text); } catch {}
    return { index: call.index, tool: 'spawn_agent', agent_type: args.agent_type ?? null, description: args.task_name ?? null, model_override: args.model ?? null, prompt_bytes: Buffer.byteLength(String(args.message ?? '')), prompt: '', status: call.result?.is_error ? 'error' : 'completed', agent_id: null, error: call.result?.is_error ? call.result.text : null, result_text: null, duration_ms: null, reported_tokens: null, reported_tool_uses: null };
  });
  const children = [];
  const sessionRoot = path.join(os.homedir(), '.codex/sessions');
  for (const candidate of await listJsonl(sessionRoot, true)) {
    if (candidate.mtimeMs < startedMs - 2_000) continue;
    const childLines = await readLines(candidate.path);
    const childMeta = childLines.find((line) => line.type === 'session_meta')?.payload;
    if (childMeta?.parent_thread_id !== meta.id) continue;
    const childTurn = childLines.find((line) => line.type === 'turn_context')?.payload ?? {};
    const agentPath = childMeta.source?.subagent?.thread_spawn?.agent_path ?? childMeta.agent_path ?? '';
    const taskName = agentPath.split('/').filter(Boolean).at(-1) ?? null;
    const role = taskName ? taskName.replace(/^akasha[_-]/u, '').replace(/_review$/u, '') : null;
    const finalText = codexFinalMessage(childLines);
    children.push({
      agent_id: childMeta.id,
      agent_type: taskName,
      role: role && /^[a-z]+$/u.test(role) ? role : null,
      description: taskName,
      spawn_depth: 1,
      model: childTurn.model ?? null,
      effort: childTurn.effort ?? childTurn.reasoning_effort ?? null,
      usage: codexUsage(childLines),
      messages: childLines.filter((line) => line.type === 'response_item' && line.payload?.type === 'message').length,
      tool_calls: codexToolCalls(childLines),
      final_text: finalText,
      completed: Boolean(finalText.trim()),
      duration_ms: null,
    });
  }
  return {
    runtime: 'codex',
    file,
    session_id: meta.id ?? path.basename(file, '.jsonl'),
    cwd: meta.cwd ?? null,
    cli_version: meta.cli_version ?? null,
    entrypoint: meta.source ?? null,
    started_at: timestamps[0] ?? null,
    ended_at: timestamps.at(-1) ?? null,
    prompt: userMessage.slice(0, 400),
    skill_invoked: /\$akasha\b|\/akasha\b/u.test(userMessage) ? 'akasha' : null,
    skill_text_seen: false,
    plugin_root_hint: null,
    plugin_root_literal_in_skill: false,
    plugin_root_literal_in_tools: toolCalls.some((call) => call.input_text.includes(PLUGIN_ROOT_LITERAL)),
    root_model: turn.model ?? null,
    root_effort: turn.effort ?? turn.reasoning_effort ?? null,
    root_usage: codexUsage(lines),
    root_messages: lines.filter((line) => line.type === 'response_item' && line.payload?.type === 'message').length,
    tool_calls: toolCalls,
    spawns,
    children: children.sort((a, b) => (a.role ?? '').localeCompare(b.role ?? '')),
    final_message: codexFinalMessage(lines),
    stop_hook_runs: 0,
    hook_blocking_errors: 0,
    tool_results_persisted: 0,
    system_errors: lines.filter((line) => line.type === 'error' || line.payload?.type === 'error').map((line) => JSON.stringify(line.payload ?? line).slice(0, 200)),
  };
}

// --- 플러그인 루트 ---
const isPluginRoot = (dir) => Boolean(dir) && existsSync(path.join(dir, 'knowledge', 'INDEX.md')) && existsSync(path.join(dir, 'agents'));

export function resolvePluginRoot(session, cli) {
  const tried = [];
  const candidates = [cli.pluginRoot, session.plugin_root_hint];
  for (const call of session.tool_calls) {
    const text = expandShellVars(call.input_text);
    // 셸 변수 대입(ROOT=/x/akasha), <루트>/knowledge/INDEX.md, <루트>/agents, <루트>/agents/akasha-x.md 로 역산한다.
    for (const match of text.matchAll(/\b(?:ROOT|PLUGIN_ROOT|AKASHA_ROOT)=("?)(\/[\w.@~/-]+)\1/gu)) candidates.push(match[2]);
    for (const match of text.matchAll(/(\/[\w.@~/-]+?)\/(?:knowledge\/INDEX\.md|agents(?:\/akasha-[a-z]+\.md)?\b)/gu)) candidates.push(match[1]);
  }
  for (const candidate of candidates) {
    if (!candidate || tried.includes(candidate)) continue;
    tried.push(candidate);
    if (isPluginRoot(candidate)) return { root: candidate, tried };
  }
  return { root: null, tried };
}

async function realKnowledgePaths(pluginRoot) {
  const found = new Set();
  if (!pluginRoot) return found;
  async function walk(dir, prefix) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.md')) found.add(`knowledge/${prefix}${entry.name}`);
    }
  }
  await walk(path.join(pluginRoot, 'knowledge'), '');
  return found;
}

// 도구 입력에 등장한 knowledge/…md 를 전부 뽑아 실재 여부와 접두사(루트 오인)를 판정한다.
export function classifyKnowledgeMentions(calls, realPaths, pluginRoot) {
  const mentions = [];
  for (const call of calls) {
    const text = expandShellVars(call.input_text);
    for (const raw of text.matchAll(KNOWLEDGE_PATH)) {
      const full = raw[0];
      const relative = full.slice(full.indexOf('knowledge/'));
      const prefix = full.slice(0, full.indexOf('knowledge/'));
      const nameReal = realPaths.has(relative);
      // `<루트>/knowledge/…` 같은 템플릿 조각은 접두사가 '/' 하나뿐이다. 파일시스템 루트 경로로 보지 않는다.
      const absolute = prefix.startsWith('/') && prefix.length > 1;
      const resolves = absolute ? existsSync(full) : nameReal;
      let signature = null;
      if (prefix.includes(PLUGIN_ROOT_LITERAL)) signature = 'unsubstituted_variable';
      else if (!nameReal) signature = 'hallucinated_name';
      else if (absolute && !resolves) signature = 'root_misread';
      else if (/(^|\/)skills\/akasha\/$/u.test(prefix) || /\.agents\/skills\/akasha\//u.test(prefix)) signature = 'root_misread';
      else if (absolute && pluginRoot && !full.startsWith(`${pluginRoot}/`)) signature = 'foreign_root';
      mentions.push({ index: call.index, tool: call.name, path: full, relative, resolves: resolves && !signature, signature });
    }
  }
  return mentions;
}

function summarizeTools(calls) {
  const counts = {};
  for (const call of calls) counts[call.name] = (counts[call.name] ?? 0) + 1;
  return counts;
}

// 코드펜스로 감싼 JSON 이나 런타임이 붙인 `[harness: …]` 접두어도 계약 검사에 넣되, 그 자체는
// 계약 위반(lenient 로만 통과)으로 남긴다. 접두어는 자식이 아니라 런타임이 붙이므로 따로 센다.
const HARNESS_PREFIX = /^\s*\[harness:[^\]]*\]\s*/u;
export function stripWrapping(text) {
  const unprefixed = text.replace(HARNESS_PREFIX, '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(unprefixed)?.[1];
  return { text: (fenced ?? unprefixed).trim(), harness_prefixed: HARNESS_PREFIX.test(text), fenced: fenced !== undefined };
}
const stripFence = (text) => { const wrapped = stripWrapping(text); return wrapped.fenced || wrapped.harness_prefixed ? wrapped.text : null; };

// --- record ---
export async function buildRecord(session, cli) {
  const { root: pluginRoot, tried } = resolvePluginRoot(session, cli);
  const realPaths = await realKnowledgePaths(pluginRoot);
  const parentMentions = classifyKnowledgeMentions(session.tool_calls, realPaths, pluginRoot);
  const childRows = session.children.map((child) => {
    const mentions = classifyKnowledgeMentions(child.tool_calls, realPaths, pluginRoot);
    const toolNames = Object.keys(summarizeTools(child.tool_calls));
    const errors = child.tool_calls.filter((call) => call.result?.is_error).map((call) => ({ tool: call.name, text: call.result.text.slice(0, 200) }));
    const contract = validateAkashaReview(child.final_text, { requireParentFields: false });
    const wrapped = stripWrapping(child.final_text);
    return {
      agent_id: child.agent_id,
      agent_type: child.agent_type,
      role: child.role,
      description: child.description,
      model: child.model,
      effort: child.effort,
      usage: child.usage,
      messages: child.messages,
      completed: child.completed,
      duration_ms: child.duration_ms,
      tool_counts: summarizeTools(child.tool_calls),
      read_calls: child.tool_calls.filter((call) => READ_ONLY_TOOLS.has(call.name)).length,
      tools_outside_read_only: toolNames.filter((name) => !READ_ONLY_TOOLS.has(name)),
      permission_denials: errors.filter((error) => /permission.*denied|not allowed|denied/iu.test(error.text)).length,
      tool_errors: errors,
      knowledge_paths_read: [...new Set(mentions.filter((m) => m.resolves).map((m) => m.relative))].sort(),
      knowledge_paths_unresolved: [...new Set(mentions.filter((m) => !m.resolves).map((m) => m.path))].sort(),
      knowledge_mentions: mentions,
      contract_valid: contract.valid,
      contract_valid_lenient: contract.valid || validateAkashaReview(wrapped.text, { requireParentFields: false }).valid,
      contract_errors: contract.errors.slice(0, 5),
      output_fenced: wrapped.fenced,
      output_harness_prefixed: wrapped.harness_prefixed,
      final_text: child.final_text,
      error_count: errors.length,
    };
  });
  const akashaChildren = childRows.filter((child) => child.role);
  const actualRoles = akashaChildren.map((child) => child.role).sort();
  const spawnedTypes = session.spawns.map((spawn) => spawn.agent_type);
  const knowledgePaths = [...new Set(akashaChildren.flatMap((child) => child.knowledge_paths_read))].sort();
  const parentReads = [...new Set(parentMentions.filter((m) => m.resolves && /^(Read|exec|Bash)$/u.test(m.tool)
    && !/test -f|ls |rg --files|find /u.test(session.tool_calls[m.index]?.input_text ?? '')).map((m) => m.relative))].sort();
  const unresolvedAll = [...parentMentions, ...childRows.flatMap((child) => child.knowledge_mentions)].filter((m) => !m.resolves);
  const unresolvedPaths = [...new Set(unresolvedAll.map((m) => m.path))].sort();
  const signatures = {};
  for (const mention of unresolvedAll) signatures[mention.signature ?? 'unresolved'] = (signatures[mention.signature ?? 'unresolved'] ?? 0) + 1;
  // 오케스트레이션 구간(마지막 spawn 까지)의 부모 지표를 따로 둔다. 같은 세션에서 부모가 spawn 뒤에
  // 다른 개발 작업(스크립트 작성 등)을 하면 도구 입력에 실험용 경로가 섞여 전체 집계가 오염된다.
  const lastSpawnIndex = session.spawns.at(-1)?.index ?? null;
  const preSpawnMentions = lastSpawnIndex === null ? parentMentions : parentMentions.filter((m) => m.index <= lastSpawnIndex);
  const preSpawnSignatures = {};
  for (const mention of preSpawnMentions.filter((m) => !m.resolves)) preSpawnSignatures[mention.signature ?? 'unresolved'] = (preSpawnSignatures[mention.signature ?? 'unresolved'] ?? 0) + 1;
  const firstUnresolvedIndex = parentMentions.find((m) => !m.resolves)?.index ?? null;
  const listings = session.tool_calls.filter((call) => LISTING_COMMAND.test(call.input_text)).map((call) => call.index);
  const recoveredAfter = firstUnresolvedIndex === null ? null
    : listings.some((index) => index > firstUnresolvedIndex)
      && parentMentions.some((m) => m.resolves && m.index > firstUnresolvedIndex);
  const citedPaths = [...new Set((session.final_message.match(/knowledge\/[\w./-]+\.md/gu) ?? []))].sort();
  const grounded = citedPaths.filter((cited) => knowledgePaths.includes(cited));
  const totalUsage = emptyUsage();
  addUsage(totalUsage, session.root_usage);
  for (const child of childRows) addUsage(totalUsage, child.usage);
  const roleCount = Math.max(actualRoles.length, 1);
  const contractOptions = { defaultKnowledgeLimit: roleCount * 2, maxKnowledgeLimit: roleCount * 3, maxFindings: 8 };
  const contract = validateAkashaReview(session.final_message, contractOptions);
  const fenced = stripFence(session.final_message);
  const lenient = fenced ? validateAkashaReview(fenced, contractOptions) : contract;
  const spawnFailures = session.spawns.filter((spawn) => !['completed'].includes(spawn.status));
  const firstSpawnIndex = session.spawns[0]?.index ?? null;
  const parentCallsBeforeSpawn = firstSpawnIndex === null ? session.tool_calls.length
    : session.tool_calls.filter((call) => call.index < firstSpawnIndex).length;
  const wallMs = session.started_at && session.ended_at ? Date.parse(session.ended_at) - Date.parse(session.started_at) : null;
  const expected = cli.expectRoles;

  const subject = pluginRoot ? await hashPluginSubject(pluginRoot) : null;
  const fullTree = pluginRoot ? await hashTree(pluginRoot) : null;
  let declaredVersion = null;
  if (pluginRoot) {
    try { declaredVersion = JSON.parse(await readFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null; } catch {}
  }
  const repoRoot = pluginRoot ? path.dirname(pluginRoot) : null;
  const git = repoRoot && existsSync(path.join(repoRoot, '.git')) ? await gitProvenance(repoRoot) : null;
  const selfHash = await hashFile(new URL(import.meta.url).pathname);

  return {
    schema_version: 2,
    run_id: session.session_id,
    runtime: session.runtime,
    experiment: 'real-session',
    task_id: cli.taskId,
    condition: cli.condition,
    condition_role: 'real',
    repetition: 1,
    provenance: {
      schema_version: PROVENANCE_SCHEMA_VERSION,
      experiment: 'real-session',
      condition_role: 'real',
      subject_hash: subject?.hash ?? null,
      subject_full_tree_hash: fullTree?.hash ?? null,
      subject_declared_version: declaredVersion,
      subject_source: pluginRoot,
      plugin_commit: git?.commit_short ?? null,
      git_describe: git?.describe ?? null,
      git_dirty_tracked: git?.dirty_tracked ?? null,
      harness_hash: selfHash?.sha256 ?? null,
      fixtures_hash: null,
      answer_keys_hash: null,
      inspector_version: INSPECTOR_VERSION,
      contract_validator_version: CONTRACT_VALIDATOR_VERSION,
      codex_cli_version: session.runtime === 'codex' ? session.cli_version : null,
      claude_code_version: session.runtime === 'claude-code' ? session.cli_version : null,
    },
    transcript: session.file,
    cwd: session.cwd,
    entrypoint: session.entrypoint,
    prompt: session.prompt,
    skill_invoked: session.skill_invoked,
    skill_text_seen: session.skill_text_seen,
    plugin_root: pluginRoot,
    plugin_root_candidates_tried: tried,
    // 렌더링된 SKILL.md 에 ${CLAUDE_PLUGIN_ROOT} 리터럴이 남아 있지 않고 Base directory 힌트가 있으면 치환된 것이다.
    plugin_root_substituted: session.runtime === 'claude-code' && session.skill_text_seen ? !session.plugin_root_literal_in_skill : null,
    plugin_root_literal_in_skill: session.plugin_root_literal_in_skill,
    plugin_root_literal_in_tools: session.plugin_root_literal_in_tools,
    root_model: session.root_model,
    root_effort: session.root_effort,
    started_at: session.started_at,
    ended_at: session.ended_at,
    wall_ms: wallMs,
    timed_out: false,
    exit_code: null,
    root_usage: session.root_usage,
    total_usage: totalUsage,
    estimated_api_cost_usd: null,
    root_messages: session.root_messages,
    root_tool_counts: summarizeTools(session.tool_calls),
    // SKILL.md 는 역할 선택 전 부모 읽기를 2회로 제한한다. 첫 spawn 전의 모든 도구 호출 수다.
    parent_calls_before_first_spawn: parentCallsBeforeSpawn,
    tool_results_persisted: session.tool_results_persisted,
    stop_hook_runs: session.stop_hook_runs,
    hook_blocking_errors: session.hook_blocking_errors,
    spawns: session.spawns.map(({ prompt, result_text, ...spawn }) => spawn),
    spawned_agent_types: spawnedTypes,
    non_akasha_spawns: spawnedTypes.filter((type) => !roleOf(type)),
    spawn_failures: spawnFailures.map((spawn) => ({ agent_type: spawn.agent_type, status: spawn.status, error: spawn.error })),
    // 모든 spawn 이 결과를 돌려줬는가. 하나라도 launched_no_result 면 세션이 중간에 끊긴 것이다.
    run_complete: session.spawns.length > 0 && spawnFailures.length === 0,
    children: childRows.map(({ knowledge_mentions, final_text, ...child }) => child),
    child_final_texts: Object.fromEntries(childRows.map((child) => [child.agent_id, child.final_text])),
    expected_roles: expected,
    actual_roles: actualRoles,
    exact_roles: expected ? JSON.stringify(actualRoles) === JSON.stringify(expected) : null,
    exact_models: childRows.length > 0 && childRows.every((child) => child.model === session.root_model),
    // 자식이 실제로 연 실재 문서. 하네스와 같은 정의다.
    knowledge_paths_read: knowledgePaths,
    knowledge_documents_read: knowledgePaths.length,
    // 부모가 연 지식 문서. SKILL.md 규정상 0 이어야 한다(test -f / 나열은 읽기로 세지 않는다).
    parent_knowledge_paths_read: parentReads,
    knowledge_paths_unresolved: unresolvedPaths,
    knowledge_paths_unresolved_count: unresolvedPaths.length,
    unresolved_signatures: signatures,
    parent_last_spawn_index: lastSpawnIndex,
    parent_knowledge_paths_unresolved_pre_spawn: [...new Set(preSpawnMentions.filter((m) => !m.resolves).map((m) => m.path))].sort(),
    unresolved_signatures_pre_spawn: preSpawnSignatures,
    parent_unresolved_first_index: firstUnresolvedIndex,
    directory_listing_indices: listings,
    // 부모가 없는 경로를 시도한 뒤 나열로 실제 이름을 다시 골랐는가. 시도가 없었으면 null.
    recovered_after_unresolved: recoveredAfter,
    knowledge_bypass: actualRoles.length > 0 && knowledgePaths.length === 0,
    cited_knowledge_paths: citedPaths,
    grounded_knowledge_citations: grounded,
    grounded_citation_rate: citedPaths.length ? grounded.length / citedPaths.length : 0,
    // 도구 경계: akasha 자식이 Read/Grep/Glob 밖의 도구를 하나라도 썼으면 경계가 뚫린 것이다.
    // 시도조차 없었으면 held 지만 검증된 것은 아니다 — tool_boundary_tested 로 구분한다.
    tool_boundary_held: akashaChildren.length > 0 ? akashaChildren.every((child) => child.tools_outside_read_only.length === 0 || child.permission_denials > 0) : null,
    tool_boundary_tested: akashaChildren.some((child) => child.tools_outside_read_only.length > 0),
    tool_boundary_violations: akashaChildren.flatMap((child) => child.tools_outside_read_only.filter(() => child.permission_denials === 0).map((tool) => `${child.role}:${tool}`)),
    child_contract_valid_count: akashaChildren.filter((child) => child.contract_valid).length,
    child_contract_valid_lenient_count: akashaChildren.filter((child) => child.contract_valid_lenient).length,
    child_outputs_fenced: akashaChildren.filter((child) => child.output_fenced).length,
    child_outputs_harness_prefixed: akashaChildren.filter((child) => child.output_harness_prefixed).length,
    quality_score_scope: 'unscored',
    quality_score_regex: null,
    quality_contract_valid: contract.valid,
    quality_contract_errors: contract.errors,
    quality_contract_valid_lenient: lenient.valid,
    final_message_is_pure_json: contract.valid || !contract.errors[0]?.startsWith('invalid-json'),
    error_type: spawnFailures.length > 0 ? 'orchestration_internal' : 'none',
    infra_invalid: false,
    internal_errors: spawnFailures.length + session.system_errors.length,
    runtime_errors: childRows.reduce((sum, child) => sum + child.permission_denials, 0),
    system_errors: session.system_errors,
    final_message: session.final_message,
  };
}

export function summaryLine(record) {
  const flags = [];
  if (!record.run_complete) flags.push('INCOMPLETE');
  if (record.knowledge_bypass) flags.push('KNOWLEDGE_BYPASS');
  if (record.tool_boundary_held === false) flags.push('TOOL_BOUNDARY_BROKEN');
  if (record.non_akasha_spawns.length) flags.push(`FALLBACK_AGENTS=${record.non_akasha_spawns.join('|')}`);
  if (record.parent_knowledge_paths_read.length) flags.push(`PARENT_READ_KNOWLEDGE=${record.parent_knowledge_paths_read.length}`);
  if (!record.plugin_root) flags.push('PLUGIN_ROOT_UNRESOLVED');
  if (record.plugin_root_substituted === false) flags.push('PLUGIN_ROOT_LITERAL_IN_SKILL');
  if (record.plugin_root_literal_in_tools) flags.push('PLUGIN_ROOT_LITERAL_IN_TOOLS');
  return `DONE ${record.run_id} runtime=${record.runtime} version=${record.provenance.subject_declared_version ?? '?'}`
    + ` roles=${record.actual_roles.join(',') || '-'} spawns=${record.spawned_agent_types.length} complete=${record.run_complete}`
    + ` docs=${record.knowledge_documents_read} unresolved=${record.knowledge_paths_unresolved_count}`
    + ` signatures=${JSON.stringify(record.unresolved_signatures)} pre_spawn=${JSON.stringify(record.unresolved_signatures_pre_spawn)} recovered=${record.recovered_after_unresolved ?? 'n/a'}`
    + ` boundary=${record.tool_boundary_held ?? 'n/a'}${record.tool_boundary_tested ? '(tested)' : '(untested)'}`
    + ` child_contract=${record.child_contract_valid_count}/${record.child_contract_valid_lenient_count}/${record.actual_roles.length} fenced=${record.child_outputs_fenced} harness_prefixed=${record.child_outputs_harness_prefixed}`
    + ` parent_contract=${record.quality_contract_valid}/${record.quality_contract_valid_lenient}`
    + ` parent_calls_before_spawn=${record.parent_calls_before_first_spawn} persisted=${record.tool_results_persisted} stop_hooks=${record.stop_hook_runs}`
    + ` root_input=${record.root_usage.input_tokens} total=${record.total_usage.total_tokens} wall_ms=${record.wall_ms ?? '?'}`
    + (flags.length ? ` ${flags.join(' ')}` : '');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cli = parseArgs(process.argv.slice(2));
  const { file, runtime } = await locateTranscript(cli);
  const session = runtime === 'codex' ? await loadCodexSession(file) : await loadClaudeSession(file);
  const record = await buildRecord(session, cli);
  if (cli.output) await writeFile(cli.output, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  if (cli.append) await appendFile(cli.append, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  if (!cli.quiet) {
    process.stdout.write(`${summaryLine(record)}\n`);
    for (const child of record.children) {
      process.stdout.write(`  child ${child.role ?? child.agent_type ?? '?'} completed=${child.completed} model=${child.model ?? '?'} tools=${JSON.stringify(child.tool_counts)}`
        + ` read=${child.knowledge_paths_read.join(',') || '-'} unresolved=${child.knowledge_paths_unresolved.join(',') || '-'}`
        + ` contract=${child.contract_valid}/${child.contract_valid_lenient} input=${child.usage.input_tokens} output=${child.usage.output_tokens} wall_ms=${child.duration_ms ?? '?'}`
        + `${child.tools_outside_read_only.length ? ` OUTSIDE=${child.tools_outside_read_only.join(',')} denials=${child.permission_denials}` : ''}\n`);
    }
    if (record.knowledge_paths_unresolved.length) process.stdout.write(`  unresolved: ${record.knowledge_paths_unresolved.join(' ')}\n`);
    if (record.parent_knowledge_paths_read.length) process.stdout.write(`  parent read knowledge: ${record.parent_knowledge_paths_read.join(' ')}\n`);
    if (record.spawn_failures.length) process.stdout.write(`  spawn failures: ${record.spawn_failures.map((s) => `${s.agent_type}=${s.status}`).join(' ')}\n`);
    if (!cli.output && !cli.append) process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  }
}
