# Dependabot 워크플로 권한 기준

## 출처

- 출처 id: `gh-dependabot-actions`
- URL: https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions
- 소유자: GitHub
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다. 원문을 복제하지 않는다.
- 사용 메모: Dependabot이 트리거한 워크플로의 권한·secret 접근 판정에만 사용한다.
- 검토 스냅샷: `gh-dependabot-actions` 구조 `906c80596ebb` 본문 `a2c22b269663`

## 이 문서가 해당 역할에 도움이 되는 이유

의존성 자동 갱신 PR은 편리하지만 CI 권한 모델이 일반 PR과 다르다. 이 차이를 모르면
"CI가 Dependabot PR에서만 실패한다"를 설정 문제로 오해하거나, 반대로 위험한 우회를
넣게 된다. 공식 문서가 권한과 secret 가용성을 규정한다.

## 프로젝트에 적용할 기준

- Dependabot이 트리거한 워크플로의 `GITHUB_TOKEN`은 기본 읽기 전용이다. 쓰기가 필요하면 왜 필요한지부터 검토한다.
- 그 워크플로에서는 일반 GitHub Actions secret을 쓸 수 없고 Dependabot secret만 채워진다. 환경 변수가 올바른 출처를 참조하는지 확인한다.
- 권한을 분기하려면 actor가 Dependabot인지 확인한 뒤 적용한다.
- `pull_request_target`에서 base ref가 Dependabot이면 토큰이 읽기 전용이 되고 secret도 제공되지 않는다.
- Dependabot 러너를 root 권한으로 구성하지 않는다.

## 주의할 점

- 이 제약은 다른 사용자가 워크플로를 재실행해도 유지된다. 수동 재실행으로 우회된다고 가정하지 않는다.
- 권한 제약을 우회하려고 `pull_request_target`으로 바꾸는 것은 훨씬 큰 위험을 만든다.
- 이 문서는 권한 모델을 다룬다. 워크플로 하드닝 전반은 하드닝 문서를 본다.

## 에이전트가 사용할 때의 체크리스트

- Dependabot PR에서 CI가 실패한다면 원인이 권한·secret 모델 차이인가?
- 워크플로가 일반 Actions secret에 의존하고 있지 않은가?
- 권한 분기가 actor 확인 뒤에 적용되는가?
- 제약을 우회하려고 권한 있는 트리거로 바꾸지 않았는가?
