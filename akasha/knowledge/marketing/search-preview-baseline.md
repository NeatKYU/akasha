# 검색 노출과 공유 미리보기 기준

## 출처

- URL: https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- 소유자: Google
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다.
- 사용 메모: 검색 노출 가능성과 콘텐츠 구조 검토에만 사용한다.
- 출처 카탈로그: `google-seo-starter`
- 검토 스냅샷: `google-seo-starter@ad029ebc4b95`

- URL: https://nextjs.org/docs/app/getting-started/metadata-and-og-images
- 소유자: Vercel
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다.
- 사용 메모: Next.js App Router metadata와 Open Graph 이미지 구현 기준으로만 사용한다.
- 출처 카탈로그: `next-metadata-og`
- 검토 스냅샷: `next-metadata-og@b8a539dbc0c1`

## 이 문서가 해당 역할에 도움이 되는 이유

마케팅 에이전트는 문구를 더하는 것보다 검색 엔진과 공유 채널이 실제로 읽을 수 있는 제목, 설명,
URL 구조, Open Graph 미리보기를 확인해야 한다. Google 공식 SEO 기준은 발견 가능성과 사용자 중심
콘텐츠를 검토하는 기준을 주고, Next.js 공식 문서는 App Router에서 metadata와 OG 이미지를 구현하는
프로젝트 경계를 제공한다.

## 프로젝트에 적용할 기준

- 공개 페이지는 페이지 목적과 사용자 의도를 반영한 `title`과 `description`을 라우트 단위로 가진다.
- 랜딩, 템플릿, 공개 다이어그램, 문서성 페이지는 공유 시 보일 Open Graph 제목, 설명, 이미지를 검토한다.
- 중복 페이지나 임시 페이지는 검색 노출 대상인지 먼저 결정하고, 필요하면 canonical, robots, sitemap 기준을 남긴다.
- SEO 제안은 검색 순위 보장처럼 쓰지 않고, 발견 가능성, 클릭 전 정보 품질, 공유 미리보기 품질로 표현한다.
- metadata 변경은 실제 렌더링 결과, 정적 생성 여부, 동적 데이터 의존성을 함께 확인한다.
- 마케팅 문구는 기능 상태와 다르게 과장하지 않고, 사용자가 페이지에서 실제로 얻는 결과와 일치시킨다.

## 주의할 점

- 검색 최적화는 즉시 순위를 보장하지 않으며, 기술 metadata만으로 콘텐츠 품질 문제를 해결할 수 없다.
- `generateMetadata`가 동적 데이터를 읽으면 캐싱과 렌더링 방식에 영향을 줄 수 있다.
- Open Graph 이미지는 예쁘기보다 공유 맥락에서 제목, 대상, 상태가 잘 읽히는지가 우선이다.
- 내부 도구, 인증 필요 페이지, 실험 페이지를 무리하게 색인 대상으로 만들지 않는다.
- 같은 메시지를 title, h1, description, OG copy에 반복하면 사용자가 얻는 정보량이 줄어든다.

## 에이전트가 사용할 때의 체크리스트

- 공개 대상 라우트와 비공개 라우트를 먼저 구분했는가?
- 각 공개 페이지의 title, description, h1이 서로 충돌하지 않고 사용자 의도를 설명하는가?
- 공유 미리보기에서 브랜드, 페이지 목적, 핵심 상태가 작은 화면에서도 읽히는가?
- canonical, sitemap, robots, noindex 판단이 페이지 목적과 일치하는가?
- metadata 구현이 App Router의 정적 또는 동적 렌더링 기대와 맞는가?
- 검색 노출 관련 주장을 성과 보장이 아니라 검토 가능한 구현 품질로 표현했는가?
