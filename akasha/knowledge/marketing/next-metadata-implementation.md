# Next.js metadata와 공유 미리보기 구현 기준

## 출처

- 출처 id: `next-metadata-og`
- URL: https://nextjs.org/docs/app/getting-started/metadata-and-og-images
- 소유자: Vercel
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다.
- 사용 메모: Next.js App Router metadata와 Open Graph 이미지 구현 기준으로만 사용한다.
- 검토 스냅샷: `next-metadata-og` 구조 `db539d27c2af` 본문 `f169a6b26793`

## 이 문서가 해당 역할에 도움이 되는 이유

발견 가능성 기준을 실제 코드로 옮기는 지점이 App Router의 metadata API다. Next.js 공식 문서는
metadata와 Open Graph 이미지를 어디에 선언하고 렌더링 방식에 어떤 영향을 주는지 규정한다.

## 프로젝트에 적용할 기준

- 랜딩, 템플릿, 공개 문서성 페이지는 공유 시 보일 Open Graph 제목, 설명, 이미지를 검토한다.
- metadata 변경은 실제 렌더링 결과, 정적 생성 여부, 동적 데이터 의존성을 함께 확인한다.
- 라우트 세그먼트별 metadata 상속과 덮어쓰기 관계를 확인한 뒤 중복 선언을 정리한다.

## 주의할 점

- `generateMetadata`가 동적 데이터를 읽으면 캐싱과 렌더링 방식에 영향을 줄 수 있다.
- Open Graph 이미지는 예쁘기보다 공유 맥락에서 제목, 대상, 상태가 잘 읽히는지가 우선이다.

## 에이전트가 사용할 때의 체크리스트

- 공유 미리보기에서 브랜드, 페이지 목적, 핵심 상태가 작은 화면에서도 읽히는가?
- metadata 구현이 App Router의 정적 또는 동적 렌더링 기대와 맞는가?
- 세그먼트 상속으로 의도치 않게 덮어써지는 값이 없는가?
