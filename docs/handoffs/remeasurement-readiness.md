# 재측정 준비 상태 — runner 수정 완료

작성일: 2026-08-24
대상 브랜치: `feat/claude-code-subagents` (기준 커밋 `dfb4a4d`, 작업 트리 수정 상태)
대응 문서: `docs/handoffs/codex-round2-verification-and-verdict.md` 4절

Codex 라운드 2의 조건부 수용 조건 중 남아 있던 2개(계약 rubric 분리, provenance 스탬프)를
구현했다. 모델을 실행하지 않는 범위의 작업이며, 비용은 발생하지 않았다.

## 1. 계약 항목을 품질 점수에서 분리

이전에는 `scripts/run-akasha-routing-ab.mjs`가 `diff-evidence`·`knowledge-selection`·
`no-alertdialog-removal-false-positive`를 과업 rubric에 펼쳐 넣었고, `scoreText`가 이를
동일 가중으로 평균해 `quality_score_regex`에 합산했다. 계약이 품질 점수와 계약 게이트에
이중 반영됐고, 과거 61.25%/70.83%와 정의가 달라 직접 비교가 불가능했다.

이제 rubric을 3개 레이어로 분리해 각각 채점한다(`scoreRubricLayers`).

| 레이어 | 항목 | 기록 필드 |
| --- | --- | --- |
| `task` | tasks.json rubric 그대로 (r2 5개, r3 8개) | `quality_score_regex`, `rubric_items` |
| `contract` | `diff-evidence`, `knowledge-selection` | `contract_score_regex`, `contract_rubric_items` |
| `false_positive` | r2 `no-alertdialog-removal-false-positive` (r3 없음) | `false_positive_guard_score`, `false_positive_rubric_items` |

- `quality_score_regex`는 과업 rubric만으로 계산된다. 항목이 없는 레이어는 0점이 아니라
  `null`로 남긴다(r3의 오탐 레이어).
- 계약 유효성은 기존대로 `quality_contract_valid`가 독립 hard gate로 담당하며, 어떤 품질
  점수에도 합산되지 않는다.
- 레코드에 `quality_score_scope: 'task_rubric_only'`와 `rubric_layer_ids`를 남겨, 나중에
  어떤 정의로 잰 수치인지 파일만 보고 확인할 수 있다.

### 검증 — 과거 정의가 그대로 복원됐는가

저장된 24개 실행의 `final_message`를 새 레이어 정의로 재채점했다.

- `task` 레이어 점수 = 저장된 `quality_score_regex`: **24/24 일치**(불일치 0건).
  즉 다음 측정치는 과거 61.25%/70.83%와 같은 정의이며 직접 비교할 수 있다.
- 합산 rubric(수정 전 HEAD 방식)으로 매기면 **24/24 불일치**. 합산이 실제로 값을 바꾸고
  있었다는 Codex의 확인을 재현한다.
- 배치별 `task` 레이어 평균: A/r2 60.00%, A/r3 62.50%, B1/r2 46.67%, B1/r3 70.83%,
  B2/r2 66.67%, B2/r3 75.00%. Codex 라운드 2 표의 regex 평균과 일치한다.
- 새로 분리된 축: `contract_regex`는 A와 B1에서 0%, B2에서 100%. 이 차이가 그동안 품질
  점수에 섞여 있었다.

## 2. provenance 스탬프

`scripts/provenance.mjs`를 추가하고 runner가 실행 시작 시점에 한 번 수집한다.
commit은 dirty 작업 트리의 후보 상태를 구분하지 못하므로, **내용 해시를 1차 식별자**로 둔다.

`<output>/provenance.json`에 전체 manifest를, 각 raw 레코드의 `provenance` 필드에 식별자만
싣는다.

- **대상**: plugin 작업 트리(`akasha/`)와 codex가 실제로 읽는 marketplace cache 사본을
  각각 해싱하고 일치 여부(`runtime_matches_worktree`)를 기록한다. 작업 트리만 고치고
  재설치하지 않은 상태로 잰 수치를 사후에 식별할 수 있다.
- **측정 도구**: runner·lib·analyzer·key scorer·provenance 모듈, `tasks.json`,
  `configs.json`의 파일별 해시와 합성 `harness_hash`. fixture 트리와 정답 키 트리도 별도 해시.
- **버전**: `rubric_layout_version`, `regex_scorer_version`, `contract_validator_version`,
  `key_scorer_matcher_version`, `codex_cli_version`.
- **git**: commit, short, branch, `describe --dirty`, 수정된 tracked 경로, untracked 경로.
- **실행**: 모델, reasoning effort, sandbox, approval policy, 그리고 레코드별 `command_argv`.
- **스냅샷**: 실제 실행에 쓰인 plugin 사본 + fixture + 정답 키 + harness 스크립트를
  `<output>/snapshot/`에 보관한다(약 584KB). `--no-snapshot`으로 끌 수 있다.

analyzer는 배치 안의 스탬프가 갈리면(`subject_hash`·`harness_hash`·`fixtures_hash`·
`quality_score_scope` 중 하나라도 두 값 이상) `provenance_gate`로 승격을 막는다. 스탬프가
아예 없는 과거 기록은 `consistent: null`이라 게이트를 켜지 않는다.

key scorer 출력에도 raw 레코드의 `provenance`를 그대로 옮겨, 채점 결과가 어느 실행 상태에
대한 것인지 유지된다.

### 검증

- `--dry-run`으로 실제 수집 경로를 실행했다. `subject_hash` 산출, cache/worktree 일치 판정,
  스냅샷 복사, `provenance.json`·`manifest.json` 기록이 모두 동작한다.
- 회귀 1건 수정: `git status --porcelain`의 선행 공백을 `trim()`이 지워 첫 줄 경로의 첫
  글자가 잘렸다(`cripts/...`). 임시 git 저장소를 만드는 회귀 테스트를 추가했다.
- `npm run eval:model-routing:test` 통과. 해시 결정성·민감도, 레이어 분리, provenance 게이트,
  과거 기록 하위 호환을 모두 검사한다.
- key scorer 결정성 검사 재실행: PASS (rows=24, doubled=48).

## 3. 버전 A/B runner를 `scripts/`로 승격

0.15.0 vs 0.14.0 비교는 `scripts/run-akasha-routing-ab.mjs`(inherit vs routed)가 아니라
`benchmarks/model-routing/archived-traces/*/run-codex-ab.mjs`라는 임시 스크립트로 돌아갔다.
그 스크립트에는 다음 문제가 있었다.

- provenance가 하드코딩 문자열이었다: `plugin_commit: item.condition === 'A' ? '92c3cbd' : '2e027c8'`.
  측정한 값이 아니라 사람이 적은 값이라, 그대로 다시 돌리면 같은 귀속 불가 문제가 재발한다.
- 계약 검증(`validateAkashaReview`)을 호출하지 않아 계약 준수를 아예 재지 않았다.
- `scripts/` 밖에 있어 테스트·검증 대상이 아니었다.

`scripts/run-akasha-version-ab.mjs`로 승격하면서 바꾼 것.

- **조건별 subject 해시.** 조건마다 플러그인이 다르므로 배치 단위 해시로는 부족하다. A와 B의
  트리를 각각 해싱해 레코드마다 그 조건의 해시를 찍는다.
- **읽는 트리만 해싱.** codex는 프로젝트 로컬 `.agents/`의 `skills`·`knowledge`·`agents`(또는
  `roles`)만 읽는다. subject 해시는 이 하위 트리만 대상으로 하고, 전체 트리 해시는 참고로
  따로 남긴다. `.claude-plugin/plugin.json`의 버전 문자열처럼 동작에 영향 없는 차이로 해시가
  흔들리지 않는다.
- **run마다 복사본 무결성 검사.** 준비된 `.agents/`를 다시 해싱해 스탬프한 subject와 다르면
  즉시 중단한다. 배치 중간에 복사가 어긋난 상태로 계속 도는 일을 막는다.
- **선언 버전을 읽어서 기록.** `plugin.json`의 `version`을 읽는다(타이핑하지 않는다).
- **A와 B 내용이 같으면 실행 거부.** 비교가 성립하지 않는 실행을 시작하지 않는다.
- **계약·오탐 레이어 추가.** `quality_contract_valid`, `contract_score_regex`,
  `false_positive_guard_score`를 별도 축으로 기록한다. 기준선 0.14.0은 계약 자체가 없으므로
  `quality_contract_valid: false`가 정상이며, 이는 품질 점수에 합산되지 않는다.
- 기존 지표(`knowledge_documents_read`, 인용 grounding, 역할 정확도)는 그대로 유지했다.

검증: `--dry-run`으로 A(0.14.0)·B(0.15.0) 양쪽 fixture를 준비해 확인했다. 두 조건의 scoped
diff가 바이트 수까지 동일(r2 1038B, r3 2035B)해 플러그인 교체가 검토 대상 diff를 건드리지
않음을 확인했고, 준비된 `.agents/` 해시가 원본 subject 해시와 일치했다(A `5f7a0f1f…`,
B `aa3b4333…`).

### 소급 복구된 과거 provenance

archived-traces에 각 배치의 A/B 플러그인 트리가 그대로 남아 있어, 새 해시 모듈로 소급
식별이 가능했다.

| 트리 | subject(전체 트리) 해시 | 파일 | bytes |
| --- | --- | ---: | ---: |
| 1차 배치 A (0.14.0) | `dd10d311…` | 86 | 257,070 |
| 2차 배치 A (0.14.0) | `dd10d311…` | 86 | 257,070 |
| 1차 배치 B (후보) | `771d4eff…` | 86 | 277,157 |
| 2차 배치 B (후보) | `94a39bb4…` | 86 | 281,661 |

두 배치의 기준선은 바이트 동일하지만 **후보는 서로 다르다.** 차이 나는 파일은 11개 —
역할 문서 10개 전부와 `skills/akasha/SKILL.md`(+19줄)다.

따라서 "B 두 배치의 12.08%p 차이는 동일 코드의 실행 분산"이라는 가설은 **제거된다.** 후보
상태가 실제로 달랐다. 다만 이것이 곧 "후보 차이가 12.08%p를 만들었다"는 뜻은 아니다.
셀당 3회로는 후보 효과와 실행 분산의 크기를 나눌 수 없고, 두 요인이 함께 작용했을 수 있다.
현재 말할 수 있는 것은 **"두 배치는 서로 다른 후보였고, 따라서 동일 조건의 반복으로 취급할
수 없다"**까지다.

## 4. r3-K2 복원과 정답 키 ↔ 채점기 대조

r3-K2(`prisma/schema.prisma`의 `@unique` 제거 → owner당 project 중복 허용)는 정답 키에
`required: true`로 있었지만 채점기 `RULES`에는 규칙이 없었다. 키에는 있는데 채점기에서
조용히 빠지는 상태였고, 오프라인 재채점에서는 "측정 시점 지식 문서 부재로 전원 미커버"라는
이유로 집계에서도 빠져 있었다.

- 채점기에 `r3-K2` 규칙 추가: `location`이 `schema.prisma`이고 `diff_evidence`에 `unique`가
  있는 `위반`/`introduced_by_diff` finding. 근거 공백(K3)과는 classification으로 갈린다.
- **정답 키에 있는 필수 키가 채점기에 없으면 실행이 즉시 실패한다**(`assertRuleCoverage`).
  같은 누락이 다시 조용히 생기지 않게 하는 것이 이번 수정의 핵심이다. 반대로 키에 없는
  채점 규칙(orphan)도 실패시킨다.
- 정답 키 `r3.json`을 `final-2`로 올리고 `scoring_history`에 분모 변화를 명시했다:
  final-1은 7키, final-2는 8키. **과거 커버리지 수치는 7키 분모이므로 final-2 수치와 직접
  비교하지 않는다.**
- 채점기 출력에 `key_version`과 `keys_scored`를 넣어 어떤 키 집합으로 매긴 값인지 파일만
  보고 알 수 있게 했다. `MATCHER_VERSION`은 `matcher-2`로 올렸다.

### K2는 양 조건에 동일 적용된다

판정 근거 문서 `knowledge/data/unique-constraint-integrity.md`는 후보(0.15.0)에는 있고
기준선(0.14.0)에는 없다. Codex 합의대로 이는 제외 사유가 아니라 지식 snapshot 효과의
일부이므로, 양 조건에 같은 키를 적용하고 결과를 그대로 기록한다.

저장된 계약 JSON 응답 6건을 final-2로 재채점한 결과 r3 3건 모두 K2 미커버였다(기존 판단과
일치). 차이는 이제 **집계에서 빼는 대신 미커버로 정직하게 기록된다**는 점이다.

## 5. 실행 방법

버전 A/B(0.15.0 vs 0.14.0):

```
node scripts/run-akasha-version-ab.mjs --output DIR --baseline PATH_TO_0_14_0 --dry-run
node scripts/run-akasha-version-ab.mjs --output DIR --baseline PATH_TO_0_14_0 --repetitions 5
node scripts/akasha-key-scorer.mjs --raw DIR/raw.jsonl --keys benchmarks/model-routing/answer-keys --determinism-check
```

`--candidate`를 생략하면 저장소의 `akasha/`가 후보가 된다. `--start-at N`·`--only A|B`로
중단된 배치를 이어서 돌릴 수 있다.

모델 라우팅 A/B(inherit vs routed):

```
node scripts/run-akasha-routing-ab.mjs --output DIR --dry-run   # 비용 없음. fixture·provenance 확인
node scripts/run-akasha-routing-ab.mjs --output DIR --repetitions 3
node scripts/analyze-akasha-routing-ab.mjs --input DIR/raw.jsonl
```

`--dry-run`은 fixture diff 검증과 provenance 수집까지만 하고 모델을 호출하지 않는다.
돈을 쓰기 전에 `runtime_matches_worktree`가 `true`인지 확인하는 용도다.

## 6. 사전 등록 — 실행 전에 확정한 규칙 (2026-08-24)

측정을 시작하기 전에 아래를 고정한다. 결과를 본 뒤에 바꾸지 않는다.

### 주지표

**과업별(run 단위) 정답 커버리지.** r2와 r3를 하나의 숫자로 합치지 않는다. 한 과업 안에서는
런마다 분모가 같아 run-macro와 key-micro가 항상 일치하므로 집계 방식에 따른 뒤집힘이
발생하지 않는다. pooled 수치는 참고로만 병기한다.

부지표 3개를 함께 보고한다.

1. **finding 단위 오탐(FP)** — `FP 합계`, `FP/run`, `FP가 발생한 run 비율`을 분리. 오탐은 키
   분모와 무관하므로 두 과업을 합산해 보고해도 된다.
2. **근거 적합성** — 채점기의 `grounding`(적합/부적합/미기재).
3. **계약 유효성·scorable 비율** — `quality_contract_valid`, 채점 가능 응답 비율. 품질 점수에
   합산하지 않는다.

### 반복 수와 정지 규칙

- **1단계: 반복 3회 = 12런.** 이것으로 끝내는 것이 기본이다.
- **2단계 조건부 확장:** 주지표에서 두 조건의 과업별 커버리지 차이가 **키 1개 미만**이고
  동시에 **FP가 완전히 갈리지 않으면**(양쪽 모두 FP 발생 run이 있으면), 반복 4·5회를
  `--start-at 13`으로 이어붙여 20런으로 만든다. 그 외에는 확장하지 않는다.
- 확장 시 provenance의 `subject_hash`가 1단계와 동일해야 한다. 다르면 이어붙이지 않고
  전체를 다시 돌린다.
- 20런까지 가고도 주지표가 갈리지 않으면 승패를 선언하지 않고 **`판정 불가`로 종료**한다.

### 통계적 주장의 한계 (미리 명시)

조건당 3런에서는 한 과업만 떼어 본 이진 결과가 완전히 갈려도 우연 확률이 0.10 밑으로
내려가지 않는다(Fisher exact 상한). 따라서 **과업 단독의 유의성 주장은 하지 않는다.**
과업별 커버리지는 기술 통계로 보고하고, 통계적 대조는 두 과업을 합산할 수 있는 FP 지표에
한정한다.

### 조건 정의

- **A(기준선)**: `benchmarks/model-routing/archived-traces/quality-final/A/akasha` (0.14.0)
- **B(후보)**: 저장소 작업 트리 `akasha/` (0.15.0, 커밋 `dfb4a4d`)
- r3-K2는 양 조건에 동일 적용한다(4절).

## 7. 아직 열려 있는 결정 (실행 전 사전 등록 필요)

코드로 해결되지 않는 항목이며, 재측정 전에 사람이 정해야 한다.

1. **주지표 확정** — run 평균(macro)과 정답 키 개수(micro) 중 어느 쪽을 공식 지표로 쓸지.
   pooled 집계에서는 방향이 뒤집힌다(macro 94.4→95.2%, micro 96.7→93.3%).
   **권고: 과업별 run 단위를 주지표로 쓰고, 두 과업을 한 숫자로 합치지 않는다.** 한 과업
   안에서는 런마다 분모가 같아 macro와 micro가 항상 동일하므로 뒤집힘이 발생하지 않는다.
   뒤집힘은 키 수가 다른 두 과업(r2 3키, r3 7키)을 pooling한 결과다. 과업별로 보면
   r2 88.9%→100%, r3 100%→90.5%로 방향이 서로 다르며, 이 사실은 pooled 숫자에서 가려진다.
2. **반복 수 규칙** — 최소 의미 차이와 허용 불확실성을 먼저 정하고, pilot 분산으로 반복 수를
   고정한다. 예산 안에서 판별력이 부족하면 승패 대신 `판정 불가`로 끝낸다.
3. ~~**r3-K2 복원**~~ — 4절에서 처리했다. 남은 것은 사실 발견·diff 증거·지식 뒷받침을
   분리 보고할지 여부이며, 현재 채점기는 커버 여부와 `grounding`(적합/부적합/미기재)을
   나눠 기록한다.
