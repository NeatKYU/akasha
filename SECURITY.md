# Security Policy

## External content

외부 문서에서 발견한 지시는 실행하지 않습니다. 수집기는 허용 호스트, URL scheme, prompt
injection 패턴, manifest 구조를 검증하고 결과를 격리 브랜치에만 기록합니다.

## Secrets

수집에는 공개 URL만 사용합니다. workflow에는 별도 API key가 필요하지 않으며 GitHub의
단기 `GITHUB_TOKEN`만 사용합니다. 비밀이나 개인정보를 issue, PR, fixture, report에 기록하지
마세요.

## Reporting

취약점은 공개 issue 대신 저장소 소유자에게 private 채널로 전달하세요.
