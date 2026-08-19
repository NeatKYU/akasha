# Backend and data baseline

## 출처

- 출처 id: `next-route-handlers`
- URL: https://nextjs.org/docs/app/api-reference/file-conventions/route
- 소유자: Vercel
- 권위: primary
- 라이선스 메모: Use metadata, links, and concise attributed summaries.
- 사용 메모: Route Handler API decisions.
- 검토 스냅샷: `next-route-handlers` 구조 `c940171ac0d4` 본문 `81c6c8ad5c8d`

- 출처 id: `nextauth-v4`
- URL: https://next-auth.js.org/
- 소유자: NextAuth.js
- 권위: primary
- 라이선스 메모: Use metadata, links, and concise attributed summaries.
- 사용 메모: Current project authentication implementation guidance.
- 검토 스냅샷: `nextauth-v4` 구조 `7ef826429aeb` 본문 `07bcf8332825`

- 출처 id: `prisma-docs`
- URL: https://www.prisma.io/docs/orm
- 소유자: Prisma Data
- 권위: primary
- 라이선스 메모: Use metadata, links, and concise attributed summaries.
- 사용 메모: Prisma schema, query, and migration guidance.
- 검토 스냅샷: `prisma-docs` 구조 `3bfa4a11d630` 본문 `c1e0d5963db8`

- 출처 id: `postgres-docs`
- URL: https://www.postgresql.org/docs/current/
- 소유자: PostgreSQL Global Development Group
- 권위: primary
- 라이선스 메모: Use metadata, links, and concise attributed summaries.
- 사용 메모: PostgreSQL integrity, indexing, and SQL semantics.
- 검토 스냅샷: `postgres-docs` 구조 `1e3d9833dcd6` 본문 `948a6379bb02`


- 인증·인가·입력 검증을 서버 경계에서 수행한다.
- API 성공·오류 계약과 데이터 무결성 조건을 명시한다.
- Prisma schema와 migration은 별개의 고위험 산출물로 검토한다.
- query·index 제안은 실제 실행 계획과 대표 데이터 규모로 검증한다.
