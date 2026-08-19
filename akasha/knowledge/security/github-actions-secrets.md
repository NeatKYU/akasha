# GitHub Actions 비밀값 사용 기준

## 출처

- 제목: Using secrets in GitHub Actions
- URL: https://docs.github.com/actions/security-guides/using-secrets-in-github-actions
- 소유자: GitHub
- 신뢰도: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다.
- 사용 메모: repository, environment, organization, workflow, log 처리 단위의 GitHub Actions 비밀값 검토에 사용한다.
- 출처 카탈로그: `github-actions-secrets`
- 검토 스냅샷: `github-actions-secrets` 구조 `7d89e53efad5` 본문 `51681093620e`

## 이 문서가 해당 역할에 도움이 되는 이유

보안 에이전트는 GitHub Actions 비밀값을 단순한 키-값 저장소가 아니라 접근 범위, 실행 이벤트, 로그 노출, 재사용 workflow 전달 규칙이 붙은 CI/CD 보안 경계로 다뤄야 한다. 이 기준은 workflow 변경 리뷰에서 어떤 비밀값이 어느 저장소와 환경에 노출되는지, runner가 실제로 받을 수 있는 조건이 무엇인지 확인하는 데 도움을 준다.

GitHub Actions는 배포, 테스트, 릴리스 자동화를 한 곳에 묶기 때문에 권한이 넓은 비밀값이 workflow에 들어가면 영향 범위가 빠르게 커진다. 비밀값 사용 기준은 workflow 문법 검토와 운영 권한 검토를 함께 수행하게 만든다.

## 프로젝트에 적용할 기준

- repository, environment, organization 수준 중 가장 좁은 범위에 비밀값을 둔다.
- organization 수준 비밀값은 접근 가능한 저장소 정책을 명시하고, 정기적으로 어떤 저장소가 접근할 수 있는지 검토한다.
- deployment environment 비밀값은 환경 보호 규칙, 승인자, 브랜치 제한과 함께 검토한다.
- workflow에서는 비밀값을 command argument로 직접 넘기지 말고 환경 변수, 표준 입력, 대상 도구가 제공하는 안전한 입력 방식을 우선한다.
- GitHub secret이 아닌 민감 값이 로그에 나타날 수 있으면 명시적으로 마스킹한다.
- fork, Dependabot 이벤트, reusable workflow에서는 비밀값 전달 규칙이 다르므로, 이벤트별로 실제 runner에 전달되는지 별도 확인한다.
- 장기 cloud credential이 필요한 workflow는 가능하면 OIDC 기반 인증으로 대체할 수 있는지 검토한다.

## 주의할 점

- secret 이름만 보고 안전하다고 판단하지 않는다. 실제 값이 어느 workflow, 어느 이벤트, 어느 runner에서 읽히는지까지 확인해야 한다.
- organization secret을 전체 저장소에 열면 신규 저장소가 생길 때 의도치 않은 접근 권한이 생길 수 있다.
- Base64는 바이너리 값을 텍스트로 바꾸는 방식이지 암호화가 아니다. 민감 바이너리나 큰 파일을 다룰 때 암호화와 키 관리 절차를 별도로 둔다.
- 로그 마스킹은 모든 파생 값이나 부분 문자열을 자동으로 가려주지 않는다. 디버그 출력, echo, 실패 메시지, third-party action 출력까지 검토한다.
- reusable workflow 호출부와 실행부 사이의 secret 전달은 자동이라고 가정하지 않는다.

## 에이전트가 사용할 때의 체크리스트

- [ ] 비밀값이 repository, environment, organization 중 가장 좁은 범위에 저장되어 있는가?
- [ ] organization secret의 접근 저장소 정책과 리뷰 주기가 명확한가?
- [ ] workflow trigger가 fork, Dependabot, reusable workflow일 때 비밀값 전달 여부를 따로 확인했는가?
- [ ] 비밀값이 command argument, 로그, artifact, cache, summary에 노출되지 않는가?
- [ ] GitHub secret이 아닌 민감 값에는 별도 마스킹이 적용되어 있는가?
- [ ] 장기 cloud credential 대신 OIDC 또는 짧은 수명 자격 증명을 사용할 수 있는가?
