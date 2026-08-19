#!/usr/bin/env bash
# git commit 직후에 변경 기록을 요구하는 PostToolUse 훅.
# 표준 출력으로 additionalContext JSON을 내보내 모델에게 작업을 지시한다.
# 훅 자체는 아무것도 쓰지 않는다 — 기록은 모델이 explain-diff-html로 만든다.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$root" ] && [ -d "$root/.git" ] || exit 0
cd "$root" || exit 0

sha=$(git rev-parse --short HEAD 2>/dev/null) || exit 0
subject=$(git log -1 --pretty=%s 2>/dev/null) || exit 0
files=$(git show --name-only --pretty=format: --first-parent -m HEAD 2>/dev/null | sed '/^$/d' | sort -u)
[ -n "$files" ] || exit 0

# 루프 방지: 기록 자체만 담은 커밋에는 다시 기록을 요구하지 않는다.
if ! printf '%s\n' "$files" | grep -qv '^docs/changes/'; then exit 0; fi

python3 - "$sha" "$subject" <<'PY'
import json, sys
sha, subject = sys.argv[1], sys.argv[2]
context = f"""커밋 {sha} ("{subject}")이 방금 생성됐다. 이 프로젝트는 커밋마다 이전과 무엇이
달라졌는지를 같은 지표로 재서 누적 기록한다. 지금 다음을 수행하라.

1. `explain-diff-html` 스킬을 이 커밋({sha})을 대상으로 실행해 변경 설명을 만든다.
2. `docs/changes/<버전>-<슬러그>.md`에 **짧은** 기록을 남긴다. 이전에는 어땠고 이후에는
   어떻게 되는지를 대비시키고, 아래 지표 중 이 변경이 실제로 움직인 것만 전/후 숫자로 적는다.
   - always-on / on-invoke 토큰: `claude plugin details akasha@neatkyu`
   - 부모 라우팅 읽기량, packet 반복 전달 bytes
   - 강제 수단이 프롬프트에서 도구 경계·검사로 바뀌었는지
3. `docs/changes/INDEX.md`의 표에 한 줄 추가한다.
4. 개선만 적지 말 것. 나빠진 지표가 있으면 그대로 적고 대가라고 밝힌다. 재지 않은 값은
   추정치로 채우지 말고 "측정 안 함"으로 남긴다.
5. 기록을 `docs/changes/`만 담은 별도 커밋으로 남긴다(이 훅은 그 커밋에는 다시 걸리지 않는다).

기존 항목 형식은 docs/changes/0.5.0-agents-consolidation.md를 따른다."""
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": context,
    }
}, ensure_ascii=False))
PY
