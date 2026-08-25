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

## character

- [캐릭터 아크의 구조](character/character-arc-structure.md)

## plot

- [이야기 구조의 주요 전환점](plot/story-structure-beats.md)

## staging

- [장면과 후속 장면의 구조](staging/scene-sequel-structure.md)

## continuity

- [아웃라인을 기준 문서로 삼기](continuity/outline-as-reference.md)

## style

- [외래어 표기의 기본 원칙](style/loanword-notation-principles.md)
- [표준어 사정 원칙의 총칙](style/standard-language-principles.md)

## reader

- [첫 장면의 훅](reader/opening-hook.md)
