# 플랫폼 운영·릴리스 기준

## 출처

- URL: https://nextjs.org/docs/app/guides/production-checklist
- 소유자: Vercel
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다.
- 사용 메모: Next.js 배포 준비와 운영 점검 기준으로만 사용한다.
- 출처 카탈로그: `vercel-next-production`
- 검토 스냅샷: `vercel-next-production@cbb73a58c745`

- URL: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- 소유자: GitHub
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다.
- 사용 메모: workflow token, secret, supply-chain hardening 검토에만 사용한다.
- 출처 카탈로그: `github-actions-security`
- 검토 스냅샷: `github-actions-security@66741fec3093`

## 이 문서가 해당 역할에 도움이 되는 이유

플랫폼 에이전트는 배포가 되는지만 보지 않고, production build, 런타임 캐싱, 보안 경계,
워크플로우 권한, secret 노출 가능성까지 같이 확인해야 한다. Next.js 공식 production checklist와
GitHub Actions 보안 기준을 함께 보면 프로젝트 릴리스 PR에서 성능·접근성·보안·공급망
검토를 한 번에 빠뜨리지 않도록 만들 수 있다.

## 프로젝트에 적용할 기준

- production 전에는 `next build`와 production-like 실행으로 build error, runtime error, 번들 크기를 확인한다.
- Server Component, caching, streaming, image/font/script 최적화는 기본값을 이해한 뒤 opt-out 여부를 명시한다.
- 요청 시점 API, Server Action, environment variable은 client 노출과 dynamic rendering 영향을 함께 검토한다.
- 오류 UI, 404, 접근성 lint, metadata, sitemap, robots, Core Web Vitals 측정 계획을 릴리스 체크에 포함한다.
- GitHub Actions의 기본 `GITHUB_TOKEN` 권한은 read-only에 가깝게 두고 job 단위로 필요한 권한만 올린다.
- 외부 action과 reusable workflow는 full-length commit SHA pinning, Dependabot, CODEOWNERS, code scanning으로 관리한다.
- secret은 workflow 파일에 평문으로 두지 않고, 변환된 민감값도 로그 노출 가능성을 별도로 점검한다.

## 주의할 점

- `NEXT_PUBLIC_` 접두사가 붙은 환경 변수는 클라이언트 공개값으로 취급한다.
- `pull_request_target`이나 `workflow_run`은 권한 있는 컨텍스트에서 untrusted code를 checkout하지 않는지 먼저 확인한다.
- self-hosted runner는 public PR이나 fork 입력을 처리할 때 지속 침해와 secret 노출 위험이 크다.
- Lighthouse 같은 lab 측정은 실제 사용자 field data와 다르므로 단독 통과 기준으로 삼지 않는다.
- action tag pinning은 편리하지만 immutable하지 않으므로 위험도를 리뷰에 남긴다.

## 에이전트가 사용할 때의 체크리스트

- production build와 production-like smoke 결과가 PR 본문이나 검증 로그에 남아 있는가?
- 캐싱, dynamic rendering, Server Action 인증·인가 영향이 변경 설명에 드러나는가?
- metadata, OG, sitemap, robots, error UI, 404, 접근성 검증이 누락되지 않았는가?
- workflow 권한이 repository default 또는 job `permissions`에서 최소화되어 있는가?
- third-party actions와 reusable workflows가 SHA로 고정되어 있고 소유자를 확인했는가?
- secret, token, env, artifact, cache, log가 untrusted input과 만나는 지점을 점검했는가?
