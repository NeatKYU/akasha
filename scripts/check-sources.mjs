// 지식 문서가 인용한 원본이 바뀌었는지 확인한다.
// 지식 문서의 `## 출처` 절이 단일 진실 원천이며, 이 스크립트는 아무 파일도 쓰지 않는다.
// 원본을 가져와 해시만 비교하고, 사람이 재검토할 목록을 출력한다.
import {
  detectRawHtmlPromptInjection,
  detectRawHtmlSecret,
  extractMetadata,
  fetchAllowlistedHtml,
  loadKnowledgeSources,
  sha256
} from './lib.mjs';

const wantsJson = process.argv.includes('--json');
const docs = await loadKnowledgeSources();

const structureChanged = [];
const bodyChanged = [];
const unpinned = [];
const unreachable = [];
let checked = 0;

for (const doc of docs) {
  for (const source of doc.sources.values()) {
    checked += 1;
    if (!source.pin) {
      unpinned.push({ doc: doc.path, id: source.id, url: source.url });
      continue;
    }
    try {
      const result = await fetchAllowlistedHtml(source.url);
      const html = result.html;
      const injection = detectRawHtmlPromptInjection(html);
      const secret = detectRawHtmlSecret(html);
      const metadata = extractMetadata(html);
      const structure = sha256(
        JSON.stringify({
          title: metadata.title,
          description: metadata.description.slice(0, 800),
          headings: metadata.headings
        })
      );
      const body = sha256(metadata.normalizedText);
      const entry = { doc: doc.path, id: source.id, url: source.url, injection, secret };

      if (!structure.startsWith(source.pin.structure)) {
        structureChanged.push({ ...entry, from: source.pin.structure, to: structure.slice(0, 12), bodyTo: body.slice(0, 12) });
      } else if (!body.startsWith(source.pin.body)) {
        bodyChanged.push({ ...entry, from: source.pin.body, to: body.slice(0, 12), structureTo: structure.slice(0, 12) });
      }
    } catch (error) {
      unreachable.push({ doc: doc.path, id: source.id, url: source.url, error: String(error.message) });
    }
  }
}

if (wantsJson) {
  console.log(JSON.stringify({ checked, structureChanged, bodyChanged, unpinned, unreachable }, null, 2));
} else {
  const show = (title, items, note, render) => {
    if (items.length === 0) return;
    console.log(`\n${title} ${items.length}건`);
    for (const item of items) console.log(render(item));
    if (note) console.log(`  → ${note}`);
  };
  console.log(`출처 ${checked}건 확인 (지식 문서 ${docs.length}개)`);
  show('재검토 필수 — 구조 변경', structureChanged,
    '제목·설명·헤딩이 바뀌었습니다. 다루는 범위가 달라졌을 수 있으니 원문을 다시 읽으세요.',
    (i) => `  ${i.doc}\n    ${i.id}  구조 ${i.from} → ${i.to}\n    ${i.url}\n    갱신: - 검토 스냅샷: \`${i.id}\` 구조 \`${i.to}\` 본문 \`${i.bodyTo}\``);
  show('확인 권장 — 본문 변경', bodyChanged,
    '헤딩은 그대로이고 본문만 바뀌었습니다. 표현 수정일 가능성이 높습니다.',
    (i) => `  ${i.doc}\n    ${i.id}  본문 ${i.from} → ${i.to}\n    갱신: - 검토 스냅샷: \`${i.id}\` 구조 \`${i.structureTo}\` 본문 \`${i.to}\``);
  show('고정 없음', unpinned, '검토 스냅샷이 없어 변경을 감지할 수 없습니다.',
    (i) => `  ${i.doc}\n    ${i.id}  ${i.url}`);
  show('가져오지 못함', unreachable, '원본이 사라졌거나 응답이 제한을 넘었습니다.',
    (i) => `  ${i.doc}\n    ${i.id}  ${i.error}`);

  const flagged = [...structureChanged, ...bodyChanged].filter((i) => i.injection || i.secret);
  if (flagged.length > 0) {
    console.log(`\n주의: 원본에서 위험 패턴 감지 ${flagged.length}건`);
    for (const i of flagged) console.log(`  ${i.id}: ${i.injection ?? ''} ${i.secret ?? ''}`.trimEnd());
  }
  if (structureChanged.length + bodyChanged.length + unpinned.length + unreachable.length === 0) {
    console.log('\n모든 출처가 검토 시점과 같습니다.');
  }
}
