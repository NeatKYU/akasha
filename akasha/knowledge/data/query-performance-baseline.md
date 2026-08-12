# 데이터 쿼리 성능 기준

## 출처

- URL: https://www.postgresql.org/docs/current/using-explain.html
- 소유자: PostgreSQL Global Development Group
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다.
- 사용 메모: 쿼리 실행 계획과 인덱스 효과를 검토할 때만 사용한다.
- 출처 카탈로그: `postgres-explain`

- URL: https://www.prisma.io/docs/orm/prisma-client/queries/advanced/query-optimization-performance
- 소유자: Prisma Data
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다.
- 사용 메모: Prisma Client 쿼리 병목과 N+1 패턴을 진단할 때만 사용한다.
- 출처 카탈로그: `prisma-query-optimization`

## 이 문서가 해당 역할에 도움이 되는 이유

데이터 에이전트는 느린 화면을 코드 감각만으로 판단하지 않고, ORM 호출과 실제 데이터베이스 실행 계획을
함께 확인해야 한다. Prisma 공식 문서는 애플리케이션 쪽 쿼리 패턴과 관계 로딩 비용을 보는 기준을 주고,
PostgreSQL 공식 문서는 planner가 선택한 scan, join, sort, row estimate를 근거로 병목을 읽는 방법을
제공한다.

## 프로젝트에 적용할 기준

- 성능 변경 PR은 영향을 받는 API, Prisma 호출, SQL 조건, 예상 데이터 규모를 함께 적는다.
- 느린 쿼리는 먼저 대표 입력과 실제 조건을 고정한 뒤 `EXPLAIN` 또는 `EXPLAIN ANALYZE` 근거로 판단한다.
- row estimate와 actual row 차이가 크면 통계 최신성, 조건 선택도, join 순서, 인덱스 후보를 따로 점검한다.
- Prisma `include`, 관계 필드 반복 접근, 루프 안의 쿼리 호출은 N+1 가능성으로 보고 배치 또는 명시적 relation loading을 검토한다.
- 인덱스 제안은 필터, 정렬, 조인 키, 쓰기 비용, 기존 인덱스 중복 여부를 같이 확인한 뒤 migration으로 분리한다.
- 측정 결과는 로컬 소량 데이터가 아니라 운영에 가까운 분포나 fixture로 재현할 수 있어야 한다.

## 주의할 점

- `EXPLAIN ANALYZE`는 실제로 쿼리를 실행하므로 쓰기 쿼리나 부하가 큰 쿼리에 바로 사용하지 않는다.
- planner cost는 절대 실행 시간이 아니며, row estimate와 plan shape 변화의 근거로 읽는다.
- 인덱스가 항상 빠른 선택은 아니며, 낮은 선택도 조건이나 큰 정렬에서는 sequential scan이 합리적일 수 있다.
- ORM 레벨에서 호출 수가 줄어도 데이터베이스에서는 더 비싼 join이나 정렬이 생길 수 있다.
- 캐시로 가려지는 성능은 데이터 규모가 커지면 다시 드러나므로 cold path와 warm path를 구분한다.

## 에이전트가 사용할 때의 체크리스트

- 느린 사용자 흐름과 연결된 API 또는 서버 액션을 특정했는가?
- Prisma query log나 호출 위치로 반복 쿼리와 관계 로딩 패턴을 확인했는가?
- `EXPLAIN` 결과에서 scan type, join type, sort, row estimate, filter 위치를 읽었는가?
- 인덱스 후보가 실제 조건과 정렬 순서를 만족하고 기존 인덱스와 중복되지 않는가?
- migration, seed, benchmark, rollback 위험을 PR 본문에 분리해 적었는가?
- 성능 개선 주장을 검증 명령, 실행 계획, 전후 수치 중 하나 이상으로 뒷받침했는가?
