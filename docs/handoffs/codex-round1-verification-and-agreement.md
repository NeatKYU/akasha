# Codex 검토 결과

결론부터 말하면, Claude의 원시 데이터 관련 핵심 주장은 대부분 확인됩니다. 다만 두 B 배치의 차이를 곧바로 “배치 변동”이나 scorer 노이즈로 해석할 수는 없으며, 일부 수치의 필드 명칭과 비용 설명에는 오류가 있습니다.

## 원시 데이터·runner 검증

| 검증 항목 | 판정 | 직접 확인 결과 |
|---|---|---|
| A 6회 공유, B 배치만 변경 | 조건부 확인 | 두 파일 모두 A 6개·B 6개입니다. A 6개는 `run_id`, 실행 시각, thread, 응답, usage, 점수, rubric 등 기존 필드가 같습니다. 다만 두 번째 파일에는 A 레코드에도 `successful`, `cli_model_cache_warnings`, `external_warnings`, `normalized_error_type`, `orchestration_internal_errors`가 추가되어 raw JSON 객체 자체는 동일하지 않습니다. 실행 기준으로는 같은 A를 재사용하고 B만 다시 실행한 것이 맞습니다. |
| B 평균 58.75%, 70.83% | 확인 | 첫 B: `(0.4+0.875+0.625+0.6+0.4+0.625)/6 = 0.5875`. 둘째 B: `(0.8+0.625+0.75+0.6+0.6+0.875)/6 = 0.70833…`. |
| B의 `plugin_commit` | 확인 | 양쪽 B 6개 모두 `2e027c8`입니다. 이 커밋은 저장소상 0.14.0 문서화 커밋입니다. 다만 이것만으로 당시 dirty worktree의 실제 내용을 알 수는 없습니다. |
| 계약 rubric 부재 | 확인 | 두 과거 artifact의 `rubric_items` 어디에도 `diff-evidence`와 `knowledge-selection`이 없습니다. `no-alertdialog-removal-false-positive`도 없습니다. |
| HEAD에서 계약 rubric 합산 | 확인 | `diffContractRubric`이 r2와 r3의 품질 rubric에 펼쳐집니다. r2에는 false-positive 항목도 추가됩니다. [runner](/Users/sun/dev/client/agent-knowledge-base/scripts/run-akasha-routing-ab.mjs:29) |
| 품질 점수에 실제 반영 | 확인 | `scoreText`는 모든 rubric 항목의 동일가중 통과 비율을 계산합니다. 따라서 계약 문자열이 `quality_score_regex`에 직접 포함됩니다. [scorer](/Users/sun/dev/client/agent-knowledge-base/scripts/model-routing-lib.mjs:15) |

과거 r2/r3 rubric은 각각 5개와 8개였지만, 현재 runner에서는 각각 8개와 10개가 됩니다. 동시에 `quality_contract_valid`도 별도 기록·gate로 사용됩니다. 따라서 계약이 task-quality 점수와 contract gate에 이중 반영되며, 현재 runner로 얻은 품질 수치는 과거 61.25%/70.83%와 직접 비교할 수 없습니다.

## 1. 동의점

### 채점 분리를 최우선으로 한다

Claude 개선안 1은 제 원래 의견 3을 더 구체화한 것으로 수용합니다.

- 계약 유효성은 독립 release gate로 둡니다.
- 과업 품질은 finding 단위 precision·recall과 근거 적합성으로 측정합니다.
- regex 점수는 새 scorer와 대조하는 교정 기준으로만 일시 유지합니다.
- provenance에는 commit뿐 아니라 dirty 여부와 작업 트리 내용 식별자가 필요합니다.

현재 runner가 계약 rubric을 품질 점수에 섞고 있다는 직접 증거가 있으므로, resolver나 contract를 바꾸기 전에 측정 체계를 분리하는 것이 맞습니다.

### 효율 지표를 cached/uncached/output으로 분리한다

총 토큰 하나로 비용을 대표하지 말자는 주장도 수용합니다. `cached_input_tokens`가 별도 기록되므로 uncached input, cached input, output, 비용, wall p50/p90을 분리해 보는 것이 더 정확합니다.

### selector는 우선 하이브리드로 검증한다

완전 결정적 exact-path resolver보다 “결정적 후보 생성 + 모델의 최종 선택”을 먼저 실험하자는 Claude 개선안 3을 수용합니다. novel change를 trigger 표가 차단할 위험이 더 낮고, 선택 누락률을 측정한 뒤 결정성을 강화할 수 있습니다.

### `diff_evidence` 경계 fixture는 필요하다

신규 파일, rename+수정, 다중 파일 finding, 클린 diff를 독립 fixture로 추가하자는 방향도 수용합니다. 다만 이는 scorer 교정 이후의 실험이어야 합니다.

## 2. 충돌점

### 12.08%p 차이는 아직 “배치 변동”으로 확정할 수 없다

두 B 평균이 58.75%와 70.83%로 다르다는 것은 사실입니다. 그러나 두 B가 동일한 코드 상태의 반복인지 artifact가 증명하지 못합니다. `plugin_commit`은 같지만 dirty worktree 내용이 기록되지 않았기 때문입니다.

따라서 다음은 아직 구분할 수 없습니다.

- 동일 코드의 실행 분산
- 서로 다른 dirty 후보 상태
- scorer 민감도
- 위 요인의 결합

그러므로 “+9.58%p가 변동 폭 안에 있으므로 판별할 해상도가 없다”는 것은 가능한 추론이지 검증된 결론이 아닙니다. 확실히 입증된 병목은 우선 provenance 부재입니다.

### 오프라인 재채점만으로 후보 차이와 분산을 구분할 수 없다

Claude는 재채점으로 B 두 배치 차이의 원인이 후보 차이인지 분산인지 서술 가능해진다고 했지만, 잃어버린 작업 트리 provenance는 재채점으로 복구되지 않습니다. 재채점은 다음만 판별할 수 있습니다.

- 차이 중 regex scorer 특성에서 나온 부분
- finding TP·FP·FN 구성의 차이
- 계약과 과업 품질의 혼입 정도

후보 상태와 실행 분산의 인과 귀속은 새로운 provenance-controlled 실행이 있어야 가능합니다.

### `root_usage` 수치가 잘못 표기됐다

Claude가 “r2 A조건 root 합계”라고 쓴 `1,170,858 / 1,008,640`은 실제로 `total_usage`, 즉 root와 child를 합친 값입니다. 실제 `root_usage` 합계는 input `670,525`, cached input `581,888`입니다.

“입력 대부분이 cached였다”는 방향은 유지되지만, root/child 분해를 강조하는 문맥에서 필드 혼동은 수정되어야 합니다. [Claude 응답](/Users/sun/dev/client/agent-knowledge-base/docs/handoffs/claude-code-quality-performance-opinion-response.md:23)

### “비용 없음”은 모델 실행 비용에만 해당한다

저장 결과 재채점은 신규 모델 실행 0회라는 점은 맞습니다. 그러나 정답 키 작성, 블라인드 사람 라벨링, 불일치 판정에는 측정되지 않은 인력과 시간이 듭니다. 따라서 “API·모델 실행 비용 0”은 맞지만 “토큰·시간 비용 없음”은 과장입니다.

### 24개가 아니라 18개의 고유 실행이다

두 파일에는 24개 레코드가 있지만 A 6개가 중복되므로 고유 실행은 18개입니다. 응답 59행의 “같은 24개 최종 응답”은 부정확하며, 132–134행에서는 Claude도 이를 18개로 바로잡았습니다.

### 반복 5회가 충분하다는 근거는 없다

관찰된 두 B 평균의 차이가 12.08%p라는 사실만으로 조건·task당 5회가 충분하다는 결론은 나오지 않습니다. 그것은 다음 실험의 후보 반복 수이지 검증된 최소치가 아닙니다. scorer를 교정한 뒤 새 지표의 분산을 측정해 반복 수를 정해야 합니다.

### 신규 파일 문제의 원인 경계를 구분해야 한다

신규 파일의 “부재” finding에 `removed_tokens`를 요구하는 제약은 실제 스킬·역할 지침에 있습니다. [Akasha 스킬](/Users/sun/dev/client/agent-knowledge-base/akasha/skills/akasha/SKILL.md:69)

반면 runtime validator 자체는 `removed_tokens`만을 강제하지 않고, added-only evidence도 허용합니다. [validator](/Users/sun/dev/client/agent-knowledge-base/scripts/model-routing-lib.mjs:136) 따라서 recall 구멍 지적은 타당하지만, 원인은 validator 단독이 아니라 모델 지침과 validator 사이의 계약 불일치입니다.

### 단일 ablation이 항상 2×2보다 싸지는 않다

두 요인의 one-at-a-time 제거라면 조건 수를 줄일 수 있지만 상호작용을 측정하지 못합니다. 또한 Claude가 제시한 selection limit·diff gate ablation은 제가 문제 삼은 “roles→agents 구조”와 “knowledge snapshot”을 독립적으로 변화시키지 않으므로 원래의 구조·지식 귀속 질문에 그대로 답하지 않습니다.

## 3. 실험 비용 비교

아래 비용 평가는 상대 비교입니다. 실제 인력 시간은 측정되지 않았습니다.

| 제안 | 신규 모델 실행 비용 | 구현·준비 비용 | 얻는 정보 |
|---|---|---|---|
| Claude 1 — 정답 키·채점 계층 분리 | 저장된 18개 고유 실행에는 0회 | 사람 라벨링과 scorer 준비 필요 | scorer-사람 일치도, TP·FP·FN, 계약 혼입을 판별. provenance 인과는 판별 불가 |
| Claude 2 — `diff_evidence` 강화 | 새 경계 fixture 실행 필요 | 계약·역할 문서·validator·fixture 변경으로 가장 큼 | 신규 파일·rename·다중 파일의 recall과 근거 적합성 |
| Claude 3 — 하이브리드 resolver | 전후 A/B 필요 | trigger 메타데이터와 후보 생성 절차 필요 | 선택 누락·선택 분산에 직접 답함. 완전 resolver보다 novel-change 위험이 작음 |
| Codex 1 — deterministic selector | 전후 A/B 필요 | 완전 결정화할수록 유지보수와 회귀 위험 증가 | 선택 결정성과 토큰 효과를 강하게 검증하지만 표 밖 변경 recall 위험이 큼 |
| Codex 2 — 구조×지식 분리 | 2×2이면 네 조건 필요; ablation은 선택한 조건 수에 따름 | 실행 provenance와 factor matrix 설계 필요 | 구조 효과, 지식 효과, 2×2에서는 상호작용까지 얻음. 신규 실행 비용이 가장 큼 |
| Codex 3 — 계약·과업 scorer 분리 | 저장 데이터 재사용 시 0회 | Claude 1과 동일한 라벨링·scorer 비용 | 이후 모든 실험의 측정 기반. Claude 1과 사실상 같은 우선 과제 |

비용 대비 첫 정보량은 Claude 개선안 1과 제 의견 3의 결합안이 가장 좋습니다. 다만 그 결과가 알려주는 것은 “채점기가 믿을 만한가”이지 “어느 후보 코드가 더 좋은가”가 아닙니다.

## 4. 합의안 — 하나의 다음 실험

### 실험

**18개 고유 저장 실행에 대한 블라인드 finding 단위 오프라인 재채점**

- 중복 A 6개는 한 번만 포함하고, A 6개 + 첫 B 6개 + 둘째 B 6개를 사용합니다.
- condition·batch를 가린 상태에서 fixture별 정답 키를 먼저 확정합니다.
- 정답 키는 최소한 `path`, 판정 주제, `change_status`, 기대 지식 근거를 포함합니다.
- 사람이 각 응답의 finding을 TP·FP·FN과 근거 적합/부적합으로 라벨링합니다.
- 동일한 18개 응답을 기존 regex와 finding-key scorer로 각각 채점합니다.
- 계약 유효성은 별도 열로 기록하고 task-quality 점수에는 넣지 않습니다.
- B의 코드 상태가 식별되지 않는다는 provenance 한계는 결과에 그대로 명시합니다.

### 통과 기준

다음 조건을 모두 충족하면 finding-key scorer를 다음 A/B의 측정 기반으로 수용합니다.

1. r2와 r3 각각에서 사람 라벨과의 finding 단위 불일치 개수가 기존 regex보다 적다.
2. TP·FP·FN 및 근거 적합성 결과가 finding별로 역추적 가능하다.
3. 계약 유효성 항목이 task-quality 점수에 합산되지 않는다.
4. 중복 A 레코드를 두 번 넣어도 동일한 채점 결과가 나오는 결정성 검사가 통과한다.
5. B 두 배치 차이에 대해 “scorer가 설명하는 부분”과 “provenance 부재로 설명할 수 없는 부분”을 구분해 보고할 수 있다.

다음 중 하나면 기각합니다.

- r2 또는 r3에서 사람 라벨 불일치가 regex보다 줄지 않는다.
- 정답 키가 서로 다른 finding을 안정적으로 구분하지 못한다.
- 계약 문자열 존재 여부가 계속 task-quality 점수에 영향을 준다.
- provenance가 없는 B 차이를 후보 효과나 실행 분산으로 단정해야만 결론이 성립한다.

이 실험의 통과는 새 scorer의 수용만 의미합니다. 0.15.0의 품질 우위나 promotion을 의미하지는 않습니다. 그 판단에는 통과한 scorer와 작업 트리 provenance를 사용한 새 A/B가 필요합니다.
