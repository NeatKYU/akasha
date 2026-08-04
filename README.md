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
- `prepare-weekly-promotion.yml`: 최신 격리 결과로 사람이 PR을 열 수 있는 주간 승격 브랜치 생성
- `tag-approved-snapshot.yml`: 저장소 소유자가 `workflow_dispatch`로 promotion PR 번호와 merge
  commit SHA를 입력했을 때만 불변 `kb-*` annotated tag 생성

저장소의 기본 Actions 권한은 read-only로 운영하고, 쓰기가 필요한 workflow만 파일 단위
`permissions`로 `contents: write`를 요청합니다. Actions의 PR 생성·승인 권한은 비활성화되어
있으므로 workflow는 브랜치와 job summary만 만들고, 저장소 소유자가 promotion PR을 직접 열어
검토·병합합니다. 자동화 토큰은 main에 직접 커밋하지 않습니다.
태그 생성은 push trigger가 아니라 수동 owner-gated workflow이며, actor가 `NeatKYU`인지,
promotion PR이 main에 병합되었는지, 입력한 merge SHA가 PR의 merge commit인지, `NeatKYU`의
approving review가 있는지 확인한 뒤 annotated tag만 생성합니다.

현재 환경에는 Git cryptographic signing key가 없으므로 `kb-*` 태그는 GPG/Sigstore로 서명된
태그가 아닙니다. provenance는 promotion PR 번호, merge SHA, approving reviewer를 tag message와
manifest 검증으로 남기는 수준입니다.

현재 private 저장소 플랜에서는 GitHub ruleset의 required review를 강제할 수 없습니다. 따라서
workflow에는 자동 병합 권한을 주지 않고 CODEOWNERS와 수동 병합을 운영 경계로 사용합니다.
향후 GitHub Pro 이상으로 전환하면 main ruleset에 code-owner 승인 1명을 필수로 설정합니다.
