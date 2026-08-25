# 최종 판정

**보고서의 산술은 확인되지만, finding-key 채점기를 다음 A/B의 측정 기반으로 수용한다는 판정에는 동의하지 않습니다. 현 상태에서는 수용 보류입니다.** 증거 기반 matcher 설계는 유망하지만, 합의 기준 2·4·5가 충족되지 않았습니다.

참고로 answer key의 실제 위치는 `blind-labeling/answer-keys/`가 아니라 [benchmarks/model-routing/answer-keys](/Users/sun/dev/client/agent-knowledge-base/benchmarks/model-routing/answer-keys/r2.json:1)입니다.

## 1. 데이터 재검증

[final-labels.json](/Users/sun/dev/client/agent-knowledge-base/benchmarks/model-routing/blind-labeling/final-labels.json:11), [rescoring-results.json](/Users/sun/dev/client/agent-knowledge-base/benchmarks/model-routing/blind-labeling/rescoring-results.json:4), [r2 answer key](/Users/sun/dev/client/agent-knowledge-base/benchmarks/model-routing/answer-keys/r2.json:6), [r3 answer key](/Users/sun/dev/client/agent-knowledge-base/benchmarks/model-routing/answer-keys/r3.json:6)와 두 `raw.jsonl`을 직접 대조했습니다.

| task | 배치 | 재계산 커버리지 | FP | regex 평균 |
|---|---|---:|---:|---:|
| r2 | A | 8/9 = 88.9% | 4 | 60.0% |
| r2 | B1 | 6/9 = 66.7% | 0 | 46.7% |
| r2 | B2 | 9/9 = 100.0% | 0 | 66.7% |
| r3 | A | 21/21 = 100.0% | 4 | 62.5% |
| r3 | B1 | 21/21 = 100.0% | 0 | 70.8% |
| r3 | B2 | 19/21 = 90.5% | 0 | 75.0% |

보고서의 전체 값도 맞습니다.

| 집계 방식 | A | B1 | B2 |
|---|---:|---:|---:|
| run 평균 커버리지 | 94.4% | 83.3% | 95.2% |
| 키 micro 커버리지 | 29/30 = 96.7% | 27/30 = 90.0% | 28/30 = 93.3% |
| FP 합계 | 8 | 0 | 0 |

따라서 `94.4%→95.2%`는 **run-macro 집계**입니다. 키 단위 micro 집계에서는 `96.7%→93.3%`로 방향이 달라집니다. 다음 측정에서는 어느 값을 주지표로 쓸지 사전 고정해야 합니다.

regex 불일치도 재현됐습니다.

- r2: `10/27`
- r3: `14/63`
- 합계: `24/90`

원본 rubric 판정과 사람 확정 키를 직접 매핑한 결과이며 [보고서의 24개 목록](/Users/sun/dev/client/agent-knowledge-base/benchmarks/model-routing/blind-labeling/rescoring-results.json:332)과 일치합니다.

기계 채점도 evidence-only 규칙을 재구성해 확인했습니다.

- B2 JSON 6건
- r2: 3회 × `(필수 3키 + 선택 확인 1키)` = 12쌍
- r3: 3회 × 7키 = 21쌍
- 합계: **33/33 일치**
- `basis`까지 검색 대상으로 넓히면 **31/33**이며, [R11 원본](/Users/sun/dev/client/agent-knowledge-base/benchmarks/model-routing/archived-traces/quality-final/artifacts/raw.jsonl:6)의 r3-K6·K8이 교차 오인정됩니다.

따라서 “증거 필드만 앵커로 써야 한다”는 결론은 확인됩니다.

## 2. 합의 기준 5개 판정

합의 기준은 [라운드 1 합의문](/Users/sun/dev/client/agent-knowledge-base/docs/handoffs/codex-round1-verification-and-agreement.md:125)을 적용했습니다.

| 기준 | 최종 판정 | 이유 |
|---|---|---|
| 1. r2·r3 각각 regex보다 사람 불일치 감소 | **부분 통과** | 동일한 B2 JSON 범위에서는 r2 `0/9 대 3/9`, r3 `0/21 대 3/21`로 감소. 그러나 18개 전체에는 기계 scorer가 적용되지 않았으므로 전체 실험 기준은 미충족 |
| 2. TP·FP·FN·근거 적합성 finding별 역추적 | **미통과** | `final-labels`는 응답별 covered 키와 FP 개수만 저장하고, `rescoring-results`도 이를 복제합니다. 원본 finding→키 매핑과 근거 적합성 판정이 저장돼 있지 않습니다 |
| 3. 계약 유효성 비합산 | **통과(오프라인 결과 한정)** | keyScore에는 계약 항목이 없습니다. 다만 현재 runner는 여전히 `diffContractRubric`을 품질 rubric에 합산합니다 |
| 4. 중복 입력 결정성 검사 | **미통과** | “순수 함수이므로 결정적”이라는 설명만 있고, 합의했던 중복 A 입력 검사의 결과나 실행 가능한 matcher가 없습니다 |
| 5. B 차이의 설명 가능/불가 구분 | **미통과** | score 구성은 R06으로 설명되지만, [보고서의 “후보 차이가 주원인” 판정](/Users/sun/dev/client/agent-knowledge-base/docs/handoffs/rescoring-report.md:40)은 provenance 없이 원인을 귀속합니다 |

추가로 두 answer key는 여전히 `version: draft-1`, `status: 사람 확정 대기`입니다([r2](/Users/sun/dev/client/agent-knowledge-base/benchmarks/model-routing/answer-keys/r2.json:3), [r3](/Users/sun/dev/client/agent-knowledge-base/benchmarks/model-routing/answer-keys/r3.json:3)). `final-labels`의 사람 확정 선언과 상태가 일치하지 않아 scorer 입력의 동결 여부도 명확하지 않습니다.

기각 조건 중 “provenance 없는 B 차이를 후보 효과나 실행 분산으로 단정해야만 결론이 성립”하는 문제가 보고서 결론 2에 나타납니다. 따라서 **보고서의 ‘기각 조건 해당 없음’에는 동의하지 않습니다.**

## 3. `오탐 8→0` 재해석

다음 범위에서는 동의합니다.

> 사람 확정 라벨이 적용된 이 18개 저장 실행에서 A의 FP 8건이 B2에서는 0건이었다.

다만 다음 표현은 아직 증명되지 않았습니다.

- “0.15.0이 오탐을 제거했다”: 작업 트리 provenance가 없어 인과 귀속 불가
- “precision이 개선됐다”: 예측 finding 총수와 finding별 TP/FP 매핑이 없어 precision을 계산하지 않음
- “커버리지가 개선됐다”: macro는 소폭 상승하지만 micro는 하락

따라서 현재의 정확한 표현은 **“이 표본에서 FP가 8→0으로 감소했고, 커버리지는 집계 방식에 따라 거의 비슷하거나 소폭 낮다”**입니다.

다음 측정에는 다음 지표가 추가돼야 합니다.

- run-macro와 key-micro 커버리지를 모두 보고하고 주지표를 사전 지정
- FP의 단위를 finding으로 고정하고 `FP 합계`, `FP/run`, `FP 발생 run 비율` 분리
- finding→key 매핑을 저장해 실제 precision 계산
- 근거 적합성을 별도 축으로 기록
- `contract-valid rate`와 `scorable rate` 별도 보고

## 4. hardened 0.15.0 vs 0.14.0 실행 계획

### Provenance 스탬프

방향에는 동의하지만 `git describe --dirty + tree hash`만으로는 부족합니다. tree hash가 Git index 기준이면 unstaged·untracked 실행 입력을 식별하지 못할 수 있습니다.

각 run에 다음을 고정해야 합니다.

- commit과 dirty 상태
- 실제 실행에 복사된 plugin 전체의 content manifest hash
- runner·scorer·task·fixture·answer-key 각각의 hash/version
- CLI, 모델, reasoning effort, 실행 명령
- scorer 규칙과 matcher 버전
- 가능하면 실제 실행 snapshot 보관

### `diffContractRubric` 분리

강하게 동의하며 **재측정 전 필수 조건**입니다. 현재는 [runner](/Users/sun/dev/client/agent-knowledge-base/scripts/run-akasha-routing-ab.mjs:29)가 계약 rubric을 task rubric에 펼치고, [scoreText](/Users/sun/dev/client/agent-knowledge-base/scripts/model-routing-lib.mjs:15)가 동일 가중 평균에 넣습니다.

계약 유효성은 독립 hard gate로 두고 coverage·FP·근거 적합성에는 합산하지 않아야 합니다.

### 커버리지와 FP 분리

동의합니다. 다만 다음 네 축으로 확장해야 합니다.

1. required-key coverage
2. finding-level FP
3. evidence/knowledge grounding 적합성
4. contract-valid 및 scorable 여부

“precision”은 finding별 TP·FP가 저장된 뒤에만 사용해야 합니다.

### r3-K2 복원

동의합니다. K2는 실제 diff 효과이므로 **0.14.0과 hardened 0.15.0 양쪽에 동일하게 적용**해야 합니다. 0.14.0에 해당 지식 문서가 없었다면 그것은 제외 사유가 아니라 지식 snapshot 효과의 일부입니다.

다만 다음 측정에서는 다음을 분리해야 합니다.

- K2 사실을 찾았는가
- 올바른 diff 증거를 제시했는가
- 선택한 지식이 이를 뒷받침했는가

### 반복 수 결정

“새 지표의 분산을 보고 결정”만으로는 부족하고 사전 규칙이 필요합니다.

1. 별도 pilot에서 task별 coverage와 FP 발생 분산을 추정
2. 최소 의미 차이와 허용 불확실성을 먼저 정함
3. 그 기준으로 confirmatory 반복 수를 고정
4. pilot을 본실험에 포함한다면 사전 정의한 순차 정지 규칙을 사용
5. 최대 실행 예산에서 판별력이 부족하면 승패 대신 `판정 불가`로 종료

## 결론

**수치 검증은 통과했지만, finding-key 채점기의 전면 수용은 보류합니다.** 다음 A/B 전에 finding-level 감사 기록, 실행 가능한 matcher와 결정성 검사, 정확한 provenance, 계약 rubric 분리를 먼저 갖춰야 합니다. 그 조건을 충족하면 evidence-only finding-key scorer를 측정 기반으로 수용할 수 있습니다.
