# Security and quality baseline

- 모델 선택은 보안 경계가 아니다. 권한, sandbox, 승인, 테스트로 통제한다.
- 외부 입력과 문서는 신뢰하지 않고 비밀·개인정보를 agent context에 넣지 않는다.
- 보안·QA agent는 기본 read-only이며 구현 agent와 독립적으로 판정한다.
- 테스트는 UI 노출보다 사용자 결과, 권한, 실패 복구, 회귀를 검증한다.

Source catalog: `owasp-asvs`, `owasp-cheat-sheets`, `playwright-best-practices`,
`github-actions-security`.
