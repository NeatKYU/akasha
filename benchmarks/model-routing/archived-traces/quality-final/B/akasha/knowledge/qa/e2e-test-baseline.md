# 품질보증 E2E 테스트 기준

## 출처

- 출처 id: `playwright-best-practices`
- URL: https://playwright.dev/docs/best-practices
- 소유자: Microsoft
- 권위: primary
- 라이선스 메모: 메타데이터, 링크, 짧은 출처 표기 요약만 사용한다.
- 사용 메모: 브라우저 테스트 설계와 flaky test 예방 기준으로만 사용한다.
- 검토 스냅샷: `playwright-best-practices` 구조 `4759958f6b2a` 본문 `511b79b4acda`

## 이 문서가 해당 역할에 도움이 되는 이유

QA 에이전트는 테스트 수를 늘리는 것보다 사용자가 실제로 보는 동작을 안정적으로 검증해야 한다.
Playwright 공식 기준은 사용자 관점 locator, 테스트 격리, web-first assertion, trace 기반 디버깅을
강조하므로 프로젝트의 캔버스, 인증, 라우팅, 로딩 상태 회귀를 재현 가능한 방식으로 점검하는 데
직접 도움이 된다.

## 프로젝트에 적용할 기준

- 테스트 대상은 내부 함수나 CSS 구조가 아니라 사용자가 인식하는 화면, 역할, 라벨, 상태 변화로 잡는다.
- 각 테스트는 저장소, 세션, 데이터, 네트워크 mock을 독립적으로 준비해 순서 의존 실패를 만들지 않는다.
- 외부 서비스나 제3자 페이지는 직접 검증하지 않고, 프로젝트가 통제하는 API 응답이나 adapter 계약으로 대체한다.
- 비동기 UI는 수동 sleep 대신 locator와 web-first assertion으로 기다린다.
- 캔버스, 드래그, 반응형, 브라우저 차이처럼 상태가 많은 기능은 실패 시 trace나 screenshot 근거를 남긴다.
- CI에서는 필요한 브라우저와 device matrix를 명확히 제한하고, coverage 확장은 회귀 위험에 맞춰 단계적으로 한다.

## 주의할 점

- `data-testid`는 접근 가능한 역할이나 라벨이 부족한 복잡 UI의 명시적 계약으로만 사용한다.
- 테스트 generator가 만든 locator는 그대로 믿지 말고 중복 요소, 반응형 텍스트, 다국어 표시에 대해 검토한다.
- third-party 종속성 실패를 제품 실패로 오판하지 않도록 네트워크 경계를 명시한다.
- trace를 항상 켜면 비용과 저장 공간이 커질 수 있으므로 CI 첫 retry나 조사 목적에 맞춰 제한한다.

## 에이전트가 사용할 때의 체크리스트

- 사용자가 실제로 성공·실패를 판단하는 화면 결과를 assertion으로 잡았는가?
- 테스트마다 인증, seed data, storage, cookie 상태가 독립적인가?
- locator가 role, label, text, test id 순서로 안정적인 계약을 따르는가?
- 비동기 상태 검증에 `waitForTimeout`이나 즉시 boolean assertion을 남기지 않았는가?
- 외부 링크, 결제, analytics, 문서 사이트는 mock이나 계약 테스트로 분리했는가?
- 실패 보고서에 trace, screenshot, 실행 브라우저, viewport, 재현 명령이 포함되는가?
