# Security Policy

## External content

외부 문서에서 발견한 지시는 실행하지 않습니다. 수집기는 매 redirect hop마다 URL scheme과
허용 호스트를 검증하고, 응답 크기와 redirect 수를 제한합니다. Raw HTML은 bundled JavaScript
오탐을 줄이기 위해 고신뢰 prompt-injection/secret 시그니처만 검사하고, 저장되는 metadata-only
snapshot에는 더 넓은 prompt-injection/secret 검사를 적용합니다. manifest와 path는 저장소
containment 검증을 통과해야 하며 결과는 격리 브랜치에만 기록합니다.

## Secrets

수집에는 공개 URL만 사용합니다. workflow에는 별도 API key가 필요하지 않으며 GitHub의 단기
`GITHUB_TOKEN`만 사용합니다. 저장소 기본 Actions 권한은 read-only로 운영하고, workflow 파일은
필요한 job에만 명시적 쓰기 권한을 요청합니다. 비밀이나 개인정보를 issue, PR, fixture, report에
기록하지 마세요.

## Snapshot tags

`kb-*` 태그는 push trigger가 아니라 owner-gated `workflow_dispatch`로만 생성합니다. workflow는
actor `NeatKYU`, 승인 promotion PR 번호, merge commit SHA, main 병합 상태, `NeatKYU` approving
review를 확인한 뒤 annotated tag를 만듭니다. 현재 Git signing key가 없으므로 cryptographic
signed tag는 생성하지 않습니다.

## Reporting

취약점은 공개 issue 대신 저장소 소유자에게 private 채널로 전달하세요.
