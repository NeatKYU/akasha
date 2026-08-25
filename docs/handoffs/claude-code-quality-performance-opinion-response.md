# Claude Code 의견

작성일: 2026-08-24
대상: `docs/handoffs/claude-code-quality-performance-opinion-request.md` (기준 커밋 `dfb4a4d`)
작성 전 검토: 요청서 지정 11개 파일 전부, `git show dfb4a4d` 미사용, 외부 URL 미조회.
추가로 저장된 과거 실행 기록 2벌을 오프라인 재분석했다(코드·문서·설정 수정 없음):
`/private/tmp/akasha-quality-first-ab.nzjDof/artifacts/raw.jsonl`,
`/private/tmp/akasha-quality-final.kz2ctq/artifacts/raw.jsonl`.

## 현재 진단

- 동의하는 점:
  - 의견 3(scorer 분리)에 강하게 동의한다. 계약 유효성과 과업 품질은 다른 축이고, 지금
    구조화 JSON 계약이 이미 있으므로 finding 단위 정답 키 채점이 가능해졌다.
  - 의견 2(구조 효과·지식 효과 분리)에 동의한다. 단 2×2보다 단일 요인 제거 ablation이
    적은 실행으로 원인을 분리한다(아래 반론 절).
  - 의견 1의 문제 인식(선택 단계가 모델 자유 판단으로 남아 있다)에는 동의한다. 다만
    "다음 병목"이라는 우선순위 판단에는 동의하지 않는다.
- 동의하지 않는 점:
  - "다음 병목은 선택 단계의 결정성"이라는 진단. 저장된 실행 기록을 재분석한 결과,
    현재 채점 체계는 +9.58%p 크기의 효과를 신뢰 있게 판별할 해상도가 없다. 어떤 개선이든
    지금 scorer로 측정하면 노이즈와 구분되지 않으므로, 결정성 개선은 두 번째다.
  - 총 토큰을 1차 효율 지표로 쓰는 관점. r2 A조건에서 root_usage 합계는 input 670,525 중
    cached 581,888(86.8%), root+child total_usage 합계는 input 1,170,858 중
    cached 1,008,640(86.1%)이었다. 절대 토큰이 아니라 uncached input·output·비용으로
    나눠 봐야 하고, 이 분해는 이미 raw.jsonl에 있는데 요약·게이트에 쓰이지 않는다.
    (초판에서 total_usage 값을 root 합계로 잘못 표기했다 — Codex 지적으로 수정.)
- 가장 큰 병목: **측정 해상도와 실험 provenance.** 관찰된 사실 4가지:
  1. (관찰) 저장된 두 실행 벌은 A 6회(61.25%)를 공유하고 B만 다른 배치다. B 배치 1
     (08:16–08:35)은 58.75%, B 배치 2(08:43–08:53)는 70.83%. 같은 조건 라벨에서 배치 간
     12.08%p 차이가 났다. 이 차이가 실행 분산인지, 배치 사이의 dirty 후보 변경인지,
     scorer 민감도인지는 기록으로 귀속 불가다 — 확정된 병목은 provenance 부재이며,
     귀속이 닫히기 전까지 헤드라인 +9.58%p는 신뢰 구간을 말할 수 없는 수치다.
  2. (관찰) 두 B 배치 모두 `plugin_commit: 2e027c8`(0.14.0 문서 커밋)로 기록됐다. 후보
     변경이 작업 트리에만 있어, 어느 후보 상태가 70.83%를 냈는지 기록으로 구분할 수 없다.
  3. (관찰) 과거 A/B의 rubric에는 계약 항목(`diff-evidence`, `knowledge-selection`,
     `no-alertdialog-removal-false-positive`)이 없었다. 그런데 HEAD의
     `scripts/run-akasha-routing-ab.mjs:29-49`는 이 항목들을 품질 rubric에 합산한다.
     이 runner로 잰 다음 수치는 61.25%/70.83%와 정의가 다른 지표가 되어 직접 비교가
     불가능하고, 계약 준수가 "품질"로 계산되는 혼입이 새로 생겼다.
  4. (관찰) rubric은 r2 5항목(런당 20%p 계단), r3 8항목(12.5%p 계단)이고 per-run 점수는
     40–88%에 흩어져 있다. 조건·task당 3회 평균은 rubric 1–2개 항목 뒤집힘으로 5–7%p씩
     움직인다. regex 매칭은 최종 메시지 전체에 대한 전역 검색이라 서로 다른 finding의
     단어가 조합돼 통과할 수 있고, finding 단위 정오를 재지 못한다.

## 개선안 1 — 채점 계층 분리와 정답 키 기반 finding 채점

- 구분: 관찰된 사실(위 1–4) + 권고
- 가설: 채점을 (a) 계약 유효성 게이트, (b) finding 단위 precision/recall, (c) 근거 적합성,
  (d) 효율(uncached input·output·비용·wall p50/p90)로 분리하면, 지금까지의 품질 변화 중
  실제 과업 품질 변화분을 분리할 수 있고, 이후 모든 실험(ablation, resolver)의 판별력이
  생긴다. 현재 +9.58%p 중 일부 또는 전부가 배치 간 변동일 가능성이 있다.
- 변경 대상 범주: 측정 스크립트와 벤치마크 정답 데이터만. 스킬·에이전트·계약은 불변.
  - fixture별 정답 키: 기대 finding을 `path + 판정 주제 + change_status`로 명세
    (r2 접근성 회귀 3개, r3 계층별 결함 — 구조화 JSON의 `location`·`diff_evidence`와
    기계 대조 가능).
  - runner의 rubric에서 계약 항목 분리(계약은 이미 `quality_contract_valid`로 따로 있다).
  - 실행 provenance 스탬프: `git describe --dirty` + 작업 트리 내용 해시를 record에 기록.
  - 요약에 uncached/cached input 분해와 wall p90 추가(`summarize`에는 현재 p50뿐).
- 품질·토큰·시간 예상 방향: 실행 품질 자체는 불변(측정만 바뀜). 측정된 "품질 수치"는
  재보정되어 과거 수치와 단절되지만, 이후 비교의 신뢰도가 생긴다. 신규 모델 실행 비용은
  0(재채점은 저장된 trace 사용)이나, 정답 키 작성·사람 라벨링·불일치 판정의 인력 시간은
  별도로 든다(측정 안 함).
- 검증 방법: 저장된 고유 실행 18회(A 6 + B 배치별 6×2, 중복 A 제외)를 새 채점기로
  재채점하고, 사람이 같은 18개 최종 응답을 finding 단위로 라벨링한 소규모 키와
  일치도(불일치 항목 목록과 비율)를 본다.
  블라인드 LLM judge는 finding 하나씩, 원문 인용을 기계 검증(문자열 포함)하는 조건으로만
  보조 지표에 넣는다 — 과거 "응답에 없는 문장 귀속" 오류는 전문 단위 채점에서 나왔다.
- 통과 조건: 새 채점기와 사람 라벨의 finding 단위 일치도가 regex 채점보다 높고, 불일치가
  채점기 규칙으로 설명 가능. 재채점 결과에서 B 두 배치의 차이 원인이 (후보 차이인지
  분산인지) 정답 키 기준으로 서술 가능해진다.
- 회귀 조건: 정답 키 기반 채점이 사람 라벨과 regex보다 더 어긋나면 키 명세가 잘못된 것
  이므로 키를 수정하고, 그래도 어긋나면 채택하지 않는다.
- 대가: 정답 키 작성·유지 비용(fixture가 늘 때마다 키도 늘어난다). 과거 수치와의 연속성
  단절 — 0.14.0/0.15.0 비교는 재채점 값으로 다시 서술해야 한다.

## 개선안 2 — diff_evidence 적합성 강화: 앵커·신규 파일·rename·다중 파일

- 구분: 관찰된 사실(검증기 코드) + 추론 + 권고
- 가설: 현재 검증기는 토큰이 해당 파일 diff의 `-`/`+` 줄 "어딘가에" 포함되면 통과시킨다
  (`model-routing-lib.mjs:145` — 줄·hunk 앵커 없음). 그래서 형식상 유효하지만 판정을
  실제로 뒷받침하지 않는 증거가 통과할 수 있고, 반대로 다음 세 경우는 유효한 위반을
  구조적으로 낼 수 없다:
  1. (관찰) 신규 파일: "필수 속성 부재를 `introduced_by_diff`로 판정하려면 `removed_tokens`
     증거 필요" 규칙 때문에, 새로 추가된 파일의 필수 속성 누락(예: 새 다이얼로그에 role
     없음)은 위반으로 분류할 수 없다 — 삭제된 것이 없기 때문이다. recall 구멍이다.
     원인 경계(Codex 보완): runtime validator는 added-only 증거를 이미 허용하므로, 구멍은
     validator가 아니라 스킬·역할 문서의 지침과 validator 사이의 계약 불일치에 있다.
     수정 지점은 지침 쪽이 우선이다.
  2. (관찰) rename: diff 헤더 파싱이 `rename from/to`를 처리하지 않고, 순수 rename은
     ± 줄이 없어 증거 자체가 불가능하다.
  3. (관찰) 다중 파일 finding: `diff_evidence`가 단일 `path` 객체라 "schema 변경 + migration
     부재" 같은 파일 간 판정은 한쪽 증거만 담을 수 있다.
- 변경 대상 범주: 반환 계약(스킬·역할 문서의 `diff_evidence` 정의)과 runtime validator,
  경계 fixture. 계약 버전을 올리는 변경이므로 개선안 1로 판별력을 확보한 뒤에만 진행.
  - 신규 파일 예외: 컨테이너 요소가 diff로 새로 추가된 경우, 그 컨테이너의 `added_tokens`
    를 부재 판정의 증거로 인정(`new file` 헤더 파싱으로 기계 검증).
  - 토큰 고유성: 증거 토큰이 해당 파일 ± 줄 중 소수의 줄에만 나타날 것을 요구하거나
    hunk 앵커를 추가해 "어딘가 포함"을 좁힌다.
  - `diff_evidence`를 객체 배열로 확장해 다중 파일 판정을 표현.
- 품질·토큰·시간 예상 방향: 근거 적합성과 신규 파일 recall 상승 예상. 계약이 엄격해지는
  방향이므로 초기 invalid율 상승 위험. 토큰·시간은 소폭 증가(증거 필드가 약간 커짐).
- 검증 방법: 경계 fixture 3종을 추가해 전후 비교 — (a) 신규 파일로 접근성 결함을 추가하는
  diff, (b) rename+수정 diff, (c) 결함을 고치는 클린 diff(현재 fixture는 전부 회귀 주입형
  이라 정밀도를 재지 못한다 — 클린 diff에서 위반 0개가 정답). 근거 적합성은 개선안 1의
  사람 라벨로 표본 감사.
- 통과 조건: 신규 파일 fixture에서 위반 recall이 생기고, 클린 diff에서 위반 오탐이 늘지
  않으며, 계약 invalid율이 기존 fixture에서 악화되지 않는다.
- 회귀 조건: 기존 r2/r3에서 invalid율 또는 recall이 떨어지면 앵커 강도를 되돌린다.
- 대가: 계약 변경이 스킬·역할 문서 3벌·validator·fixture에 파급된다. 증거 규칙이 복잡해질
  수록 자식이 규칙 준수에 쓰는 출력 토큰이 늘고, 지나치면 위반을 지식 공백으로 내리는
  안전 우회가 늘어 recall이 오히려 떨어질 수 있다.

## 개선안 3 — 선택 단계 하이브리드 resolver: 후보 생성만 결정적으로

- 구분: 추론 + 권고
- 가설: 완전 결정적 selector가 아니라, 역할 문서의 trigger 메타데이터(diff 토큰·글롭 →
  후보 문서 매핑, 예: `@unique` 삭제 → `unique-constraint-integrity.md`)로 **후보 목록
  생성만 결정화**하고, 최종 선택(상한 2+1 유지)은 모델 판단으로 남기면, 선택 분산과
  선택 누락(정답 문서가 있는데 지식 공백으로 남긴 경우)이 줄어든다. 토큰 효과는 제한적일
  것이다 — 지식 Read는 이미 52→33(-36.5%)으로 줄었고 input의 대부분이 cached였으므로,
  이 개선의 가치는 토큰이 아니라 품질 안정성이다.
- 변경 대상 범주: 역할 문서의 `## 담당 지식` 항목에 trigger/exclude 메타데이터 추가,
  부모 선택 절차, (선택적으로) 결정적 후보 생성 스크립트. 계약·상한·검증기는 불변.
- 품질·토큰·시간 예상 방향: 선택 누락 감소로 recall 안정화 예상. 토큰 중립~소폭 감소.
  시간 중립. trigger가 과도하게 좁으면 novel change에서 recall 저하 위험.
- 검증 방법: 개선안 1이 만드는 선택 누락 지표(정답 키의 기대 문서 vs
  `knowledge_selection.paths`)로 전후 비교. 조건은 "현재 0.15.0" vs "0.15.0 + 후보
  manifest" 단일 요인 비교.
- 통과 조건: 선택 누락률 감소, finding recall 비저하, 계약 invalid율 비악화, uncached
  토큰 비증가.
- 회귀 조건: novel-change fixture(trigger 표에 없는 유형)에서 지식 공백이 늘면 trigger를
  exclude 없이 후보 추가 전용으로 약화한다.
- 대가: trigger 표 유지보수 — 지식 문서가 늘 때마다 표가 낡는 rot 비용이 생기고, 이 표
  자체가 새로운 always-on/on-invoke 토큰이다. Claude Code에서는 역할 문서가 시스템
  프롬프트로 들어가므로 trigger를 문서 앞쪽 절에 두면 안 되고(팀 구성 읽기 예산에 걸림),
  선택 힌트와 같은 위치에 둬야 한다.

## 가장 먼저 실행할 실험

- 선택: 개선안 1의 오프라인 절반 — 저장된 24 run(공유 A 6 + B 배치 1 6 + B 배치 2 6,
  quality-final의 A는 중복이므로 제외 시 18 run) 재채점과 정답 키 교정. 이후 같은
  채점기로 최종 hardening 상태 vs 0.14.0의 전체 재측정.
- 이유: 실행 비용이 0인데, 지금 열려 있는 가장 큰 질문 두 개를 닫는다 — (a) +9.58%p가
  후보 개선인지 배치 변동인지, (b) 최종 hardening 상태의 실제 품질. 이 답 없이는 ablation
  이든 resolver든 결과를 해석할 수 없다. 요청서의 "한 번의 실험" 제약에서 최대 정보량이다.
- 필요한 fixture: 기존 r2/r3 그대로 + fixture별 finding 정답 키(신규 작성, 사람 라벨).
  새 실행 fixture는 이 단계에서 불필요.
- 필요한 반복 수: 오프라인 재채점은 0회. 후속 재측정의 반복 수는 지금 확정하지 않는다 —
  교정된 채점기로 새 지표의 실행 분산을 먼저 측정한 뒤 그 분산으로 정한다. 조건·task당
  5회는 후보값일 뿐 검증된 최소치가 아니고, finding 단위 채점으로 분산 자체를 줄이는
  것이 반복 수 증가보다 먼저다.
- 저장할 trace: raw.jsonl 전체(final_message 포함), per-finding 채점 결과(정답 키 항목별
  match/miss/spurious), `knowledge_selection.paths` vs 기대 문서 대조, root/child usage의
  cached/uncached 분해, wall p50/p90, `git describe --dirty` + 작업 트리 해시.

## Codex 의견에 대한 반론 또는 보완

- 구조 효과와 지식 효과 분리에 대한 의견: 분리 자체는 동의. 방식은 2×2보다 "0.15.0에서
  요인 하나씩 제거" ablation이 낫다 — 각 조건이 귀속 질문 하나에 직접 답하고, 큰 효과가
  없으면 그 축의 후속 실행을 조기 중단할 수 있다. 2×2는 상호작용 추정에 실행을 쓰는데,
  선택 상한과 diff gate는 다른 실패 모드(과독 vs 허위 단정)에 작용하므로 상호작용 가설이
  아직 없다. 단, 어떤 설계든 개선안 1 이전에 돌리면 12%p 배치 변동에 묻힌다. always-on
  description 비용과 on-invoke 비용의 분리는 Claude Code에서 중요하지만 방향이 자명하지
  않다 — 시스템 프롬프트 상주분은 prefix cache 친화적이라 cached 단가로, on-invoke Read는
  매 세션 uncached로 반복된다. "항상 상주 = 낭비"가 아니므로 cached/uncached 단가로 나눠
  계측해야 한다.
- deterministic selector에 대한 의견: 부분 동의. exact path 검증은 이미 결정적이다(바이트
  일치 + spawn 전 존재 확인). 남은 것은 "어떤 문서인가"인데, 이것을 완전 결정화하면 trigger
  표가 지식베이스 성장 속도로 낡고 novel change의 recall이 표 품질에 종속된다. 후보 생성만
  결정화하고 선택은 모델에 남기는 하이브리드(개선안 3)를 제안한다. 그리고 이 투자의 기대
  효과는 토큰이 아니라 분산 감소다 — 토큰 병목이 선택 단계라는 증거는 아직 없고, root/child
  cached 분해가 그 증거를 만들 수 있는 첫 지표다.
- scorer 분리에 대한 의견: 전면 동의하며 Codex 제안보다 한 발 더 — 계약 유효성은 품질
  축이 아니라 **독립 release gate**에 둔다(현행 analyzer hard gate 유지, promotion에서
  invalid run의 finding은 이미 승격 불가). regex scorer는 정답 키 채점기 교정용 대조군으로
  한 라운드만 유지하고 폐기한다. 주의: HEAD runner가 계약 항목을 품질 rubric에 합산하는
  현재 상태는 Codex가 우려한 혼입을 코드로 만든 것이므로, 다음 측정 전에 분리해야 한다.
  계약 invalid의 분류는 — 부모 종합의 형식 이탈은 orchestration failure로, 자식의 증거
  규칙 위반은 별도 카운트로 나눠 보고하되, 둘 다 품질 점수에는 넣지 않는다.

## 아직 알 수 없는 것

- 추가 측정이 필요한 항목:
  - ~~B 배치 1과 배치 2 사이에 후보 코드가 실제로 달랐는지~~ → **부분 해소 (2026-08-24)**:
    작성자는 기억하지 못하나, 저장된 final_message 형식이 B1은 전부 Markdown 서술이고
    B2는 전부 bare JSON이다. JSON 전용 계약이 두 배치 사이에 적용됐으므로 후보가 변경된
    것은 확실하다. "동일 후보의 순수 실행 분산" 해석은 기각되며, 12.08%p는 후보 차이와
    분산이 섞인 값이다 — 각각의 기여량은 여전히 분리 불가. 부수 한계: 이 형식 차이 때문에
    완전한 블라인드 라벨링은 불가능하다(JSON 응답은 B2임이 형식으로 드러난다). 이 한계는
    재채점 보고에 명시한다.
  - 최종 hardening 상태의 전체 성능(요청서와 동일한 한계 유지 — smoke만 존재).
  - 사람 라벨과 자동 채점의 finding 단위 일치도(개선안 1이 처음 만든다).
  - Claude Code 런타임에서 root/child usage·cache telemetry의 신뢰 가능한 분해 — 세션
    jsonl에서 추출 가능한지 자체가 미검증. 이것이 없으면 Claude Code 쪽 효율 주장은
    wall time과 총 usage 외에 근거가 없다.
  - 운영 요청 분포에서의 recall — 현재 fixture는 전부 회귀 주입형이라 클린 diff 정밀도와
    novel change recall을 재지 못한다(개선안 2의 fixture가 첫 데이터를 만든다).
  - 선택 누락률의 실측 기준선(개선안 1의 정답 키 대조가 처음 만든다).

## 부록 — 요청 질문별 짧은 답

1. 품질 최대 병목: 측정 해상도·provenance(진단 절 관찰 1–4). 실행 품질의 병목 후보는
   신규 파일 증거 규칙(개선안 2)이지만, 순위 확정에는 재채점이 선행돼야 한다.
2. 토큰 절감→recall 저하 전환 지점: (a) 신규 파일 부재 판정 불가 규칙, (b) "애매하면
   선택하지 않는다" 선택 규칙(선택 누락 지표로 계측), (c) r3의 부모 finding 상한 8 =
   정답 주제 8로 여유 0 — 상한을 채우면 dedup 실수 하나가 곧 recall 손실, (d) 자식 읽기
   3회 예산. 각각 지표를 만들고 나서 조정한다.
3. 2+1 상한: 유지. 52→33 Read에 품질 비저하가 관찰됐으므로 과독의 이득은 없다. 상한
   자체보다 선택 누락률이 먼저 측정돼야 하고, 그 값이 높으면 상한이 아니라 선택 절차
   (개선안 3)를 고친다.
4. deterministic resolver: 후보 생성만 유효(개선안 3). 완전 결정화는 반대.
5. Claude Code native 차이: packet에서 역할 문서 경로·반환 계약 제거는 이미 계약에 있고
   유효. 추가로 필요한 것은 최적화가 아니라 계측 — description 상주분(cached 단가)과
   on-invoke Read(uncached)의 분리 원장. scoped diff 임시 파일 방식은 유지.
6. JSON 전용 응답: 계약은 유지. 사람 가독성은 모델 출력 계약을 느슨하게 하지 말고
   다운스트림 결정적 렌더러(JSON→Markdown 변환 스크립트)로 해결한다. 검증 가능성이
   가독성보다 우선이고, 렌더러는 검증을 훼손하지 않는다.
7. diff_evidence 충분성: 제자리 수정에는 충분. rename·순수 삭제 파일·다중 파일·신규
   파일에는 불충분(개선안 2의 관찰 1–3).
8. validator·scorer 분리: 계약 유효성 = 독립 release gate + orchestration 오류 분류.
   과업 품질 = 정답 키 기반 precision/recall/근거 적합성. 결합 지점은 하나 — invalid run의
   finding은 품질 집계에서 제외(현행 hard gate 유지).
9. 우선 추가할 fixture: ① 결함을 고치는 클린 diff(정밀도 측정, 현재 0개), ② 신규 파일
   추가형 결함(recall 구멍 검증), ③ rename+수정, ④ 지식 문서 본문에 명령·프롬프트가
   포함된 주입 fixture(안전 규칙이 존재하나 미검증), ⑤ trigger 표에 없는 novel change
   (개선안 3 채택 시 회귀 감시용).
10. 한 번의 실험: 위 「가장 먼저 실행할 실험」 — 저장 trace 재채점 + 채점기 교정.
    실행 0회로 기존 결론의 신뢰 구간을 확정한 뒤에만 새 실행이 의미를 가진다.

## 라운드 1 결과 — Codex 검증과 합의 (2026-08-24)

Codex(CLI 0.147.0)가 이 문서와 원시 trace를 직접 재검증했다. 전문:
`docs/handoffs/codex-round1-verification-and-agreement.md`

- 검증 확인: B 배치 평균 58.75%/70.83%, 두 배치 모두 `plugin_commit 2e027c8`, 과거
  rubric에 계약 항목 부재, HEAD runner의 계약 rubric 합산 — 모두 Codex가 원시 데이터로
  재확인했다. (A 6회는 실행 기준 공유가 맞으나, 두 번째 artifact의 A 레코드에는 분석
  필드가 추가되어 raw 객체가 동일하지는 않다.)
- 수용된 수정(이 문서에 반영 완료): root_usage/total_usage 필드 혼동, 24→18개 고유 실행,
  "비용 없음"→"신규 모델 실행 0회 + 인력 비용 별도", 12.08%p의 원인 귀속 불가(분산·후보
  차이·scorer 민감도 구분 불가 — 확정 병목은 provenance 부재), 반복 5회는 후보값,
  신규 파일 구멍의 원인은 지침·validator 계약 불일치.
- 남은 이견(다음 라운드로 이월): 단일 요인 ablation이 Codex의 원래 질문(roles→agents
  구조 vs 지식 snapshot 귀속)에 답하지 않는다는 지적은 타당하다 — 두 귀속 질문(0.15.0
  계약 요인 vs 구조·지식)은 서로 다른 실험이며, 어느 쪽을 먼저 살지는 채점기 교정 후
  결정한다.
- **합의된 하나의 다음 실험**: 18개 고유 저장 실행에 대한 블라인드 finding 단위 오프라인
  재채점. condition·batch를 가리고 정답 키(`path`+판정 주제+`change_status`+기대 근거)를
  먼저 확정, 사람이 TP·FP·FN·근거 적합성을 라벨링, regex와 finding-key 채점기를 병렬
  적용, 계약 유효성은 별도 열로 분리, provenance 한계를 결과에 명시.
  - 통과 기준: r2·r3 각각에서 사람 라벨 불일치가 regex보다 적음, finding별 역추적 가능,
    계약 항목의 품질 비합산, 중복 입력 결정성 검사 통과, B 배치 차이를 "scorer가 설명하는
    부분"과 "provenance 부재로 설명 불가한 부분"으로 구분 보고 가능.
  - 기각 기준: 불일치 비감소, 정답 키의 finding 구분 실패, 계약 문자열의 품질 점수 영향
    잔존, provenance 없는 차이를 단정해야만 결론이 성립.
  - 이 실험의 통과는 새 채점기의 수용만 의미한다. 0.15.0의 품질 우위·promotion 판단에는
    통과한 채점기와 작업 트리 provenance를 갖춘 새 A/B가 별도로 필요하다.

### 실험 준비 상태 (2026-08-24)

- trace 백업: `/private/tmp`의 두 실행 벌을
  `benchmarks/model-routing/archived-traces/{quality-first-ab,quality-final}/`로 복사 완료.
- 정답 키 초안: `benchmarks/model-routing/answer-keys/{r2,r3}.json` — r2 필수 3키 + trap 3,
  r3 필수 8키 + trap 3. fixture base/changed 대조로 도출했고 **사람 확정 대기** 상태.
  r3 workflow는 base가 `contents: read` + SHA 고정 checkout이었으므로 write-all·@v4 모두
  `introduced_by_diff`가 정답이다(단순 "@v4는 가변" 일반론이 아니라 후퇴).
- 블라인드 라벨링 시트: `benchmarks/model-routing/blind-labeling/라벨링-시트-{r2,r3}.md`
  (task별 9응답, 고정 시드 셔플, condition·배치 라벨 은닉). B2 응답 6건은 JSON이라
  finding 행을 프리필했고, A·B1 응답 12건은 Markdown이라 라벨러가 행을 직접 추가한다.
  masked ID ↔ 실제 run 매핑은 `blind-map.라벨링-끝나기-전-열지-말것.json`에 봉인.
- 알려진 블라인드 한계: 응답 형식(JSON vs Markdown)이 B2 여부를 구조적으로 노출한다.
  A와 B1은 형식으로 구분되지 않으므로 그 사이의 블라인드는 유지된다.
