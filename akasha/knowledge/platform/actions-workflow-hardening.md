# GitHub Actions workflow 하드닝 기준

## 출처

- 출처 id: `github-actions-security`
- URL: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- 소유자: GitHub
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다.
- 사용 메모: workflow token, secret, supply-chain hardening 검토에만 사용한다.
- 검토 스냅샷: `github-actions-security` 구조 `6bbca9162fbf` 본문 `66741fec3093`

## 이 문서가 해당 역할에 도움이 되는 이유

릴리스 경로에는 코드뿐 아니라 그것을 실행하는 workflow도 포함된다. GitHub 공식 보안 기준은
토큰 권한, 공급망 고정, 신뢰할 수 없는 입력 처리에 대한 규범 근거를 제공한다.

## 프로젝트에 적용할 기준

- 기본 `GITHUB_TOKEN` 권한은 read-only에 가깝게 두고 job 단위로 필요한 권한만 올린다.
- 외부 action과 reusable workflow는 full-length commit SHA로 고정하고 Dependabot, CODEOWNERS, code scanning으로 관리한다.
- secret은 workflow 파일에 평문으로 두지 않고, 변환된 민감값도 로그 노출 가능성을 별도로 점검한다.

## 주의할 점

- `pull_request_target`이나 `workflow_run`은 권한 있는 컨텍스트에서 untrusted code를 checkout하지 않는지 먼저 확인한다.
- self-hosted runner는 public PR이나 fork 입력을 처리할 때 지속 침해와 secret 노출 위험이 크다.
- action tag pinning은 편리하지만 immutable하지 않으므로 위험도를 리뷰에 남긴다.

## 에이전트가 사용할 때의 체크리스트

- workflow 권한이 repository default 또는 job `permissions`에서 최소화되어 있는가?
- third-party actions와 reusable workflows가 SHA로 고정되어 있고 소유자를 확인했는가?
- secret, token, env, artifact, cache, log가 untrusted input과 만나는 지점을 점검했는가?
- 권한 있는 트리거가 신뢰할 수 없는 코드를 실행하지 않는가?
