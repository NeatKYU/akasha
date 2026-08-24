# Next.js 배포 준비 점검 기준

## 출처

- 출처 id: `vercel-next-production`
- URL: https://nextjs.org/docs/app/guides/production-checklist
- 소유자: Vercel
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다.
- 사용 메모: Next.js 배포 준비와 운영 점검 기준으로만 사용한다.
- 검토 스냅샷: `vercel-next-production` 구조 `d597dc6781bf` 본문 `37f101f0ba84`

## 이 문서가 해당 역할에 도움이 되는 이유

플랫폼 에이전트는 배포가 되는지만 보지 않고 production build, 런타임 캐싱, 환경 변수 노출까지
확인해야 한다. Next.js 공식 production checklist는 릴리스 PR에서 빠뜨리기 쉬운 항목을 규정한다.

## 프로젝트에 적용할 기준

- production 전에는 `next build`와 production-like 실행으로 build error, runtime error, 번들 크기를 확인한다.
- Server Component, caching, streaming, image/font/script 최적화는 기본값을 이해한 뒤 opt-out 여부를 명시한다.
- 요청 시점 API, Server Action, environment variable은 client 노출과 dynamic rendering 영향을 함께 검토한다.
- 오류 UI, 404, metadata, sitemap, robots, Core Web Vitals 측정 계획을 릴리스 체크에 포함한다.

## 주의할 점

- `NEXT_PUBLIC_` 접두사가 붙은 환경 변수는 클라이언트 공개값으로 취급한다.
- Lighthouse 같은 lab 측정은 실제 사용자 field data와 다르므로 단독 통과 기준으로 삼지 않는다.

## 에이전트가 사용할 때의 체크리스트

- production build와 production-like smoke 결과가 검증 로그에 남아 있는가?
- 캐싱, dynamic rendering, Server Action 영향이 변경 설명에 드러나는가?
- metadata, OG, sitemap, robots, error UI, 404 검증이 누락되지 않았는가?
- 클라이언트로 나가는 환경 변수를 의도적으로 구분했는가?
