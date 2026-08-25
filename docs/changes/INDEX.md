# 변경 기록 — 이전과 무엇이 달라졌나

커밋마다 **변경 전/후를 같은 지표로 재는** 누적 A/B 기록입니다. 각 항목은 무엇이 바뀌었는지와
그 변화가 측정 가능한 값을 얼마나 움직였는지를 함께 남깁니다.

`.claude/settings.json`의 `PostToolUse` 훅이 `git commit` 직후에 이 기록을 요구합니다.
자세한 절차는 [scripts/hooks/README.md](../../scripts/hooks/README.md) 참고.

## 측정 지표

| 지표 | 재는 법 | 왜 |
| --- | --- | --- |
| always-on 토큰 | `claude plugin details akasha@neatkyu` | 아카샤를 쓰지 않는 세션에도 매번 드는 고정비 |
| on-invoke 토큰 | 같은 명령 | 스킬·에이전트가 한 번 뜰 때 드는 비용 |
| 부모 라우팅 읽기량 | 팀 구성에 실제로 읽는 bytes | `/akasha` 한 번의 진입 비용 |
| packet 반복 전달 | 역할 수 × 역할당 중복 bytes | 역할이 늘수록 선형으로 커지는 낭비 |
| 강제 수단 | 프롬프트 / 도구 경계 / 검사 | 지시가 아니라 구조로 막히는가 |

측정값은 추정치이며 실제 청구와 다를 수 있습니다. 비교는 항상 같은 명령·같은 fixture로 냅니다.

## 기록

| 버전 | 날짜 | 무엇이 달라졌나 | 측정된 변화 |
| --- | --- | --- | --- |
| [0.15.0](0.15.0-quality-first-diff-evidence.md) | 2026-08-21 | diff token·지식 선택 상한·JSON hard gate·UNIQUE 제약 지식 | 20런 재측정에서 판정 불가(r2 0.80항목·r3 0.00항목, 최소 의미 차이 1항목 미달). 문서 Read −41.7%, 총 토큰 r2 +16.7%·r3 −1.1%. 초기 후보 수치 +9.58%p·−13.22%는 재현 안 됨 |
| [0.16.0+](0.16.0-writing-knowledge-per-role.md) | 2026-08-25 | 작가 역할 7개 지식 카드를 역할당 10장으로(+59, 출처 59 고정) | 지식 문서 83→142, primary 2→8. always-on 변화 없음, 작가 역할 on-invoke +0.5k(대가). 출처 49/59가 Weiland 한 사이트(대가) |
| [0.16.0+](0.16.0-short-agent-descriptions.md) | 2026-08-25 | 역할 `description`을 세 문장 → 한 문장 | always-on ~1,686 → ~836 tok(−50%, 역할 17개). on-invoke 변화 없음. 대가: 목록의 역할 성격 정보 감소 |
| [0.16.0](0.16.0-writing-roles.md) | 2026-08-25 | 작가 도메인 역할 7개(worldbuilding·character·plot·staging·continuity·style·reader) + 지식 카드 10장 | 역할 10→17, 지식 문서 +10(primary 2·secondary 8), 출처 부채 0. always-on ~1,039→~1,686 tok(대가). 한글 맞춤법 카드 미완 |
| [0.15.0+](0.15.0-claude-code-real-run.md) | 2026-08-25 | Claude Code 설치본 실전 실행 2세션, 전사 inspector, `subagent_type` 네임스페이스 문서 수정 | 치환·도구 경계 확정, 환각 0/9(n=2). Read 페이징으로 읽기 예산 초과 4/10, 순수 JSON 3/9(펜스 4·harness 접두어 2). SKILL.md +206 bytes(대가) |
| [0.15.0+](0.15.0-knowledge-path-recovery.md) | 2026-08-25 | 지식 경로 해석 실패 복구(루트 불변식 + 나열 복구), 종합 단계 지식 재읽기 제거 | 강제 조건 4런에서 복구 B 2/2·A 1/2 실패. `internal_errors` 87→0(전부 codex CLI 버그였음). 토큰은 6배치 전부 판정 불가(MDE 15.7~29.7% > 게이트 요구 15%). 대가: 경로 검증 정착으로 비용 +13.6%(p=0.032, 다중비교 보정 시 미달) |
| [0.15.0+](0.15.0-quality-first-diff-evidence.md) | 2026-08-24 | 역할 축소 차단(SKILL.md 규정 + `model_routes` 기계 검사) | SKILL.md 21,023 → 22,083 bytes(대가). 저장된 20런에서 축소 1건만 위반으로 잡히고 오검출 0. 발생률 저감은 미검증 |
| [0.5.0](0.5.0-agents-consolidation.md) | 2026-08-19 | 역할 문서가 Claude Code 서브에이전트를 겸함 | 부모 라우팅 읽기 −56%, always-on +916 tok, 읽기 전용이 도구 경계로 강제됨 |
| [0.6.0](0.6.0-selective-knowledge-reads.md) | 2026-08-19 | 담당 지식을 전부 읽지 않고 골라 읽음 | 역할당 문서 수 상한 해제, on-invoke 역할당 +0.3k tok (문서 늘수록 회수) |
| [0.7.0](0.7.0-review-debt-control.md) | 2026-08-19 | 출처 72건 등록 + 검토 부채 통제 | 카탈로그 28→100, 승격 차단 출처 −73%, 검토 부채 5/12 계측 시작 |
| [0.8.0](0.8.0-knowledge-only.md) | 2026-08-19 | 지식 문서 + 원본 변경 감지만 남김 | 293파일 삭제, catalog·reports 제거, 출처 URL 보유 문서 9→14 |
| [0.9.0](0.9.0-knowledge-format-unification.md) | 2026-08-19 | 지식 문서 양식 통일 + 출처 1:1 분리 | 문서 14→27개, 양식 위반 8→0, frontend·design 스텁 해소 |
| [0.10.0](0.10.0-versioning-rules.md) | 2026-08-19 | 버전 규칙 문서화·강제 + 지식 4개 | 문서 27→31, 등급 검사 7종, ajv 유령 의존성·\Z 정규식 버그 수정 |
