# PostgreSQL 실행 계획 판독 기준

## 출처

- 출처 id: `postgres-explain`
- URL: https://www.postgresql.org/docs/current/using-explain.html
- 소유자: PostgreSQL Global Development Group
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다.
- 사용 메모: 쿼리 실행 계획과 인덱스 효과를 검토할 때만 사용한다.
- 검토 스냅샷: `postgres-explain` 구조 `4f4a8634e218` 본문 `20fc66d9edfb`

## 이 문서가 해당 역할에 도움이 되는 이유

데이터 에이전트는 느린 화면을 코드 감각으로 판단하지 않고 planner가 실제로 고른 계획을 근거로 삼아야 한다.
PostgreSQL 공식 문서는 scan, join, sort, row estimate를 읽는 방법을 규정하므로, 성능 주장을 검증 가능한
근거로 바꾸는 데 직접 쓰인다.

## 프로젝트에 적용할 기준

- 느린 쿼리는 대표 입력과 실제 조건을 고정한 뒤 `EXPLAIN` 또는 `EXPLAIN ANALYZE` 결과로 판단한다.
- row estimate와 actual row 차이가 크면 통계 최신성, 조건 선택도, join 순서를 따로 점검한다.
- 인덱스 제안은 필터, 정렬, 조인 키, 쓰기 비용, 기존 인덱스 중복을 함께 확인한 뒤 migration으로 분리한다.
- 측정은 로컬 소량 데이터가 아니라 운영에 가까운 분포나 fixture로 재현할 수 있어야 한다.
- 성능 개선 주장은 실행 계획 또는 전후 수치 중 하나 이상으로 뒷받침한다.

## 주의할 점

- `EXPLAIN ANALYZE`는 실제로 쿼리를 실행하므로 쓰기 쿼리나 부하가 큰 쿼리에 바로 쓰지 않는다.
- planner cost는 절대 실행 시간이 아니며, row estimate와 plan shape 변화의 근거로 읽는다.
- 인덱스가 항상 빠른 선택은 아니다. 낮은 선택도 조건이나 큰 정렬에서는 sequential scan이 합리적일 수 있다.
- 캐시로 가려지는 성능은 데이터가 커지면 다시 드러나므로 cold path와 warm path를 구분한다.

## 에이전트가 사용할 때의 체크리스트

- 대표 입력과 조건을 고정한 뒤 실행 계획을 얻었는가?
- scan type, join type, sort, row estimate, filter 위치를 읽었는가?
- 인덱스 후보가 실제 조건과 정렬 순서를 만족하고 기존 인덱스와 중복되지 않는가?
- 쓰기 쿼리에 `EXPLAIN ANALYZE`를 그대로 실행하지 않았는가?
- 개선 주장을 실행 계획이나 전후 수치로 뒷받침했는가?
