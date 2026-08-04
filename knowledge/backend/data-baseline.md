# Backend and data baseline

- 인증·인가·입력 검증을 서버 경계에서 수행한다.
- API 성공·오류 계약과 데이터 무결성 조건을 명시한다.
- Prisma schema와 migration은 별개의 고위험 산출물로 검토한다.
- query·index 제안은 실제 실행 계획과 대표 데이터 규모로 검증한다.

Source catalog: `next-route-handlers`, `nextauth-v4`, `prisma-docs`, `postgres-docs`.
