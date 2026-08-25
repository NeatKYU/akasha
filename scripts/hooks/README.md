# 커밋 훅

## post-commit-record.sh

`git commit` 직후에 실행되며, **이번 커밋이 이전과 무엇을 다르게 만들었는지**를
`docs/changes/`에 기록하도록 요구합니다.

`.claude/settings.json`의 `PostToolUse` 훅(`if: "Bash(git commit:*)"`)이 이 스크립트를 부릅니다.

### 하는 일

스크립트 자체는 **아무 파일도 쓰지 않습니다.** 방금 만들어진 커밋의 SHA와 제목을 읽어
`hookSpecificOutput.additionalContext` JSON을 표준 출력으로 내보내고, 기록은 모델이
`explain-diff-html` 스킬로 만듭니다.

### 언제 조용한가

- `docs/changes/` **만** 담은 커밋 — 기록을 남긴 커밋에 다시 기록을 요구하면 무한 루프가 됩니다
- git 저장소 밖
- 파일 목록을 얻을 수 없는 커밋

머지 커밋에서도 동작합니다(`--first-parent -m`).

### 직접 시험

```bash
CLAUDE_PROJECT_DIR="$PWD" ./scripts/hooks/post-commit-record.sh </dev/null | jq .
```

출력이 비어 있으면 위 "조용한" 조건 중 하나에 해당합니다. `echo "$out" | jq`로 확인하지 마세요 —
zsh의 `echo`가 `\n`을 해석해 JSON을 깨뜨립니다.

### 기록 형식

`docs/changes/INDEX.md`가 누적 표이고, 항목마다 `docs/changes/<버전>-<슬러그>.md`가 붙습니다.
형식은 `docs/changes/0.5.0-agents-consolidation.md`를 따릅니다. 개선만 적지 않고 나빠진 지표도
그대로 남기며, 재지 않은 값은 추정치로 채우지 않습니다.
