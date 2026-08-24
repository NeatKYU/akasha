# 오류 처리와 error boundary 배치 기준

## 출처

- 출처 id: `next-error-handling`
- URL: https://nextjs.org/docs/app/getting-started/error-handling
- 소유자: Vercel
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다. 원문을 복제하지 않는다.
- 사용 메모: 예상 오류와 미포착 예외의 구분, error boundary 배치 판정에만 사용한다.
- 검토 스냅샷: `next-error-handling` 구조 `4aa39d415adf` 본문 `c8ce8747be07`

## 이 문서가 해당 역할에 도움이 되는 이유

오류 처리는 "try/catch를 썼는가"가 아니라 "이 오류가 예상된 것인가"에서 갈린다.
예상 오류를 예외로 던지면 사용자에게 복구 경로가 사라지고, 미포착 예외를 반환값으로
감추면 버그가 조용히 묻힌다. 공식 문서가 둘을 나눠 규정하므로 잘못된 분류를 지적할 수 있다.

## 프로젝트에 적용할 기준

- 검증 실패나 요청 실패처럼 정상 운영 중 발생하는 오류는 예외로 던지지 않고 반환값으로 모델링한다.
- Server Function의 예상 오류는 `useActionState`로 받아 화면에 표시한다.
- 버그를 나타내는 미포착 예외는 던져서 error boundary가 잡게 한다.
- `error.js`는 라우트 세그먼트별로 두어 필요한 범위에서만 대체 UI가 뜨게 한다. 오류는 가장 가까운 상위 경계로 전파된다.
- error boundary는 **Client Component여야 한다**.
- 이벤트 핸들러와 비동기 코드의 오류는 error boundary가 잡지 못한다. 직접 잡아 state로 옮기고 UI로 알린다.
- `global-error.js`는 루트 레이아웃을 대체하므로 자체 `html`·`body` 태그를 포함해야 한다.

## 주의할 점

- `startTransition` 안에서 던진 오류는 가장 가까운 error boundary로 전파된다. 이벤트 핸들러와 다르게 동작한다.
- error boundary는 렌더 중 오류를 잡아 대체 UI를 보여주기 위한 것이다. 모든 오류의 포괄적 처리 수단이 아니다.
- 404는 예외가 아니라 `notFound()`와 `not-found.js`로 다룬다.

## 에이전트가 사용할 때의 체크리스트

- 예상 오류를 예외로 던져 사용자 복구 경로를 없애지 않았는가?
- 미포착 예외를 반환값으로 감추지 않았는가?
- `error.js`가 필요한 세그먼트에 있고 `'use client'`가 붙어 있는가?
- 이벤트 핸들러·비동기 오류에 별도 처리가 있는가?
- `global-error.js`가 있다면 자체 html·body를 포함하는가?
