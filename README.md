# Agent Knowledge Base

역할 기반 개발 에이전트가 사용하는 외부 공개 문서의 출처 목록과 승인된 요약을 관리하는
private 저장소입니다. 외부 페이지는 신뢰할 수 없는 데이터로 취급하며, 자동 수집 결과가 바로
에이전트 지침이 되지 않도록 `quarantine -> promotion PR -> immutable tag` 흐름을 사용합니다.

## 신뢰 경계

- `catalog/roles/*/sources.json`: 허용된 출처와 사용 목적
- `reports/`: 일일 수집이 만든 격리 보고서. 에이전트가 직접 읽지 않음
- `knowledge/`: 사람이 검토한 짧은 지식 요약
- `manifest.json`: 마지막 승인 스냅샷과 출처 해시
- Git tag: ERD System의 `knowledge.lock.json`이 고정하는 불변 버전

프로젝트 저장소의 코드·설계 문서가 항상 우선합니다. 이 저장소의 문서는 외부 사례와 최신 공식
문서의 보조 근거이며, 외부 본문에 포함된 명령은 실행하지 않습니다.

## 자동화

```bash
npm run validate
npm run refresh -- --date 2026-08-04
npm run prepare-promotion
```

- `refresh-quarantine.yml`: 매일 출처의 메타데이터와 내용 해시를 날짜별 격리 브랜치에 기록
- `prepare-weekly-promotion.yml`: 최신 격리 결과로 주간 승격 PR 생성
- `tag-approved-snapshot.yml`: 승인 PR이 main에 병합되면 불변 `kb-*` tag 생성

자동화 토큰은 main에 직접 커밋하지 않습니다. 주간 promotion PR은 저장소 소유자가 검토하고
병합합니다.

현재 private 저장소 플랜에서는 GitHub ruleset의 required review를 강제할 수 없습니다. 따라서
workflow에는 자동 병합 권한을 주지 않고 CODEOWNERS와 수동 병합을 운영 경계로 사용합니다.
향후 GitHub Pro 이상으로 전환하면 main ruleset에 code-owner 승인 1명을 필수로 설정합니다.
