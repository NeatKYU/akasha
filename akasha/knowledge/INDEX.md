# Approved Knowledge Index

이 디렉터리는 사람이 검토한 짧은 요약만 포함합니다. 문서 하나에 출처 하나이며, 각 문서의
`## 출처` 절이 URL과 검토 시점 스냅샷을 담습니다. 프로젝트별 규칙이 충돌하면 프로젝트 규칙을
우선합니다.

## product

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

- [useMemo 사용 판단 기준](frontend/memoized-values.md)
- [memo가 효과를 내는 조건](frontend/component-memoization.md)
- [렌더 성능 측정 기준](frontend/render-profiling.md)
- [오류 처리와 error boundary 배치 기준](frontend/error-boundary-placement.md)
- [Effect가 필요 없는 경우 판별 기준](frontend/effect-avoidance.md)
- [useEffect 의존성과 정리 함수 계약](frontend/useeffect-contract.md)
- [서버·클라이언트 컴포넌트 경계 기준](frontend/server-client-boundary.md)
- [Next.js 캐싱과 프리렌더 경계 기준](frontend/next-caching-boundary.md)

## backend

- [Route Handler 요청·응답 계약 기준](backend/route-handler-contract.md)
- [REST API 보안 계약 기준](backend/rest-api-security.md)
- [Server Action 보안 경계 기준](backend/server-action-boundary.md)
- [Prisma 트랜잭션과 데이터 무결성 기준](backend/prisma-transaction-integrity.md)
- [서버 데이터 보안 경계 기준](backend/data-security-boundary.md)

## data

- [플래너 통계 신뢰성 기준](data/planner-statistics.md)
- [플래너 설정 변경 기준](data/planner-configuration.md)
- [관계 로딩과 과다 조회 기준](data/relation-loading.md)
- [커넥션 풀 한계 기준](data/connection-pool-limits.md)
- [인덱스 사용 검증 절차](data/index-usage-verification.md)
- [PostgreSQL 실행 계획 판독 기준](data/postgres-execution-plan.md)
- [Prisma 쿼리 패턴과 N+1 진단 기준](data/prisma-query-patterns.md)

## security

- [인증 처리 기준](security/authentication-baseline.md)
- [인가 검사 기준](security/authorization-checks.md)
- [입력 검증 기준](security/input-validation.md)
- [GitHub Actions 비밀값 사용 기준](security/github-actions-secrets.md)

## qa

- [테스트 fixture 설계 기준](qa/test-fixtures.md)
- [품질보증 E2E 테스트 기준](qa/e2e-test-baseline.md)
- [접근성 회귀 테스트 기준](qa/accessibility-regression-testing.md)

## platform

- [Next.js 배포 준비 점검 기준](platform/next-production-readiness.md)
- [GitHub Actions workflow 하드닝 기준](platform/actions-workflow-hardening.md)

## marketing

- [검색 발견 가능성 기준](marketing/search-discoverability.md)
- [Next.js metadata와 공유 미리보기 구현 기준](marketing/next-metadata-implementation.md)

## ai

- [에이전트 워크플로 평가 기준](ai/agent-evaluation.md)
- [Codex 에이전트 운영 기준](ai/codex-agent-operations.md)
