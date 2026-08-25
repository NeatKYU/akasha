# 변경 이력

이 프로젝트는 [Semantic Versioning](https://semver.org/)을 따릅니다.

## [0.16.0] - 2026-08-25

### 추가

- 작가 도메인 역할 7개: worldbuilding · character · plot · staging · continuity · style · reader.
  총괄 작가·에피소드 작가·자료 조사는 읽기 전용 심사 모델에 맞지 않아 역할로 두지 않는다
- 지식 문서 10개: 국립국어원 어문 규범 2개(primary), 작법 유파 8개(secondary — 자문 근거로만 사용)
- 출처 허용 호스트: www.korean.go.kr, www.brandonsanderson.com, www.helpingwritersbecomeauthors.com

### 변경

- SKILL.md의 `subagent_type`을 설치본에서 동작하는 `akasha:akasha-<역할>`로 수정
- 실전 세션 전사를 하네스 record로 변환하는 `scripts/inspect-akasha-session.mjs` 추가

## [0.15.0] - 2026-08-21

### 변경

- 코드 변경의 `위반` 판정에 scoped diff의 `diff_evidence`와 `change_status`를 필수화
- 애매한 지식 문서는 기본적으로 건너뛰고, 역할별 기본 선택을 최대 2개로 제한
- 독립적인 고위험 판정에만 3번째 문서를 허용하고 선택 예외를 구조화해 기록
- 부모가 선택한 `selected_knowledge_paths`만 자식이 읽도록 역할 packet 계약 강화
- PostgreSQL 고유 제약 문서를 추가해 UNIQUE 제거의 중복 허용 효과와 cardinality·migration 공백을 분리
- 코드 변경 검토 결과를 단일 JSON 객체로 고정하고, diff token·지식 경로·출력 수 상한을 runtime에서 검증

### 검증

- 역할 공용 절의 품질 계약과 SKILL.md의 선택·diff 증거 계약을 정적 검사로 강제
- Akasha 통합 품질 rubric에 diff evidence, knowledge selection, 알려진 UI 오탐 방지 항목 추가

## [0.14.0] - 2026-08-19

### 추가

- 지식 문서 10개. 62개 → 72개
  - qa 2 / data 1 / backend 2 / marketing 2 / product 1 / security 1 / ai 1

### 제외

- `google-search-essentials`, `govuk-ds-patterns` — 다른 페이지로 링크만 하는 허브라 판정 기준을 뽑을 수 없다

## [0.13.0] - 2026-08-19

### 추가

- 지식 문서 8개. 54개 → 62개
  - ai 2: 구조화 출력 계약, 평가 설계
  - frontend 2: 함수 참조 안정화, 자동 메모이제이션 환경의 판정 범위
  - security 1 / product 1 / platform 1 / backend 1: Actions 비밀값과 스크립트 주입, 서비스 설계 원칙, Dependabot 권한 모델, 서버 fetch 캐시 의미

## [0.12.0] - 2026-08-19

### 추가

- 지식 문서 11개. 43개 → 54개
  - qa 4: 테스트 격리 메커니즘, 병렬 실행과 순서 의존, CI 실행 구성, 접근성 테스트 범위
  - security 2: 보안 로깅, 장기 자격증명 대신 OIDC
  - backend 2: 웹 서비스 입출력 방어, 서비스 간 신뢰 경계
  - product 1 / marketing 1 / ai 1: 사용자 조사 근거, Core Web Vitals 임계값, 프롬프트 접두사 캐싱

### 제외

- `govuk-research-in-live` — 원문에 확인 가능한 기준이 없어 판정 근거로 쓸 수 없다. 문서로 만들지 않았다

## [0.11.0] - 2026-08-19

### 추가

- 지식 문서 12개. 31개 → 43개
  - frontend 4: useMemo 판단, memo 효과 조건, 렌더 성능 측정, 오류 처리와 error boundary 배치
  - design 4: 경고 다이얼로그 패턴, 근거의 규범성 구분, 네이티브 dialog, 새 컴포넌트 제안
  - data 4: 플래너 통계 신뢰성, 플래너 설정 변경, 관계 로딩과 과다 조회, 커넥션 풀 한계

전부 원문을 읽고 작성했다. 앞서 조사한 후보 72건 중 아직 문서화되지 않은 것이 남아 있다.

## [0.10.0] - 2026-08-19

### 추가

- 지식 문서 4개: 테스트 fixture 설계(qa), 에이전트 워크플로 평가(ai), 인덱스 사용 검증(data), 인증 처리(security). 문서 27개 → 31개
- **버전 규칙 문서** [`docs/versioning.md`](docs/versioning.md) — 배포 대상은 `akasha/` 뿐이며 그 변화 종류가 SemVer 등급을 정한다
- `npm run check:version` — `akasha/` 변경을 분류해 필요한 등급과 실제 올린 등급을 대조한다. `npm run validate`가 이 검사를 포함한다

### 수정

- `scripts/lib.mjs`가 0.8.0에서 제거한 `ajv` 를 계속 import하고 있었다. 로컬 `node_modules`에 남아 있어 드러나지 않았고, 새로 clone한 환경에서는 모든 스크립트가 실패했다
- `validateRoleKnowledgeRouting` 의 절 추출 정규식이 `\Z` 를 쓰고 있었다. JS 정규식에 `\Z` 는 없고 리터럴 `Z` 로 해석되어, 담당 지식 힌트에 대문자 Z가 나오면(`ANALYZE`) 그 지점에서 절이 잘렸다

## [0.9.0] - 2026-08-19

### 변경

- **지식 문서 양식을 통일하고 검사로 강제한다.** 모든 문서가 `## 출처` → `이 문서가 해당 역할에 도움이 되는 이유` → `프로젝트에 적용할 기준` → `주의할 점` → `에이전트가 사용할 때의 체크리스트` 순서를 갖는다
- **문서 하나에 출처 하나.** 검토 스냅샷이 무엇을 가리키는지, 원본이 바뀌면 어느 문서를 다시 읽어야 하는지, 담당 지식 선택 힌트가 무엇을 약속하는지가 1:1이 된다
- 지식 문서 14개 → **27개**. 출처가 여럿이던 문서 3개를 6개로 분리하고, 절 없이 불릿만 있던 스텁 5개를 원문을 읽어 15개 문서로 다시 썼다
- `MAX_RESPONSE_BYTES` 1MB → 5MB. 최신 문서 페이지가 1MB를 흔히 넘어 정상 출처가 수집 실패로 잡혔다

### 추가

- `npm run pin:source -- <id> <URL>` — 새 문서를 쓸 때 필요한 검토 스냅샷 줄을 만든다. injection·secret 검사와 헤딩 수를 함께 보여줘 색인 페이지 여부를 바로 판별한다
- 역할별 신규 문서: frontend 4, design 4, backend 4, data 2, security 2, product 1, marketing 2, platform 2

### 제거

- 색인 페이지 출처 7건. 헤딩이 내비게이션 메뉴라 판정 기준을 뽑아낼 수 없어 구체 페이지로 교체했다
- `toss-tds` — URL이 껍데기 페이지(헤딩 4개)로 바뀌어 지식 출처로 쓸 수 없다
- `netflix-hawkins-interview` — secondary이며 수집이 계속 실패했다
- 출처 중복 소유 4건. 한 출처를 여러 문서가 인용하던 상태를 해소했다

## [0.8.0] - 2026-08-19

### 제거

- `catalog/roles/*/sources.json` (1,120줄) — 모든 필드가 지식 문서의 `## 출처` 절과 중복이었다
- `reports/` (276파일, 1.1MB) — 본문을 저장하지 않고 배포되지도 않아 에이전트에 도달하지 않았다. 남기는 값은 해시 2개뿐이었고 그건 지식 문서에 고정된다
- `manifest.json`, `schema/`, `scripts/refresh.mjs`, `scripts/prepare-promotion.mjs`, `scripts/review-queue.mjs`
- `refresh-quarantine.yml`, `prepare-weekly-promotion.yml`
- `ajv` 의존성

### 변경

- **지식 문서의 `## 출처` 절이 단일 진실 원천이 되었다.** 출처 id, URL, 소유자, 권위, 라이선스 메모, 사용 메모, 검토 스냅샷을 담는다
- 스텁 5개의 `Source catalog:` 꼬리 줄을 정식 `## 출처` 절로 승격. 이제 14개 문서 전부 출처 URL을 갖는다
- 출처 블록 형식을 정규화 (`신뢰도`→`권위`, id를 블록 첫 줄로)

### 추가

- `npm run check:sources` — 지식 문서가 인용한 URL만 가져와 해시를 비교한다. 아무 파일도 쓰지 않고 재검토 목록만 출력한다
- `check-sources.yml` — 주 1회 실행, 결과를 워크플로 요약에 남긴다

## [0.7.0] - 2026-08-19

### 추가

- 역할별 근거 출처 72건을 카탈로그에 등록 (28 → 100). 전부 기존 `ALLOWED_HOSTS` 안이라 허용 호스트 변경 없음
- **검토 스냅샷 고정.** 지식 문서가 어떤 시점의 출처를 요약했는지 `- 검토 스냅샷: \`id@hash12\`` 로 기록한다
- **표류 감지와 검토 부채 상한.** 출처 해시가 바뀐 문서를 재검토 큐로 보고하고, 큐가 12건을 넘으면 CI가 막는다
- `npm run review:queue` — 이번에 무엇을 재검토해야 하는지 출력

### 변경

- 승격 차단 게이트를 **의존성 기반**으로 변경. 승인된 지식 문서가 실제로 인용하는 출처만 승격을 막는다. 등록만 되고 아직 요약되지 않은 출처의 수집 실패는 승격을 막지 않는다

## [0.6.0] - 2026-08-19

### 변경

- 역할 서브에이전트가 담당 지식을 **전부 읽지 않고 골라 읽는다.** 기존 규칙은 "담당 지식 문서를 먼저 전부 읽고"였고, 이는 실행 예산의 읽기 3회 상한과 충돌했으며 역할당 문서 수를 사실상 5~8개로 묶고 있었다
- `## 담당 지식` 각 항목에 선택 힌트를 붙였다. 역할 문서가 곧 서브에이전트 시스템 프롬프트이므로 읽기 호출 없이 고를 수 있다

### 추가

- 담당 지식 항목이 `- \`path.md\` — 선택 힌트` 형식을 지키는지, 힌트가 고를 만큼 구체적인지 검사
- 읽지 않은 문서를 근거로 `근거 있는 확인`을 내지 못하게 하는 계약. 건너뛴 주제는 지식 공백으로 남긴다

## [0.5.0] - 2026-08-19

### 추가

- Claude Code 서브에이전트 호출 계약 (`subagent_type: akasha-<역할>`)과 정의 없는 환경의 fallback 경로
- 역할 문서 frontmatter, 비-읽기 전용 도구, 역할별 model 고정, 공용 절 분기를 차단하는 `validate` 검사

### 변경

- `akasha/roles/` → `akasha/agents/akasha-<역할>.md`. Claude Code가 서브에이전트로 직접 읽는 위치로 옮기고 frontmatter를 추가해, 역할 지시문 한 벌이 양쪽 런타임을 겸한다
- 자식 실행 계약(`## 실행 예산`·`## 반환 계약`·`## 도구 경계`)을 역할 문서로 옮겨 packet에서 역할 수만큼 반복되던 전달을 제거
- 부모는 팀 구성 시 문서 전문 대신 `## 담당`·`## 호출 시점`·`## 라우팅` 블록만 범위 지정해 읽는다
- 읽기 전용 자식에게는 부모가 역할별 scoped diff를 파일로 넘기고 자식은 셸을 쓰지 않는다

### 보안

- 역할 서브에이전트의 읽기 전용을 지시문이 아니라 `tools: Read, Grep, Glob` 도구 경계로 강제
- `model: inherit`을 검사로 고정해 검증되지 않은 역할별 tiering 유입을 차단
- 파일명 `akasha-` prefix를 강제해 소비 프로젝트의 동명 에이전트와 충돌하지 않게 함

## [0.4.0] - 2026-08-14

### 추가

- Luna, Terra, Sol, GPT-5.5, GPT-5.4를 같은 fixture에서 비교하는 모델 라우팅 평가 하네스
- 요청/관찰 model·effort 검증, 토큰·시간·API 등가 비용, 역할 정확도, 오류 taxonomy를 남기는 append-only 실행 기록
- 모델명을 가린 블라인드 채점 export와 실제 Akasha R2/R3 통합 A/B 분석기

### 변경

- 외부 사용량 한도와 서비스 장애를 품질 실패에서 분리하고 후속 실행을 중단하도록 개선
- task/condition별 유효 3회, 역할·모델 정확도 100%, 내부 오류 0, 기준 품질 98% 및 효율 15%를 production 승격 gate로 명시
- 이번 통합 실험은 사용량 한도로 반복 수가 부족하고 후보의 효율이 악화되어 부모 model·effort 상속을 유지

### 검증

- 66회 screen, 두 명의 blind grader, 실제 R2/R3 통합 A/B 및 deterministic analyzer 회귀 검사

## [0.3.0] - 2026-08-14

### 추가

- 부모 모델 상속과 사용자 지정 override를 구분하는 model routing 계약
- 실제 routing mode·reasoning effort·선택 이유·fallback을 남기는 감사용 보고 필드

### 변경

- 역할 이름에 따른 자동 model tiering은 production 기본값에서 비활성화
- 사용자 지정 model 실패 시 같은 model에서 effort만 제거해 한 번 재시도
- `wait_agent` timeout을 정확히 30초로 고정해 짧은 polling 오류 재발 방지

### 검증

- 상속 기본값, 자동 승격 금지, 사용자 override 보존, fallback, 모델 감사 기록의 계약 회귀 검사 추가

## [0.2.1] - 2026-08-14

### 변경

- 기본 Akasha child에서 런타임 `agent_type` 자동 매핑을 금지해 실행 편차 축소
- child 읽기 호출과 root 라우팅·재검증 호출에 탐색 상한 추가
- 담당 지식 문서에 공식 URL이 없으면 `source_url: null`로 즉시 종료하는 규칙 추가

### 검증

- agent type, 탐색 예산, source URL 중단 조건의 계약 회귀 검사 추가

## [0.2.0] - 2026-08-14

### 추가

- 역할별 bounded context packet과 구조화된 반환 계약
- Codex 서브에이전트 호출·대기 계약 및 회귀 검증
- Codex 플러그인 인터페이스 메타데이터

### 변경

- 역할 문서·지식 문서·diff 전문을 child prompt에 복사하지 않고 필요한 원본을 직접 읽도록 변경
- 중복 판정과 반복 읽기를 줄이는 종합 규칙 추가

## [0.1.0] - 2026-08-04

### 추가

- 승인 지식베이스와 역할 기반 Akasha 플러그인의 최초 공개 버전
