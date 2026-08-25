// 플러그인 버전 A/B 분석기.
//
// analyze-akasha-routing-ab.mjs 와 다른 점은 provenance 불변식 하나다. routing A/B는 같은
// 플러그인을 두 라우팅으로 돌리므로 subject 해시가 배치 전체에서 하나여야 한다. version A/B는
// 플러그인 자체가 조건이므로 subject 해시가 조건마다 달라야 정상이고, 대신 "조건 안에서는
// 하나"와 "측정 도구(harness·fixture)는 배치 전체에서 하나"가 불변식이 된다.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { percentile } from './model-routing-lib.mjs';

function round(value, digits = 4) {
  return value === null || value === undefined ? null : Number(value.toFixed(digits));
}

function meanOf(rows, key) {
  const values = rows.map(key).filter((value) => typeof value === 'number' && Number.isFinite(value));
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function p50(rows, key) {
  const values = rows.map(key).filter((value) => typeof value === 'number' && Number.isFinite(value));
  return values.length === 0 ? null : percentile(values, 0.5);
}

const uncachedRoot = (row) => row.root_usage.input_tokens - (row.root_usage.cached_input_tokens ?? 0);
const uncachedTotal = (row) => row.total_usage.input_tokens - (row.total_usage.cached_input_tokens ?? 0);

export function summarizeCondition(rows) {
  if (rows.length === 0) return null;
  return {
    runs: rows.length,
    // 이번 변경이 직접 겨눈 값. 부모가 팀 구성에 읽는 양이 줄면 여기부터 움직인다.
    root_input_tokens_p50: p50(rows, (row) => row.root_usage.input_tokens),
    root_uncached_input_tokens_p50: p50(rows, uncachedRoot),
    root_output_tokens_p50: p50(rows, (row) => row.root_usage.output_tokens),
    total_tokens_p50: p50(rows, (row) => row.total_usage.total_tokens),
    total_uncached_input_tokens_p50: p50(rows, uncachedTotal),
    root_share_of_total: round(
      meanOf(rows, (row) => row.root_usage.total_tokens / row.total_usage.total_tokens)
    ),
    // 품질·정확도 가드. 토큰이 줄어도 이 값이 떨어지면 승격하지 않는다.
    quality_mean: round(meanOf(rows, (row) => row.quality_score_regex)),
    quality_contract_rate: round(meanOf(rows, (row) => Number(row.quality_contract_valid === true))),
    exact_roles_rate: round(meanOf(rows, (row) => Number(row.exact_roles))),
    knowledge_documents_read_p50: p50(rows, (row) => row.knowledge_documents_read),
    // 지식베이스를 한 번도 열지 않은 실행의 비율. 토큰이 줄어도 이 값이 오르면 승격하지 않는다.
    knowledge_bypass_rate: round(meanOf(rows, (row) => Number(row.knowledge_bypass === true))),
    // 트리에 없는 경로를 시도한 런의 비율. 경로 해석 실패의 직접 지표다.
    unresolved_path_rate: round(meanOf(rows, (row) => Number((row.knowledge_paths_unresolved_count ?? 0) > 0))),
    grounded_citation_rate: round(meanOf(rows, (row) => row.grounded_citation_rate)),
    wall_ms_p50: p50(rows, (row) => row.wall_ms),
    cost_usd_p50: p50(rows, (row) => row.estimated_api_cost_usd),
    internal_errors: rows.reduce((sum, row) => sum + row.internal_errors, 0),
    // CLI 런타임 탓으로 분류해 게이트에서 뺀 건수. 0이 아니면 측정 환경이 시끄럽다는 뜻이므로
    // 게이트를 막지는 않되 계속 보이게 둔다.
    runtime_errors: rows.reduce((sum, row) => sum + (row.runtime_errors ?? 0), 0),
  };
}

// 조건 순수성: 한 조건의 모든 런이 같은 플러그인 트리를 봤는가.
// 측정 동일성: 두 조건이 같은 harness·fixture·채점기로 재졌는가.
export function summarizeProvenance(records) {
  const stamps = records.map((row) => row.provenance).filter(Boolean);
  const distinct = (rows, key) => [...new Set(rows.map((row) => row.provenance?.[key] ?? null))];
  const byCondition = {};
  let conditionPure = true;
  for (const condition of [...new Set(records.map((row) => row.condition))].sort()) {
    const rows = records.filter((row) => row.condition === condition);
    const hashes = distinct(rows, 'subject_hash');
    byCondition[condition] = { runs: rows.length, subject_hashes: hashes };
    if (hashes.length !== 1) conditionPure = false;
  }
  const harnessHashes = distinct(records, 'harness_hash');
  const fixtureHashes = distinct(records, 'fixtures_hash');
  const scopes = [...new Set(records.map((row) => row.quality_score_scope ?? 'unrecorded'))];
  const subjectHashes = distinct(records, 'subject_hash');
  return {
    stamped_records: stamps.length,
    unstamped_records: records.length - stamps.length,
    by_condition: byCondition,
    condition_subject_pure: conditionPure,
    // 조건이 실제로 서로 다른 플러그인을 가리켜야 A/B가 성립한다.
    conditions_differ: subjectHashes.length > 1,
    harness_hashes: harnessHashes,
    fixtures_hashes: fixtureHashes,
    quality_score_scopes: scopes,
    codex_cli_versions: distinct(records, 'codex_cli_version'),
    consistent: stamps.length === records.length && conditionPure
      && subjectHashes.length > 1 && harnessHashes.length === 1
      && fixtureHashes.length === 1 && scopes.length === 1,
  };
}

// --- 유의성 검정 ---
// 이 배치들은 변동계수가 9~24%라 10% 안팎의 차이는 눈으로 구분되지 않는다. 실제로 한 번
// "방향이 같으니 실제일 것"이라고 판정했다가 p=0.318로 뒤집힌 적이 있다. 그래서 판정을
// 사람 눈이 아니라 검정에 맡긴다.
//
// 재현성을 위해 난수를 쓰지 않는다. 표본이 작으면(C(n+m,n) <= 200000) 라벨 배정을 전부
// 열거해 정확 p값을 내고, 그보다 크면 고정 시드 표집으로 떨어뜨린다.
export const STATS_VERSION = 'perm-exact-1';
const MAX_EXACT = 200_000;

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

function binomial(n, k) {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

// n개 중 k개를 고르는 조합을 인덱스 배열로 순회한다.
function* combinations(n, k) {
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx;
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i -= 1;
    if (i < 0) return;
    idx[i] += 1;
    for (let j = i + 1; j < k; j += 1) idx[j] = idx[j - 1] + 1;
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 양측 순열검정. 귀무가설은 "조건 라벨이 결과와 무관하다".
export function permutationTest(a, b) {
  if (a.length < 2 || b.length < 2) return { p: null, exact: false, method: 'insufficient_n' };
  const all = [...a, ...b];
  const n = all.length;
  const observed = Math.abs(mean(b) - mean(a));
  const total = binomial(n, a.length);
  const totalSum = all.reduce((sum, v) => sum + v, 0);
  let atLeast = 0;
  let considered = 0;

  const evaluate = (pickIdx) => {
    let sumA = 0;
    for (const i of pickIdx) sumA += all[i];
    const meanA = sumA / a.length;
    const meanB = (totalSum - sumA) / b.length;
    if (Math.abs(meanB - meanA) >= observed - 1e-9) atLeast += 1;
    considered += 1;
  };

  if (total <= MAX_EXACT) {
    for (const idx of combinations(n, a.length)) evaluate(idx);
    return { p: round(atLeast / considered, 4), exact: true, method: 'exact_enumeration' };
  }
  const rand = mulberry32(0x9E3779B9);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let iter = 0; iter < MAX_EXACT; iter += 1) {
    for (let j = n - 1; j > 0; j -= 1) {
      const k = Math.floor(rand() * (j + 1));
      [order[j], order[k]] = [order[k], order[j]];
    }
    evaluate(order.slice(0, a.length));
  }
  return { p: round(atLeast / considered, 4), exact: false, method: 'seeded_sampling' };
}

// 최소 검출 가능 효과(80% power, 양측 a=0.05). 관측 차이가 이 값보다 작으면 "차이 없음"이
// 아니라 "이 표본 크기로는 알 수 없음"이다. 둘을 섞어 말하지 않기 위해 항상 함께 보고한다.
export function minimumDetectableEffect(a, b) {
  const pooledSd = Math.sqrt((stdev(a) ** 2 + stdev(b) ** 2) / 2);
  const grandMean = mean([...a, ...b]);
  if (!grandMean) return null;
  const perGroup = Math.min(a.length, b.length);
  return round((2.8 * pooledSd * Math.sqrt(2 / perGroup)) / grandMean * 100, 2);
}

export function compareMetric(rowsA, rowsB, key) {
  const a = rowsA.map(key).filter(Number.isFinite);
  const b = rowsB.map(key).filter(Number.isFinite);
  if (a.length === 0 || b.length === 0) return null;
  const meanA = mean(a);
  const { p, exact, method } = permutationTest(a, b);
  const mde = minimumDetectableEffect(a, b);
  const changePercent = meanA === 0 ? null : round(((mean(b) / meanA) - 1) * 100, 2);
  return {
    baseline_mean: round(meanA, 2),
    candidate_mean: round(mean(b), 2),
    baseline_sd: round(stdev(a), 2),
    candidate_sd: round(stdev(b), 2),
    change_percent: changePercent,
    p_value: p,
    p_exact: exact,
    p_method: method,
    significant: p !== null && p < 0.05,
    mde_percent: mde,
    // 유의하지 않은데 관측 차이가 검출 하한보다 작으면 "효과 없음"이 아니라 "판정 불가"다.
    verdict: p === null ? 'insufficient_n'
      : p < 0.05 ? (changePercent < 0 ? 'improved' : 'regressed')
      : (mde !== null && Math.abs(changePercent ?? 0) < mde ? 'underpowered' : 'no_effect'),
  };
}

function deltaPercent(candidate, baseline) {
  if (candidate === null || baseline === null || baseline === 0) return null;
  return round(((candidate / baseline) - 1) * 100, 2);
}

export function analyze(records) {
  const valid = records.filter((row) => !row.infra_invalid);
  const result = {
    schema_version: 1,
    experiment: 'plugin-version-ab',
    total_records: records.length,
    infra_invalid_records: records.length - valid.length,
    quality_metric: 'quality_score_regex (task rubric only)',
    provenance: summarizeProvenance(records),
    tasks: {},
    overall: null,
  };

  const taskIds = [...new Set(valid.map((row) => row.task_id))].sort();
  for (const taskId of taskIds) {
    const rows = valid.filter((row) => row.task_id === taskId);
    const baseline = summarizeCondition(rows.filter((row) => row.condition === 'A'));
    const candidate = summarizeCondition(rows.filter((row) => row.condition === 'B'));
    const entry = { baseline, candidate, delta: null, verdict: null, verdict_reason: null };
    if (baseline && candidate) {
      entry.delta = {
        root_input_percent: deltaPercent(candidate.root_input_tokens_p50, baseline.root_input_tokens_p50),
        root_uncached_percent: deltaPercent(
          candidate.root_uncached_input_tokens_p50, baseline.root_uncached_input_tokens_p50
        ),
        total_tokens_percent: deltaPercent(candidate.total_tokens_p50, baseline.total_tokens_p50),
        cost_percent: deltaPercent(candidate.cost_usd_p50, baseline.cost_usd_p50),
        wall_percent: deltaPercent(candidate.wall_ms_p50, baseline.wall_ms_p50),
        quality_points: baseline.quality_mean === null || candidate.quality_mean === null
          ? null : round((candidate.quality_mean - baseline.quality_mean) * 100, 2),
      };
      const rowsA = rows.filter((row) => row.condition === 'A');
      const rowsB = rows.filter((row) => row.condition === 'B');
      entry.significance = {
        root_input: compareMetric(rowsA, rowsB, (row) => row.root_usage.input_tokens),
        total_tokens: compareMetric(rowsA, rowsB, (row) => row.total_usage.total_tokens),
        cost_usd: compareMetric(rowsA, rowsB, (row) => row.estimated_api_cost_usd),
        quality: compareMetric(rowsA, rowsB, (row) => row.quality_score_regex),
      };
      const powered = baseline.runs >= 3 && candidate.runs >= 3;
      const qualityHeld = candidate.quality_mean >= baseline.quality_mean * 0.98;
      const rolesHeld = candidate.exact_roles_rate >= baseline.exact_roles_rate;
      const contractHeld = candidate.quality_contract_rate >= baseline.quality_contract_rate;
      const bypassHeld = (candidate.knowledge_bypass_rate ?? 0) <= (baseline.knowledge_bypass_rate ?? 0);
      if (!powered) entry.verdict_reason = 'underpowered';
      else if (!bypassHeld) entry.verdict_reason = 'knowledge_bypass_regressed';
      else if (!rolesHeld) entry.verdict_reason = 'role_accuracy_regressed';
      else if (!contractHeld) entry.verdict_reason = 'contract_regressed';
      else if (!qualityHeld) entry.verdict_reason = 'quality_regressed';
      else entry.verdict_reason = 'quality_and_accuracy_held';

      // 가드를 통과했더라도 효율 개선이 통계적으로 확인되지 않으면 승격 근거가 아니다.
      // 'no_effect'(효과 없음 확인)와 'underpowered'(표본 부족으로 판정 불가)를 구분한다.
      const efficiency = [entry.significance.root_input, entry.significance.total_tokens, entry.significance.cost_usd];
      const improved = efficiency.some((m) => m?.verdict === 'improved');
      const anyUnderpowered = efficiency.some((m) => m?.verdict === 'underpowered');
      if (entry.verdict_reason !== 'quality_and_accuracy_held') entry.verdict = 'blocked';
      else if (improved) entry.verdict = 'improvement_confirmed';
      else if (anyUnderpowered) { entry.verdict = 'inconclusive'; entry.verdict_reason = 'underpowered_for_observed_effect'; }
      else { entry.verdict = 'no_effect'; entry.verdict_reason = 'no_efficiency_effect'; }
    }
    result.tasks[taskId] = entry;
  }

  // 태스크를 합치면 태스크 간 평균 차이가 분산으로 들어가 변동계수가 부풀려진다(9% -> 24%).
  // 합산은 서술용이며 판정 근거가 아니다. 판정은 항상 tasks[*] 를 본다.
  const baselineAll = summarizeCondition(valid.filter((row) => row.condition === 'A'));
  const candidateAll = summarizeCondition(valid.filter((row) => row.condition === 'B'));
  if (baselineAll && candidateAll) {
    result.overall = {
      note: 'descriptive_only — 태스크별 평균 차이가 분산에 섞이므로 판정에 쓰지 않는다. tasks[*].significance 를 볼 것.',
      baseline: baselineAll,
      candidate: candidateAll,
      delta: {
        root_input_percent: deltaPercent(candidateAll.root_input_tokens_p50, baselineAll.root_input_tokens_p50),
        root_uncached_percent: deltaPercent(
          candidateAll.root_uncached_input_tokens_p50, baselineAll.root_uncached_input_tokens_p50
        ),
        total_tokens_percent: deltaPercent(candidateAll.total_tokens_p50, baselineAll.total_tokens_p50),
        cost_percent: deltaPercent(candidateAll.cost_usd_p50, baselineAll.cost_usd_p50),
        quality_points: round((candidateAll.quality_mean - baselineAll.quality_mean) * 100, 2),
      },
    };
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const inputIndex = process.argv.indexOf('--input');
  const outputIndex = process.argv.indexOf('--output');
  if (inputIndex < 0) throw new Error('Usage: node scripts/analyze-akasha-version-ab.mjs --input raw.jsonl [--output report.json]');
  const records = (await readFile(process.argv[inputIndex + 1], 'utf8'))
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const rendered = `${JSON.stringify(analyze(records), null, 2)}\n`;
  if (outputIndex >= 0) await writeFile(process.argv[outputIndex + 1], rendered);
  else process.stdout.write(rendered);
}
