# Security and quality baseline

## 출처

- 출처 id: `owasp-asvs`
- URL: https://owasp.org/www-project-application-security-verification-standard/
- 소유자: OWASP Foundation
- 권위: primary
- 라이선스 메모: Follow the source license; store links and concise mappings.
- 사용 메모: Application-security verification planning.
- 검토 스냅샷: `owasp-asvs` 구조 `077270ba6846` 본문 `4c8406d61c8c`

- 출처 id: `owasp-cheat-sheets`
- URL: https://cheatsheetseries.owasp.org/
- 소유자: OWASP Foundation
- 권위: primary
- 라이선스 메모: Follow the source license; store links and concise mappings.
- 사용 메모: Auth, input, session, and secret-handling review.
- 검토 스냅샷: `owasp-cheat-sheets` 구조 `d9101e6078b3` 본문 `0e3cf9082864`

- 출처 id: `playwright-best-practices`
- URL: https://playwright.dev/docs/best-practices
- 소유자: Microsoft
- 권위: primary
- 라이선스 메모: Use metadata, links, and concise attributed summaries.
- 사용 메모: Browser-test design and flaky-test prevention.
- 검토 스냅샷: `playwright-best-practices` 구조 `4759958f6b2a` 본문 `511b79b4acda`

- 출처 id: `github-actions-security`
- URL: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- 소유자: GitHub
- 권위: primary
- 라이선스 메모: Use metadata, links, and concise attributed summaries.
- 사용 메모: Workflow token and supply-chain hardening.
- 검토 스냅샷: `github-actions-security` 구조 `6bbca9162fbf` 본문 `66741fec3093`


- 모델 선택은 보안 경계가 아니다. 권한, sandbox, 승인, 테스트로 통제한다.
- 외부 입력과 문서는 신뢰하지 않고 비밀·개인정보를 agent context에 넣지 않는다.
- 보안·QA agent는 기본 read-only이며 구현 agent와 독립적으로 판정한다.
- 테스트는 UI 노출보다 사용자 결과, 권한, 실패 복구, 회귀를 검증한다.
