// Akasha finding-key 채점기 v1 — 계약 JSON 응답 전용, evidence-only 매칭.
// 매칭 앵커는 classification + change_status + location + diff_evidence 문자열이며,
// basis 등 설명 문장은 보지 않는다(설명의 처방 문구가 다른 키에 교차 오인정되는 것이 실측됨).
// 비계약(Markdown) 응답은 scorable: false로 반환하고 점수를 만들지 않는다.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// answer-keys final-1에 대한 매칭 규칙. 키 파일의 evidence_tokens를 기본으로 하되,
// 응답의 diff_evidence가 토큰 배열이 아닌 서술 문자열인 과거 실행도 채점할 수 있게
// 키별 대표 패턴을 함께 둔다. 키를 바꾸면 이 표와 버전을 함께 올린다.
// matcher 규칙 버전. 정답 키의 동결 버전은 키 파일의 version 필드에서 읽어 따로 기록한다.
export const MATCHER_VERSION = 'matcher-3';
const RULES = {
  r2: {
    violations: {
      'r2-K1': { file: 'Dialog.tsx', pattern: /open.control|열기|Open/i },
      'r2-K2': { file: 'Dialog.tsx', pattern: /role=\\?"?dialog|aria-modal|aria-labelledby/i },
      'r2-K3': { file: 'Dialog.tsx', pattern: /confirm/i },
    },
    confirmations: { 'r2-C1': { knowledge: /server-client-boundary/ } },
  },
  r3: {
    violations: {
      'r3-K1': { file: 'route.ts', pattern: /body\.userId/ },
      'r3-K4': { file: 'release.yml', pattern: /write-all/ },
      'r3-K5': { file: 'release.yml', pattern: /@v4/ },
      'r3-K6': { file: 'projects.spec.ts', pattern: /new-project|CSS|locator/i },
      'r3-K7': { file: 'projects.spec.ts', pattern: /waitForTimeout/ },
      'r3-K8': { file: 'projects.spec.ts', pattern: /count\(\)|web-first|즉시/ },
    },
    gaps: {
      // 관대 기준(사람 확정 Q13): schema 관련 공백 분리 자체를 커버로 인정
      'r3-K3': { pattern: /unique|카디널리티|cardinality|기존 데이터|마이그레이션|migration|계약|무결성/i, gapFile: 'schema.prisma' },
    },
    // final-3: 분류를 따지지 않는 효과 서술 항목. 근거 문서가 '@unique 제거 자체를 위반으로
    // 단정하지 말라'고 명시하므로 위반 분류를 정답 조건으로 둘 수 없다. 대신 확정 효과를
    // diff 증거와 함께 서술했는지만 본다.
    // basis를 읽되 file+evidence로 먼저 좁힌다 — 전역으로 basis를 읽으면 다른 키에 교차
    // 오인정되는 것이 실측됐으므로(K6·K8), 같은 파일의 unique 증거를 가진 항목만 대상으로 한다.
    effects: {
      'r3-K2': { file: 'schema.prisma', evidence: /unique/i, effect: /중복|duplicate|cardinality|카디널리티/i },
    },
  },
};

// 정답 키에 있는 필수 키가 matcher에 없으면 조용히 채점에서 빠진다(r3-K2에서 실제로 발생).
// 로드 시점에 대조해서 즉시 실패시킨다.
export function ruleCoverage(taskId, keys) {
  const rules = RULES[taskId] ?? {};
  const ruleIds = new Set([
    ...Object.keys(rules.violations ?? {}),
    ...Object.keys(rules.gaps ?? {}),
    ...Object.keys(rules.confirmations ?? {}),
    ...Object.keys(rules.effects ?? {}),
  ]);
  const keyIds = [
    ...(keys.expected_findings ?? []).filter((key) => key.required).map((key) => key.key_id),
    ...(keys.expected_confirmations ?? []).map((key) => key.key_id),
  ];
  return {
    scored_keys: keyIds.filter((id) => ruleIds.has(id)),
    missing_rules: keyIds.filter((id) => !ruleIds.has(id)),
    orphan_rules: [...ruleIds].filter((id) => !keyIds.includes(id)),
  };
}

export function assertRuleCoverage(taskId, keys) {
  const coverage = ruleCoverage(taskId, keys);
  if (coverage.missing_rules.length > 0) {
    throw new Error(`${taskId}: 정답 키에 있으나 matcher 규칙이 없다 — ${coverage.missing_rules.join(', ')}`);
  }
  if (coverage.orphan_rules.length > 0) {
    throw new Error(`${taskId}: matcher 규칙이 정답 키에 없다 — ${coverage.orphan_rules.join(', ')}`);
  }
  return coverage;
}

export function scoreResponse(taskId, finalMessage, keys) {
  let value;
  try { value = JSON.parse(finalMessage.trim()); } catch { return { scorable: false, reason: 'not-json' }; }
  if (!value || !Array.isArray(value.findings)) return { scorable: false, reason: 'no-findings-array' };

  const rules = RULES[taskId];
  const findings = value.findings;
  const gaps = (value.knowledge_gaps ?? []).map((g) => (typeof g === 'string' ? g : JSON.stringify(g)));
  const violations = findings
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => f.classification === '위반' && f.change_status === 'introduced_by_diff');
  const evidenceText = (f) => JSON.stringify(f.diff_evidence ?? '');

  const perKey = {};
  const audit = findings.map((f, index) => ({ index, classification: f.classification, location: f.location ?? null, matched_keys: [], grounding: null }));

  // 근거 적합성은 커버 여부와 별개 축이다. 매칭된 finding의 knowledge_path가 정답 키의
  // 기대 경로와 맞는지만 본다.
  const groundingOf = (finding, keyId) => {
    const expected = keys.expected_findings.find((k) => k.key_id === keyId)?.expected_knowledge_any_of ?? [];
    const kp = finding.knowledge_path;
    if (kp == null) return '미기재';
    return expected.some((path) => kp.endsWith(path.replace(/^knowledge\//, 'knowledge/'))) || expected.includes(kp) ? '적합' : '부적합';
  };

  for (const [keyId, rule] of Object.entries(rules.violations ?? {})) {
    const hit = violations.find(({ f }) => String(f.location ?? '').includes(rule.file) && rule.pattern.test(evidenceText(f)));
    perKey[keyId] = Boolean(hit);
    if (hit) {
      audit[hit.index].matched_keys.push(keyId);
      audit[hit.index].grounding = groundingOf(hit.f, keyId);
    }
  }
  for (const [keyId, rule] of Object.entries(rules.gaps ?? {})) {
    const inGaps = gaps.some((g) => rule.pattern.test(g));
    const asFinding = findings.findIndex((f) => f.classification === '지식베이스에 근거 없음' && String(f.location ?? '').includes(rule.gapFile));
    perKey[keyId] = inGaps || asFinding >= 0;
    if (asFinding >= 0) audit[asFinding].matched_keys.push(keyId);
  }
  for (const [keyId, rule] of Object.entries(rules.effects ?? {})) {
    const candidates = findings
      .map((f, index) => ({ f, index }))
      .filter(({ f }) => String(f.location ?? '').includes(rule.file)
        || String(f.diff_evidence?.path ?? '').includes(rule.file));
    const hit = candidates.find(({ f }) => rule.evidence.test(evidenceText(f)) && rule.effect.test(String(f.basis ?? '')));
    const inGaps = gaps.some((g) => rule.file.split('.')[0] && new RegExp(rule.file.replace('.', '\\.'), 'i').test(g)
      && rule.evidence.test(g) && rule.effect.test(g));
    perKey[keyId] = Boolean(hit) || inGaps;
    if (hit) {
      audit[hit.index].matched_keys.push(keyId);
      audit[hit.index].grounding = groundingOf(hit.f, keyId);
    }
  }
  for (const [keyId, rule] of Object.entries(rules.confirmations ?? {})) {
    const hit = findings.findIndex((f) => f.classification === '근거 있는 확인' && rule.knowledge.test(String(f.knowledge_path ?? '')));
    perKey[keyId] = hit >= 0;
    if (hit >= 0) audit[hit].matched_keys.push(keyId);
  }
  return { scorable: true, perKey, finding_audit: audit };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const rawPaths = process.argv.filter((a, i) => process.argv[i - 1] === '--raw');
  const keysDir = arg('--keys');
  const out = arg('--out');
  if (rawPaths.length === 0 || !keysDir) {
    console.log('Usage: node scripts/akasha-key-scorer.mjs --raw raw.jsonl [--raw ...] --keys <answer-keys dir> [--out FILE] [--determinism-check]');
    process.exit(1);
  }
  const keys = { r2: JSON.parse(await readFile(`${keysDir}/r2.json`, 'utf8')), r3: JSON.parse(await readFile(`${keysDir}/r3.json`, 'utf8')) };
  const coverage = Object.fromEntries(['r2', 'r3'].map((taskId) => [taskId, assertRuleCoverage(taskId, keys[taskId])]));
  const keyVersions = { r2: keys.r2.version, r3: keys.r3.version };
  const rows = [];
  for (const p of rawPaths) for (const line of (await readFile(p, 'utf8')).trim().split('\n')) rows.push(JSON.parse(line));
  // 채점 결과가 어느 실행 상태에 대한 것인지 잃지 않도록 raw 레코드의 provenance를 그대로 옮긴다.
  const scoreAll = (input) => input.map((r) => ({
    run_id: r.run_id,
    task_id: r.task_id,
    condition: r.condition,
    matcher: MATCHER_VERSION,
    key_version: keyVersions[r.task_id] ?? null,
    keys_scored: coverage[r.task_id]?.scored_keys ?? [],
    provenance: r.provenance ?? null,
    ...scoreResponse(r.task_id, r.final_message, keys[r.task_id]),
  }));
  const results = scoreAll(rows);
  if (process.argv.includes('--determinism-check')) {
    const doubled = scoreAll([...rows, ...rows]);
    const rerun = scoreAll(rows);
    const same = JSON.stringify(results) === JSON.stringify(rerun)
      && JSON.stringify(doubled.slice(0, rows.length)) === JSON.stringify(doubled.slice(rows.length))
      && JSON.stringify(doubled.slice(0, rows.length)) === JSON.stringify(results);
    console.log(`determinism-check: ${same ? 'PASS' : 'FAIL'} (rows=${rows.length}, doubled=${doubled.length})`);
    if (!same) process.exit(2);
  }
  const rendered = `${JSON.stringify(results, null, 2)}\n`;
  if (out) await writeFile(out, rendered); else process.stdout.write(rendered);
  const scorable = results.filter((r) => r.scorable).length;
  console.error(`scored: ${scorable}/${results.length} scorable (계약 JSON만), matcher ${MATCHER_VERSION}, `
    + `keys r2=${keyVersions.r2}(${coverage.r2.scored_keys.length}키) r3=${keyVersions.r3}(${coverage.r3.scored_keys.length}키)`);
}
