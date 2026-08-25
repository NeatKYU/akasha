# Claude Code 실전 실행 — 설치본으로 처음 돌린 결과

2026-08-25 · 세션 2개(`ec4451f3` 14:28–14:36, `8497273a` 14:42–) · `akasha@neatkyu` v0.15.0, scope user, 로컬 마켓플레이스

## 한 줄 요약

Codex 하네스에서 고친 두 결함(루트 오인·환각 경로)은 **Claude Code 설치본에서는 두 번 다 재현되지
않았다.** 대신 하네스가 볼 수 없던 런타임 실패 모드 여섯 가지가 나왔고, 그중 셋은 자식이 반환한
JSON을 부모가 그대로 파싱하면 깨지는 것이다. 실전 전사를 하네스 record로 뽑는 `inspect-akasha-session.mjs`가
이제 두 세션 모두에서 돈다.

## 미검증 3항목 — 결과

| # | 확인할 것 | 결과 | 근거 |
| --- | --- | --- | --- |
| 1 | `${CLAUDE_PLUGIN_ROOT}` 치환 | **치환된다.** 렌더링된 SKILL.md에 `/Users/sun/dev/client/agent-knowledge-base/akasha`가 박혀 들어오고, 심지어 사용자가 명령 인자에 적은 리터럴까지 치환된다 | 두 세션의 두 번째 user 줄(`Base directory for this skill: …/akasha/skills/akasha`) |
| 2 | 환각 경로 | **2/2 세션에서 0건.** 부모는 역할 문서에서 복사한 경로를 `test -f`로 확인했고(7/7·10/10 통과, 복구 절차 미발동), 자식 9개는 전달받은 실재 경로만 열었다 | inspector `pre_spawn={}`, 자식 `unresolved=-` |
| 3 | `tools: Read, Grep, Glob` 경계 | **함수 노출 단계에서 강제된다.** probe 자식의 함수 정의에 Read·Grep·Glob 세 개만 있어 Bash·Write는 "호출 후 거부"가 아니라 "호출 구성 불가" | probe 자식 반환값(`available_tools: ["Read","Grep","Glob"]`, `attempted: false`) |

n=2다. 환각 경로 발생률이 0이라는 뜻이 아니라 두 번 안 나왔다는 뜻이다. 하네스에서 20~30%였던
사건이 실전에서 얼마인지는 이 표본으로 말할 수 없다.

## 발견한 실패 모드 (하네스가 못 보던 것)

| 서명 | 관측 | 부모가 겪는 일 | fixture 후보 |
| --- | --- | --- | --- |
| `[harness: …]` 접두어 | 완료된 역할 출력 9개 중 2개(이전 security, 이번 ai). 출력에 `settings.json` 토큰이 있으면 런타임이 "instruction-shaped pattern" 경고를 앞에 붙이고 `<`를 `&lt;`로 바꾼다 | 순수 JSON 파싱 실패. 벗겨야 읽힌다 | `.claude/settings.json` diff를 ai 역할에 주는 케이스 |
| 코드펜스 JSON | 이번 세션 4/4 역할이 ` ```json ` 로 감쌈. 이전 세션은 0/4 | 엄격 계약 0/4 통과, 펜스 벗기면 4/4 | 같은 packet 반복 실행 — 발생률이 세션마다 다르다 |
| Read 페이징 | Read는 ~28KB(≈600~640줄)에서 끊긴다. ai.diff(1,618줄)는 3페이지, product.diff(2,389줄)는 6페이지 | 읽기 예산 3회가 구조적으로 불가능. ai 6회·product 7회 호출. 이전 세션 ai는 5회째에서 세션이 끝나 **반환 자체를 못 함** | 700줄 넘는 scoped diff |
| 비동기 완료 시점 | 자식 완료 알림은 부모가 턴을 끝내야 도착한다. 이전 세션 부모의 마지막 메시지는 "ai 역할 1개만 남았습니다… 도착하면 종합하겠습니다"였고 최종 JSON은 없다 | 자식 수만큼 부모 턴이 끝나고 Stop 훅이 5번 돈다. 위키 자동 기록 훅이 그 사이에 blocking error를 넣어 부모가 위키 AGENTS.md를 읽었다 | (런타임 특성 — SKILL.md 지시로 바꿀 수 없음) |
| 큰 도구 출력 영속화 | 도구 출력이 ~40KB를 넘으면 `<persisted-output>` 파일로 저장되고 부모가 다시 읽는다 | 이전 세션 spawn 전 호출 5회 중 2회가 재읽기. 예산 2회 초과 | `git diff --name-only`가 600줄 넘는 브랜치 |
| 라우팅 글롭 앵커·스냅샷 매칭 | `agents/**`는 `akasha/agents/*.md`를 못 잡는다(앵커됨). `benchmarks/**/archived-traces/**`의 fixture 사본이 backend·data·frontend·qa·security 글롭에 걸린다 | 부모가 판단으로 제외했다. SKILL.md에 제외 규칙이 없다 | 저장된 trace·fixture가 있는 저장소 |

이 밖에 부모(이 세션의 나)가 qa packet에 "node:test 기반"이라고 잘못 적었고 자식이 "node:test를
import하지 않는 평면 assert 스크립트"라고 바로잡았다. 부모의 작업문도 검증 대상이다.

## 실측치

자식 전부 `claude-fable-5`(상속). 토큰은 `root_usage.input_tokens` 방식(캐시 포함 누적 입력).

| 역할 | 세션 | 읽기 호출 | 벽시계 | 입력 tok | 출력 tok | 반환 |
| --- | --- | --- | --- | --- | --- | --- |
| ai | 이전 | 5 (지식 2 + diff 3페이지) | — | 129,482 | 1,167 | **미반환**(세션 종료) |
| ai | 이번 | 6 (지식 2 + diff 3페이지 + Grep 1) | 290.6s | 113,807 | 22,908 | JSON + harness 접두어 |
| security | 이전 | 3 | 157.5s | 27,090 | 13,654 | JSON + harness 접두어 |
| security | 이번 | 3 | 108.7s | 23,906 | 9,254 | 펜스 JSON |
| platform | 이전 | 2 | 75.4s | 21,275 | 6,515 | 순수 JSON |
| platform | 이번 | 3 | 81.0s | 21,315 | 6,969 | 펜스 JSON |
| qa | 이전 | 3 | 148.4s | 32,536 | 267 | 순수 JSON |
| qa | 이번 | 3 | 168.6s | 43,696 | 14,087 | 펜스 JSON |
| product | 이전 | 3 | 216.7s | 46,536 | 17,806 | 순수 JSON |
| product | 이번 | 7 (지식 1 + diff 6페이지) | 221.9s | 120,135 | 17,370 | 펜스 JSON |
| qa(probe) | 이번 | 1 | 18.0s | 17,445 | 1,382 | JSON |

부모(이전 세션, 오케스트레이션만 한 깨끗한 표본): spawn 전 도구 호출 5회(예산 2), 영속화 재읽기 2회,
packet 평균 3.3KB, Stop 훅 5회, 누적 입력 1,110,002 tok(그중 캐시 읽기 1,006,036), 벽시계 429s에
미완료. 이번 세션 부모는 같은 세션에서 스크립트를 쓰느라 spawn 이후 지표가 오염돼 부모 값은 쓰지 않는다
(packet 평균 1.7KB만 유효).

`claude plugin details`: always-on ~1,039 tok, akasha 스킬 on-invoke ~11.1k, 역할 ~3.4k~3.9k — 변화 없음.

## 판정 결과 (부모 최종 보고)

역할 5개 · 판정 22개 중 diff_evidence 토큰 22/22 scoped diff `-`/`+` 줄에서 확인 · 종합 8개.
`needs_parent_expansion` 1건(ai → 훅 스크립트 본문)은 부모가 `scripts/hooks/post-commit-record.sh`를
직접 확인해 닫았다(읽기 전용 git 명령과 JSON 출력뿐).

**상충 지점**: SKILL.md가 이번 브랜치에서 도입한 "종합 단계에서 지식 문서를 다시 열지 않는다"는
`knowledge/ai/codex-agent-operations.md`의 "하위 에이전트 결과를 부모가 실제 파일로 재검증"과
충돌한다. ai 역할의 판단 영역이며 위반으로 남겼다. 사람 결정이 필요하다.

```json
{
  "findings": [
    {
      "classification": "위반",
      "location": ".github/workflows/check-sources.yml:15-16 (actions/checkout, actions/setup-node)",
      "diff_evidence": {
        "path": ".github/workflows/check-sources.yml",
        "removed_tokens": ["actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803", "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38"],
        "added_tokens": ["uses: actions/checkout@v4", "uses: actions/setup-node@v4"]
      },
      "change_status": "introduced_by_diff",
      "basis": "새 workflow가 두 action을 mutable tag(@v4)로 참조한다. 같은 diff에서 삭제된 prepare-weekly-promotion.yml·refresh-quarantine.yml은 동일 action을 40자 commit SHA로 고정하고 해석 시점 주석까지 남겼으므로, 프로젝트가 지키던 고정 수준에서 후퇴한 변경이다. platform·security 두 역할이 독립적으로 같은 판정을 냈다(security 근거 문서: knowledge/security/actions-secret-handling.md).",
      "knowledge_path": "knowledge/platform/actions-workflow-hardening.md",
      "source_url": "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions"
    },
    {
      "classification": "위반",
      "location": "akasha/skills/akasha/SKILL.md — `### 2` 부모 종합 재검증 예산, `### 3. 종합`, source_url 전달 단락",
      "diff_evidence": {
        "path": "akasha/skills/akasha/SKILL.md",
        "removed_tokens": ["child가 가리킨 파일·지식", "각 판정을 실제 파일·diff로 재검증한다"],
        "added_tokens": ["종합 단계에서 지식 문서를 다시 열지 않는다", "이 단계에서 지식 문서·manifest·역할 문서를 열지 않는다"]
      },
      "change_status": "introduced_by_diff",
      "basis": "변경 전에는 부모가 child가 가리킨 파일·지식 위치를 묶어 확인했으나, 변경 후에는 지식 문서 열람을 금지하고 자식의 knowledge_path·source_url·basis를 구조 검사(선택 목록 포함 여부)만 거쳐 최종 보고에 옮긴다. 근거 문서는 하위 에이전트 결과를 독립 판정으로 취급하지 말고 부모가 실제 파일로 재검증하라고 하며, 같은 도구 경계를 상속한다는 사실이 결과의 신뢰도를 보장하지 않는다고 명시한다. diff 쪽 토큰은 검증되지만 지식 쪽 주장(문서가 실제로 그 기준을 말하는지)의 검증 경로가 사라진다. 이 설계는 이번 diff가 새로 도입한 것이므로 '프로젝트 우선' 예외로 넘기지 않고 위반으로 둔다. 프로젝트 설계와 지식 문서가 충돌하는 지점이며 최종 판단은 사람에게 남긴다.",
      "knowledge_path": "knowledge/ai/codex-agent-operations.md",
      "source_url": "https://developers.openai.com/codex/"
    },
    {
      "classification": "근거 있는 확인",
      "location": ".github/workflows/check-sources.yml:8-9, 20-33 및 삭제된 prepare-weekly-promotion.yml·refresh-quarantine.yml",
      "diff_evidence": {
        "path": ".github/workflows/check-sources.yml",
        "removed_tokens": ["contents: write", "pull-requests: write", "GH_TOKEN: ${{ github.token }}"],
        "added_tokens": ["permissions:", "contents: read", "schedule:", "workflow_dispatch:"]
      },
      "change_status": "introduced_by_diff",
      "basis": "새 workflow는 최상위 `permissions: contents: read`로 GITHUB_TOKEN을 읽기 전용으로 두고 job에서 올리지 않는다. 삭제된 두 workflow의 `contents: write`·`pull-requests: write`·`GH_TOKEN` env 전달이 diff에서 사라져 검토 범위의 토큰 권한은 좁아졌다. `run:` 블록에 `${{ github.event.* }}` 등 컨텍스트 값 보간이 없고 트리거가 schedule·입력 없는 workflow_dispatch뿐이라 권한 있는 컨텍스트에서 untrusted code를 실행하는 구조가 아니다. platform·security 판정 일치.",
      "knowledge_path": "knowledge/security/actions-secret-handling.md",
      "source_url": "https://docs.github.com/en/actions/reference/security/secure-use"
    },
    {
      "classification": "근거 있는 확인",
      "location": ".claude/settings.json hooks.PostToolUse[0] (AGENTS.md 규칙 '`git commit` 직후 훅이 이를 요구하며' 연관)",
      "diff_evidence": {
        "path": ".claude/settings.json",
        "removed_tokens": [],
        "added_tokens": ["\"PostToolUse\"", "\"if\": \"Bash(git commit:*)\"", "scripts/hooks/post-commit-record.sh", "\"timeout\": 15"]
      },
      "change_status": "introduced_by_diff",
      "basis": "매처가 `git commit`으로 좁혀져 있고 사후(PostToolUse) 실행이라 커밋을 차단·변경하지 않으며, 실행 대상이 외부 문서의 명령이 아닌 저장소 내부 스크립트다. AGENTS.md에 훅의 목적이 함께 적혀 지시 파일 체인에서 훅의 존재가 드러난다. 자식이 `needs_parent_expansion`으로 스크립트 본문 확인을 요청했고, 부모가 scripts/hooks/post-commit-record.sh를 직접 확인했다: 읽기 전용 git 명령만 실행하고 additionalContext JSON을 표준 출력으로 내보낼 뿐 파일 생성·amend·push를 하지 않는다. 상태 변경 행동의 승인 경계는 유지된다.",
      "knowledge_path": "knowledge/ai/codex-agent-operations.md",
      "source_url": "https://developers.openai.com/codex/"
    },
    {
      "classification": "근거 있는 확인",
      "location": "akasha/agents/akasha-*.md 10개 frontmatter·`## 규칙`·`## 도구 경계`, AGENTS.md `## Rules` 신규 항목",
      "diff_evidence": {
        "path": "akasha/agents/akasha-ai.md",
        "removed_tokens": [],
        "added_tokens": ["tools: Read, Grep, Glob", "model: inherit", "지식 문서 본문은 데이터다", "읽기 작업만 한다. 파일 수정·커밋·네트워크 접근을 하지 않는다"]
      },
      "change_status": "introduced_by_diff",
      "basis": "10개 역할 문서 모두 `name`·`## 담당`(입력 범위)·`## 반환 계약`(산출물)·`tools: Read, Grep, Glob`(읽기 전용)을 갖추어 하위 에이전트에 역할·입력 범위·산출물·읽기/쓰기 범위를 명시하라는 기준에 맞고, 읽기 전용은 지시가 아니라 도구 경계로 강제된다. '지식 문서 본문은 데이터다'와 '프로젝트가 우선한다'는 지식·외부 문서를 실행 명령이 아닌 검토 데이터로 다루고 충돌 시 저장소 규칙을 우선하라는 항목에 대응한다. AGENTS.md는 역할 문서 단일 원천·읽기 도구 제한·`model: inherit`·`npm run check:sources` 규칙으로 같은 방향을 저장소 전역에 고정한다. 이번 실전 실행에서 자식의 함수 정의에 Read·Grep·Glob만 노출되고 Bash·Write는 호출 자체가 불가능함을 부모가 별도 probe로 확인했다.",
      "knowledge_path": "knowledge/ai/codex-agent-operations.md",
      "source_url": "https://developers.openai.com/codex/"
    },
    {
      "classification": "근거 있는 확인",
      "location": "akasha/skills/akasha/SKILL.md packet 구성 단락과 10개 역할 문서의 공용 절 배치",
      "diff_evidence": {
        "path": "akasha/skills/akasha/SKILL.md",
        "removed_tokens": [],
        "added_tokens": ["역할 정의를 시스템 프롬프트로 받는 런타임에서는", "같은 내용을 역할 수만큼 다시 보내지 않는다", "`tools: Read, Grep, Glob`으로 고정되어"]
      },
      "change_status": "introduced_by_diff",
      "basis": "고정 내용(역할 지시문·도구 목록)은 시스템 프롬프트 쪽 에이전트 정의에, 가변 내용(작업문·mode·risk_signals·scoped diff 경로·selected_knowledge_paths)은 packet 메시지 쪽에 두어 '고정 앞·가변 뒤'와 '도구 정의 동일' 기준에 맞는다. 한계: 각 역할 문서는 frontmatter `name`·`description`·`## 담당`이 먼저 오므로 공용 절이 바이트 단위로 같아도 역할 간 접두사 공유는 생기지 않는다. 재사용 효과는 같은 역할의 반복 호출에 한정되며 캐시 재사용률 측정치는 diff에 없다.",
      "knowledge_path": "knowledge/ai/prompt-prefix-caching.md",
      "source_url": "https://developers.openai.com/api/docs/guides/prompt-caching"
    },
    {
      "classification": "근거 있는 확인",
      "location": "scripts/model-routing-eval.test.mjs:184-247, 251-354",
      "diff_evidence": {
        "path": "scripts/model-routing-eval.test.mjs",
        "removed_tokens": [],
        "added_tokens": ["mkdtemp(path.join(os.tmpdir(), 'provenance-test-'))", "await rm(provenanceRoot, { recursive: true, force: true });"]
      },
      "change_status": "introduced_by_diff",
      "basis": "diff가 새로 만드는 외부 상태(provenance 임시 트리, git fixture 저장소, 플러그인 트리 3개)는 실행마다 `mkdtemp`로 고유 경로에 생성되고 각 블록 끝에서 `rm`으로 제거되어 블록 간·실행 간 상태 누수로 인한 순서 의존이 없다. 모듈 수준 변수 재사용은 spread·재파싱 사본으로 원본을 바꾸지 않는다. 한계: `rm`이 성공 경로에만 있고 실패 시 정리(try/finally)는 없다.",
      "knowledge_path": "knowledge/qa/test-isolation.md",
      "source_url": "https://playwright.dev/docs/browser-contexts"
    },
    {
      "classification": "근거 있는 확인",
      "location": "docs/handoffs/remeasurement-readiness.md `## 6. 사전 등록`, codex-round1-verification-and-agreement.md `## 4. 합의안`, claude-code-quality-performance-opinion-request.md `## 비목표`",
      "diff_evidence": {
        "path": "docs/handoffs/remeasurement-readiness.md",
        "removed_tokens": [],
        "added_tokens": ["측정을 시작하기 전에 아래를 고정한다. 결과를 본 뒤에 바꾸지 않는다.", "승패를 선언하지 않고 **`판정 불가`로 종료**한다."]
      },
      "change_status": "introduced_by_diff",
      "basis": "인계 문서의 완료·수용 조건이 '구현했다'형이 아니라 측정값(과업별 커버리지, 키 1개 차이, FP 발생 run)과 종료 상태(판정 불가)로 사전 고정돼 있고, 기각 조건과 비목표('두 과업을 한 숫자로 합치지 않는다', '측정하지 않은 개선 수치 작성 금지')가 함께 명시돼 관찰 가능한 결과 기준을 충족한다. 기능 완료와 성과를 구분해 적었다.",
      "knowledge_path": "knowledge/product/user-story-slicing.md",
      "source_url": "https://www.gov.uk/service-manual/agile-delivery/writing-user-stories"
    }
  ],
  "knowledge_gaps": [
    "check-sources.yml이 의존성 설치 단계 없이 `npm run validate`를 실행하고 삭제된 workflow의 `npm ci --ignore-scripts`가 사라진 구성의 npm supply-chain 기준 — platform·security 담당 지식에 lockfile 설치·lifecycle script 차단 기준이 없어 판정하지 않았다.",
    "외부 URL 조회 결과(`scripts/check-sources.mjs` 출력)를 `$GITHUB_STEP_SUMMARY` Markdown에 그대로 기록하는 경로의 신뢰 경계 — 담당 지식은 컨텍스트 값 셸 보간과 secret 마스킹만 다루고, 스크립트 본문은 scoped diff 밖이다.",
    "node 평면 assert 스크립트(qa: 담당 지식이 Playwright 브라우저 격리 전제)와 변경 기록·인계 문서(product: 담당 지식이 백로그·수용 조건 범위 한정)에 적용할 기준 부재 — 두 역할 모두 일반 지식으로 메우지 않고 근거 없음으로 남겼다."
  ],
  "knowledge_selection": {
    "paths": [
      "knowledge/ai/codex-agent-operations.md",
      "knowledge/ai/prompt-prefix-caching.md",
      "knowledge/platform/actions-workflow-hardening.md",
      "knowledge/security/actions-secret-handling.md",
      "knowledge/security/github-actions-secrets.md",
      "knowledge/qa/test-isolation.md",
      "knowledge/product/user-story-slicing.md"
    ],
    "exception": null
  },
  "model_routes": [
    { "role": "ai", "mode": "inherit", "model": "inherited", "reasoning_effort": "inherited", "reason": "content+path: 에이전트 지시 파일·스킬·훅 추가 (.claude/settings.json, AGENTS.md, **/SKILL.md 매칭; akasha/agents/*.md는 내용 신호)", "risk_signals": ["git commit 뒤 셸 스크립트를 자동 실행하는 PostToolUse 훅 추가", "서브에이전트 도구 경계·spawn 계약 정의 추가"] },
    { "role": "platform", "mode": "inherit", "model": "inherited", "reasoning_effort": "inherited", "reason": "content+path: CI workflow 추가·삭제 (.github/** 매칭)", "risk_signals": ["CI workflow 2개 삭제·1개 추가로 토큰 권한 범위 변경"] },
    { "role": "security", "mode": "inherit", "model": "inherited", "reasoning_effort": "inherited", "reason": "content+path: CI 토큰 권한·supply-chain (.github/workflows/** 매칭)", "risk_signals": ["CI 토큰 권한 범위 변경", "새 workflow가 외부 URL을 조회하는 스크립트 실행"] },
    { "role": "qa", "mode": "inherit", "model": "inherited", "reasoning_effort": "inherited", "reason": "path-only: scripts/model-routing-eval.test.mjs (**/*.test.* 매칭)", "risk_signals": [] },
    { "role": "product", "mode": "inherit", "model": "inherited", "reasoning_effort": "inherited", "reason": "path-only: docs/** 18개 매칭 (변경 기록·인계 문서, 스펙 아님)", "risk_signals": [] }
  ],
  "fallbacks": []
}
```

## 고친 것

- `akasha/skills/akasha/SKILL.md`: `subagent_type`을 `akasha-<역할>` → `akasha:akasha-<역할>`로.
  설치본의 Agent 목록이 플러그인 접두사로 노출되고 두 세션 모두 모델이 알아서 맞췄지만 문서가
  틀려 있었다. `scripts/validate.mjs` 가드도 같이 바꿨다(접두사 없는 형태가 남아 있으면 실패).
- `scripts/inspect-akasha-session.mjs`: 실전 전사 → 하네스 record. 실측한 전사 형태에 맞춰
  스킬 본문을 모든 user 줄에서 찾고, `<task-notification>`을 user 줄·`queue-operation`·`queued_command`
  세 곳에서 모으고, 셸 변수(`$ROOT/…`)를 펼쳐 실재 판정을 하고, harness 접두어·펜스를 벗겨
  lenient 계약을 따로 센다. 이전 버전은 첫 user 줄만 봐서 루트를 못 찾고 실재 경로 19개를 전부
  `hallucinated_name`으로 오분류했다.
- `scripts/model-routing-eval.test.mjs`: 합성 전사로 루트 해석·실재 판정·복구 감지·알림 파싱·도구 경계
  지표를 고정.

## 다음

1. 위 표의 fixture 후보를 하네스에 넣고 A/B로 재본다 — 특히 700줄 이상 diff의 페이징과 harness 접두어.
2. 자식 읽기 예산 "3회"는 페이징을 세지 않는 정의로 바꾸거나, 부모가 scoped diff를 페이지 단위로
   나누도록 SKILL.md를 바꿔야 한다. 어느 쪽이든 fixture로 먼저 재현한 뒤 바꾼다.
3. 부모 종합 단계의 지식 재읽기 금지 vs 재검증 요구 — 사람이 정해야 한다.
