# 변경 이력

이 프로젝트는 [Semantic Versioning](https://semver.org/)을 따릅니다.

## [0.2.1] - 2026-08-14

### 변경

- 기본 Akasha child에서 런타임 `agent_type` 자동 매핑을 금지해 실행 편차 축소
- child 읽기 호출과 root 라우팅·재검증 호출에 탐색 상한 추가
- 담당 지식 문서에 공식 URL이 없으면 `source_url: null`로 즉시 종료하는 규칙 추가

### 검증

- agent type, 탐색 예산, source URL 중단 조건의 계약 회귀 검사 추가

## [0.2.0] - 2026-08-14

### 추가

- 역할별 bounded context packet과 구조화된 반환 계약
- Codex 서브에이전트 호출·대기 계약 및 회귀 검증
- Codex 플러그인 인터페이스 메타데이터

### 변경

- 역할 문서·지식 문서·diff 전문을 child prompt에 복사하지 않고 필요한 원본을 직접 읽도록 변경
- 중복 판정과 반복 읽기를 줄이는 종합 규칙 추가

## [0.1.0] - 2026-08-04

### 추가

- 승인 지식베이스와 역할 기반 Akasha 플러그인의 최초 공개 버전
