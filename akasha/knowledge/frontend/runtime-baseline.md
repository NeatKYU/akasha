# Frontend runtime baseline

## 출처

- 출처 id: `react-docs`
- URL: https://react.dev/learn
- 소유자: React
- 권위: primary
- 라이선스 메모: Use metadata, links, and concise attributed summaries.
- 사용 메모: React component and state-management guidance.
- 검토 스냅샷: `react-docs` 구조 `709a79a2d5c4` 본문 `233c689eadbd`

- 출처 id: `next-app-router`
- URL: https://nextjs.org/docs/app
- 소유자: Vercel
- 권위: primary
- 라이선스 메모: Use metadata, links, and concise attributed summaries.
- 사용 메모: Next.js App Router and Server Component decisions.
- 검토 스냅샷: `next-app-router` 구조 `665328f10eba` 본문 `65d5949915e0`

- 출처 id: `typescript-docs`
- URL: https://www.typescriptlang.org/docs/
- 소유자: Microsoft
- 권위: primary
- 라이선스 메모: Use metadata, links, and concise attributed summaries.
- 사용 메모: Type-system and compiler guidance.
- 검토 스냅샷: `typescript-docs` 구조 `2b231891e228` 본문 `458e645945f2`


- 실제 프로젝트의 React·Next.js 버전을 먼저 확인한다.
- Server Component를 기본으로 두고 상호작용·브라우저 API에만 Client 경계를 만든다.
- framework API는 기억에 의존하지 않고 고정된 공식 문서 snapshot과 로컬 타입을 확인한다.
- 접근성, 반응형, 오류·로딩 상태를 구현 완료 조건에 포함한다.
