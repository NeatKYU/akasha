# Approved Knowledge Index

이 디렉터리는 사람이 검토한 짧은 요약만 포함합니다. 문서 하나에 출처 하나이며, 각 문서의
`## 출처` 절이 URL과 검토 시점 스냅샷을 담습니다. 프로젝트별 규칙이 충돌하면 프로젝트 규칙을
우선합니다.

## product

- [사용자 조사 참여와 공유 기준](product/research-participation.md)
- [서비스 설계 원칙](product/service-design-principles.md)
- [사용자 조사 근거 기준](product/user-research-evidence.md)
- [사용자 니즈 정의 기준](product/user-needs.md)
- [사용자 스토리 분할 기준](product/user-story-slicing.md)

## design

- [경고·확인 다이얼로그 패턴 기준](design/alert-dialog-pattern.md)
- [접근성 근거의 규범성 구분](design/apg-normative-status.md)
- [네이티브 dialog 요소 활용 기준](design/native-dialog-technique.md)
- [새 컴포넌트 제안 기준](design/component-contribution.md)
- [모달 다이얼로그 접근성 패턴 기준](design/modal-dialog-accessibility.md)
- [WCAG 2.2 적합성 판정 기준](design/wcag-conformance.md)
- [디자인 시스템 접근성 책임 경계](design/design-system-responsibility.md)
- [컴포넌트 확장 판단 기준](design/component-extension.md)

## frontend

- [함수 참조 안정화 판단 기준](frontend/callback-stability.md)
- [자동 메모이제이션 환경의 최적화 판단](frontend/compiler-memoization.md)
- [useMemo 사용 판단 기준](frontend/memoized-values.md)
- [memo가 효과를 내는 조건](frontend/component-memoization.md)
- [렌더 성능 측정 기준](frontend/render-profiling.md)
- [오류 처리와 error boundary 배치 기준](frontend/error-boundary-placement.md)
- [Effect가 필요 없는 경우 판별 기준](frontend/effect-avoidance.md)
- [useEffect 의존성과 정리 함수 계약](frontend/useeffect-contract.md)
- [서버·클라이언트 컴포넌트 경계 기준](frontend/server-client-boundary.md)
- [Next.js 캐싱과 프리렌더 경계 기준](frontend/next-caching-boundary.md)

## backend

- [Prisma Client 수명과 운영 기준](backend/prisma-client-lifecycle.md)
- [use cache 제약과 캐시 키 기준](backend/use-cache-constraints.md)
- [서버 fetch 캐시 의미 기준](backend/fetch-cache-semantics.md)
- [웹 서비스 입출력 방어 기준](backend/web-service-hardening.md)
- [서비스 간 신뢰 경계 기준](backend/service-to-service-trust.md)
- [Route Handler 요청·응답 계약 기준](backend/route-handler-contract.md)
- [REST API 보안 계약 기준](backend/rest-api-security.md)
- [Server Action 보안 경계 기준](backend/server-action-boundary.md)
- [Prisma 트랜잭션과 데이터 무결성 기준](backend/prisma-transaction-integrity.md)
- [서버 데이터 보안 경계 기준](backend/data-security-boundary.md)

## data

- [고유 제약과 데이터 계약 변경 기준](data/unique-constraint-integrity.md)
- [통계 갱신 운영 기준](data/statistics-maintenance.md)
- [플래너 통계 신뢰성 기준](data/planner-statistics.md)
- [플래너 설정 변경 기준](data/planner-configuration.md)
- [관계 로딩과 과다 조회 기준](data/relation-loading.md)
- [커넥션 풀 한계 기준](data/connection-pool-limits.md)
- [인덱스 사용 검증 절차](data/index-usage-verification.md)
- [PostgreSQL 실행 계획 판독 기준](data/postgres-execution-plan.md)
- [Prisma 쿼리 패턴과 N+1 진단 기준](data/prisma-query-patterns.md)

## security

- [로그 이벤트 어휘 기준](security/logging-vocabulary.md)
- [Actions 비밀값 취급과 스크립트 주입 방지](security/actions-secret-handling.md)
- [보안 로깅 기준](security/security-logging.md)
- [장기 자격증명 대신 OIDC 사용 기준](security/oidc-credentials.md)
- [인증 처리 기준](security/authentication-baseline.md)
- [인가 검사 기준](security/authorization-checks.md)
- [입력 검증 기준](security/input-validation.md)
- [GitHub Actions 비밀값 사용 기준](security/github-actions-secrets.md)

## qa

- [테스트 샤딩 기준](qa/test-sharding.md)
- [컴포넌트 테스트 범위 기준](qa/component-test-scope.md)
- [테스트 격리 메커니즘 기준](qa/test-isolation.md)
- [병렬 실행과 순서 의존 기준](qa/parallel-execution.md)
- [CI 테스트 실행 구성 기준](qa/ci-execution.md)
- [접근성 테스트 범위 기준](qa/accessibility-testing-scope.md)
- [테스트 fixture 설계 기준](qa/test-fixtures.md)
- [품질보증 E2E 테스트 기준](qa/e2e-test-baseline.md)
- [접근성 회귀 테스트 기준](qa/accessibility-regression-testing.md)

## platform

- [Dependabot 워크플로 권한 기준](platform/dependabot-workflow-permissions.md)
- [Next.js 배포 준비 점검 기준](platform/next-production-readiness.md)
- [GitHub Actions workflow 하드닝 기준](platform/actions-workflow-hardening.md)

## marketing

- [페이지 경험 신호 기준](marketing/page-experience-signals.md)
- [검색 노출 3단계 진단 기준](marketing/search-pipeline-stages.md)
- [성능 지표 임계값 기준](marketing/core-web-vitals.md)
- [검색 발견 가능성 기준](marketing/search-discoverability.md)
- [Next.js metadata와 공유 미리보기 구현 기준](marketing/next-metadata-implementation.md)

## ai

- [모델 선택과 이행 판단 기준](ai/model-selection.md)
- [구조화 출력 계약 기준](ai/structured-output-contract.md)
- [평가 설계 기준](ai/eval-design.md)
- [프롬프트 접두사 캐싱 기준](ai/prompt-prefix-caching.md)
- [에이전트 워크플로 평가 기준](ai/agent-evaluation.md)
- [Codex 에이전트 운영 기준](ai/codex-agent-operations.md)

## worldbuilding

- [마법 체계의 이해도와 갈등 해결](worldbuilding/magic-system-first-law.md)
- [마법 체계의 한계와 비용](worldbuilding/magic-system-limitations.md)
- [새 설정 추가보다 기존 설정 확장](worldbuilding/expand-before-adding.md)
- [설정 문서의 범주별 완결성 점검](worldbuilding/worldbuilding-questions.md)
- [설정의 빙산과 몰입도별 설명량](worldbuilding/worldbuilding-101.md)
- [이야기를 섬기는 설정의 여섯 기둥](worldbuilding/organic-worldbuilding-pillars.md)
- [2막 모험 세계의 무대 전환 기록](worldbuilding/adventure-world-second-act.md)
- [주요 무대의 상징 기능 기록](worldbuilding/symbolic-settings.md)
- [설명 부족과 제때 드러나지 않은 설정](worldbuilding/under-explaining.md)
- [설명 과잉과 이야기에 쓰이지 않는 설정 설명](worldbuilding/too-much-explanation.md)

## character

- [캐릭터 아크의 구조](character/character-arc-structure.md)
- [아크 종류의 선택 — 시작과 끝의 대비로 판정한다](character/choosing-the-arc.md)
- [임팩트 캐릭터 — 변화 아크에는 진실을 쥔 상대가 있어야 한다](character/impact-character.md)
- [조연 아크의 범위 — 모든 조연에게 완전한 아크를 요구하지 않는다](character/minor-character-arcs.md)
- [아크 없는 이야기 — 상황과 이야기, 평탄 아크의 구분](character/stories-without-arc.md)
- [거짓의 두 유형 — 바깥에서 주어진 거짓과 안에서 태어난 거짓](character/two-types-of-lie.md)
- [아크 종류별 적대자의 기능 — 변화를 미는 쪽과 막는 쪽](character/antagonist-by-arc-type.md)
- [약한 캐릭터 목소리 — 요약된 생각은 목소리를 지운다](character/weak-character-voice.md)
- [목적 없는 캐릭터 — 장면마다 인물이 향하는 목표가 있어야 한다](character/characters-lack-purpose.md)
- [무반응과 과잉 반응 — 인물의 반응 강도를 판정한다](character/non-reactive-over-reactive.md)

## plot

- [이야기 구조의 주요 전환점](plot/story-structure-beats.md)
- [발단 사건의 세 후보와 제1막 전환점의 위치](plot/inciting-event.md)
- [핵심 사건과 제1전환점의 구분](plot/key-event-vs-first-plot-point.md)
- [핀치 포인트의 배치와 제2막의 압박 장치](plot/pinch-points.md)
- [중간점의 회전축 기능과 중반 늘어짐](plot/midpoint-swivel.md)
- [절정 순간의 식별과 제3막의 단계](plot/climactic-moment.md)
- [구조의 정형성과 장르 클리셰의 구분](plot/avoiding-formulaic-structure.md)
- [너무 이른 시작점의 징후](plot/stories-that-begin-too-early.md)
- [결말과 시작의 연결 판정](plot/irrelevant-endings.md)
- [중반 늪 탈출 장치: 빅 미들과 미니 아크](plot/great-swampy-middle.md)

## staging

- [장면과 후속 장면의 구조](staging/scene-sequel-structure.md)
- [행동 장면과 반응 장면의 구분](staging/two-types-of-scene.md)
- [반응 장면의 세 요소: 반응·딜레마·결정](staging/sequel-building-blocks.md)
- [반응 장면의 감정 반응: 유무·비중·전달 방식](staging/sequel-reactions.md)
- [반응 장면의 딜레마: 구체적 질문과 선택지 검토](staging/sequel-dilemmas.md)
- [장면 구조의 예외: 갈등 없는 사건과 목표 없는 만남](staging/incidents-not-scenes.md)
- [밋밋한 장면의 원인 진단과 보강 방향](staging/troubleshooting-a-scene.md)
- [장면 결말의 다섯 유형과 플롯 진전 여부](staging/scene-ending-types.md)
- [긴장 부족의 세 원인: 쉬운 위협, 먼 위협, 없는 목표](staging/not-enough-tension.md)
- [장면 작업표: 시점 인물·목표·갈등·좌절](staging/scene-goal-conflict-setback.md)

## continuity

- [아웃라인을 기준 문서로 삼기](continuity/outline-as-reference.md)
- [장면마다 아웃라인 비트를 다시 꺼내 대조하기](continuity/outline-during-drafting.md)
- [시리즈에 걸친 인물 변화 단계 대조](continuity/character-arcs-across-series.md)
- [시리즈 아웃라인의 최신성과 권 경계의 열림·닫힘 대조](continuity/outlining-a-series.md)
- [원인 없는 반응: 인과 순서와 인물 지식 대조](continuity/cause-and-effect.md)
- [한 번 등장하고 사라지는 요소 찾기](continuity/random-story-elements.md)
- [배경이 사라진 장면은 장소를 확정할 수 없다](continuity/vanishing-setting.md)
- [회상 장면의 시간선 표시와 사실 대조](continuity/flashback-discipline.md)
- [이중 시간선의 동기화 대조](continuity/dual-timelines.md)

## style

- [외래어 표기의 기본 원칙](style/loanword-notation-principles.md)
- [표준어 사정 원칙의 총칙](style/standard-language-principles.md)
- [방언이 표준어로 편입된 단어의 판정](style/dialect-promoted-standard-words.md)
- [고어로 처리된 단어와 현대 표준어의 판정](style/archaic-words-standard.md)
- [고유어·한자어 대응 단어의 표준어 판정](style/native-over-sino-korean-words.md)
- [복수 표준어로 허용되는 비슷한 형태의 판정](style/plural-standard-forms.md)
- [영어 외래어 표기 세칙의 판정](style/loanword-english-notation.md)
- [일본어 가나의 한글 표기 판정](style/loanword-japanese-kana.md)
- [대사에서 방언을 드러내는 방식의 자문](style/dialect-in-dialogue.md)
- [직설적 대사와 서브텍스트의 자문](style/dialogue-subtext.md)

## reader

- [첫 장면의 훅](reader/opening-hook.md)
- [첫 화의 네 가지 훅: 첫 문장·도입 상황·장면 차질·어조](reader/first-chapter-hooking.md)
- [첫 장면의 다섯 요건: 인물·목표·갈등·조연·배경](reader/first-chapter-opening-scene.md)
- [지루한 첫 문장의 다섯 유형과 호기심의 조건](reader/boring-opening-lines.md)
- [독자를 속이는 첫 문장: 꿈·장난·과장·오경보](reader/opening-lines-that-lie.md)
- [화 끝의 클리프행어: 강도는 달리하되 약속은 지킨다](reader/chapter-cliffhangers.md)
- [화 끝의 게으른 훅: 구체성 없는 예고는 훅이 아니다](reader/lazy-chapter-endings.md)
- [늘어지는 구간의 네 원인: 구조 비트·시작점·회상·정보 덩어리](reader/pacing-tricks.md)
- [불필요한 채움: 지루함·관례·반복이 신호다](reader/unnecessary-filler.md)
- [모호한 서술은 약한 서술: 추정어가 긴장을 흐린다](reader/vague-writing.md)
