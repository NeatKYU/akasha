# 서버·클라이언트 컴포넌트 경계 기준

## 출처

- 출처 id: `next-server-client-components`
- URL: https://nextjs.org/docs/app/getting-started/server-and-client-components
- 소유자: Vercel
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다. 원문을 복제하지 않는다.
- 사용 메모: Server/Client 경계 설정과 `'use client'` 배치 판정에만 사용한다.
- 검토 스냅샷: `next-server-client-components` 구조 `d01d056aaade` 본문 `1d8079c7b3a1`

## 이 문서가 해당 역할에 도움이 되는 이유

App Router에서 가장 자주 잘못 잡히는 경계가 Server/Client다. `'use client'`를 트리 위쪽에
붙이면 그 아래 전체가 클라이언트 번들로 넘어가고, 서버 전용이어야 할 값이 클라이언트로
흘러갈 통로가 생긴다. 공식 문서가 기본값과 경계 규칙을 규정하므로 배치 위반을 판정할 수 있다.

## 프로젝트에 적용할 기준

- Server Component가 기본이다. 상호작용, 브라우저 API, 상태 훅이 필요한 지점에만 Client 경계를 만든다.
- `'use client'`는 경계가 필요한 **가장 아래쪽** 컴포넌트에 붙인다. 레이아웃이나 페이지 최상단에 습관적으로 붙이지 않는다.
- Server Component에서 Client Component로 넘기는 props는 직렬화 가능해야 한다. 함수, 클래스 인스턴스, Date 이외의 비직렬화 값을 넘기지 않는다.
- 클라이언트로 넘어가는 값은 화면에 필요한 필드만 담는다. 서버 객체 전체를 그대로 넘기지 않는다.
- Client Component를 Server Component의 자식으로 조합할 때는 `children`으로 전달해 서버 렌더 범위를 유지한다.

## 주의할 점

- `'use client'`는 그 파일부터 아래로 전파된다. 한 곳의 배치가 번들 크기와 노출 범위를 함께 바꾼다.
- Client Component 안에서 import한 모듈은 클라이언트 번들에 포함된다. 서버 전용 모듈을 실수로 끌어오지 않는지 확인한다.
- 경계를 아래로 내리는 것이 항상 옳지는 않다. 상호작용이 넓게 퍼진 화면은 오히려 경계가 위에 있는 편이 단순할 수 있다. 근거를 남긴다.

## 에이전트가 사용할 때의 체크리스트

- 이 컴포넌트가 Client여야 하는 이유가 상호작용·브라우저 API·상태 훅 중 무엇인가?
- `'use client'`가 필요한 최소 범위에 붙어 있는가, 아니면 트리 위쪽에 붙어 아래 전체를 끌고 가는가?
- Server → Client props가 모두 직렬화 가능하고, 화면에 필요한 필드만 담고 있는가?
- Client Component가 서버 전용 모듈이나 비밀값에 접근하는 경로를 만들지 않는가?
- 경계를 위로 올린 선택이라면 그 이유가 설명되어 있는가?
