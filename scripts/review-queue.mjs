// 재검토가 필요한 지식 문서만 뽑아 보여준다. validate가 CI에서 막는 것과 같은 판정이며,
// 이쪽은 사람이 "이번 주에 무엇을 검토해야 하나"를 확인하는 용도다.
import { readFile } from 'node:fs/promises';
import { ROOT, loadSources, parseKnowledgeSources, resolveContained } from './lib.mjs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const manifest = JSON.parse(await readFile(resolveContained(ROOT, 'manifest.json'), 'utf8'));
const current = manifest.source_hashes ?? {};
const unavailable = new Set((manifest.unavailable_sources ?? []).map((entry) => entry.source_id));
const sources = new Map((await loadSources()).map((source) => [source.id, source]));

const knowledgeRoot = resolveContained(ROOT, 'akasha', 'knowledge');
const queue = [];
const soft = [];
for (const entry of await readdir(knowledgeRoot, { withFileTypes: true, recursive: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'INDEX.md') continue;
  const full = path.join(entry.parentPath ?? entry.path, entry.name);
  const relative = path.relative(knowledgeRoot, full).split(path.sep).join('/');
  const { ids, pins, hasSourceSection } = parseKnowledgeSources(await readFile(full, 'utf8'));

  if (!hasSourceSection) {
    queue.push({ doc: relative, kind: '출처 절 없음', detail: '검토 시점을 고정할 수 없다', url: '' });
    continue;
  }
  for (const id of ids) {
    if (unavailable.has(id)) continue;
    const entry = current[id];
    const url = sources.get(id)?.url ?? '';
    if (!entry) { queue.push({ doc: relative, kind: '승인 해시 없음', detail: id, url }); continue; }
    const pin = pins.get(id);
    if (!pin) { queue.push({ doc: relative, kind: '고정 없음', detail: id, url }); continue; }
    if (!entry.metadata_sha256.startsWith(pin.structure)) {
      queue.push({ doc: relative, kind: '구조 변경', detail: `${id}  ${pin.structure} → ${entry.metadata_sha256.slice(0, 12)}`, url });
    } else if (!entry.content_sha256.startsWith(pin.body)) {
      soft.push({ doc: relative, kind: '본문 변경', detail: `${id}  ${pin.body} → ${entry.content_sha256.slice(0, 12)}`, url });
    }
  }
}

function render(title, items, note) {
  if (items.length === 0) return;
  console.log(`\n${title} ${items.length}건`);
  for (const item of items) {
    console.log(`  [${item.kind}] akasha/knowledge/${item.doc}`);
    console.log(`      ${item.detail}${item.url ? `\n      ${item.url}` : ''}`);
  }
  if (note) console.log(`  → ${note}`);
}

if (queue.length === 0 && soft.length === 0) {
  console.log('재검토 큐가 비어 있습니다. 모든 지식 문서가 승인 스냅샷에 고정되어 있습니다.');
} else {
  render('재검토 필수', queue, '출처의 제목·설명·헤딩이 바뀌었습니다. 다루는 범위가 달라졌을 수 있으니 원문을 다시 읽으세요.');
  render('확인 권장', soft, '헤딩은 그대로이고 본문만 바뀌었습니다. 표현 수정일 가능성이 높습니다.');
  console.log('\n확인 후 고정을 갱신합니다:');
  console.log('  - 검토 스냅샷: `<id>` 구조 `<metadata 12자>` 본문 `<content 12자>`');
}
