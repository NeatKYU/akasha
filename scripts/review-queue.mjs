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
    const hash = current[id]?.content_sha256;
    const url = sources.get(id)?.url ?? '';
    if (!hash) queue.push({ doc: relative, kind: '승인 해시 없음', detail: id, url });
    else if (!pins.has(id)) queue.push({ doc: relative, kind: '고정 없음', detail: id, url });
    else if (!hash.startsWith(pins.get(id))) {
      queue.push({ doc: relative, kind: '출처 변경', detail: `${id}  ${pins.get(id)} → ${hash.slice(0, 12)}`, url });
    }
  }
}

if (queue.length === 0) {
  console.log('재검토 큐가 비어 있습니다. 모든 지식 문서가 승인 스냅샷에 고정되어 있습니다.');
} else {
  console.log(`재검토 필요 ${queue.length}건\n`);
  for (const item of queue) {
    console.log(`  [${item.kind}] akasha/knowledge/${item.doc}`);
    console.log(`      ${item.detail}${item.url ? `\n      ${item.url}` : ''}`);
  }
  console.log('\n출처 변경 항목은 원문을 다시 읽고 요약이 여전히 맞는지 확인한 뒤,');
  console.log('`- 검토 스냅샷: `<id>@<새 해시 12자>`` 로 고정을 갱신합니다.');
}
