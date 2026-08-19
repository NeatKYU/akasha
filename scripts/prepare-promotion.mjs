import { readdir, readFile, writeFile } from 'node:fs/promises';
import {
  ROOT,
  assertDate,
  assertSnapshot,
  loadSources,
  parseKnowledgeSources,
  resolveContained,
  sha256
} from './lib.mjs';

const reportsRoot = resolveContained(ROOT, 'reports');
const dates = (await readdir(reportsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => {
    assertDate(name);
    return true;
  })
  .sort();

if (dates.length === 0) throw new Error('No quarantine report is available for promotion.');
const reportDate = dates.at(-1);
const reportRoot = resolveContained(reportsRoot, reportDate);
const collection = JSON.parse(await readFile(resolveContained(reportRoot, '_collection.json'), 'utf8'));
const enabledSources = (await loadSources()).filter((source) => source.enabled);
const expectedSources = enabledSources.length;
const authorityById = new Map(enabledSources.map((source) => [source.id, source.authority]));
if (!collection.complete || collection.attempted !== expectedSources) {
  throw new Error(
    `Cannot promote ${reportDate}: report covers ${collection.attempted}/${expectedSources} sources.`
  );
}

// 승인된 지식 문서가 실제로 인용하는 출처만 승격을 막는다. 카탈로그에 등록만 되고 아직
// 요약된 문서가 없는 출처는 의존하는 판정이 없으므로, 그 실패가 주간 승격 전체를 막지 않는다.
// 출처가 늘수록 "하나라도 실패하면 전부 중단"은 승격을 사실상 불가능하게 만든다.
const citedSourceIds = new Set();
const knowledgeRoot = resolveContained(ROOT, 'akasha', 'knowledge');
for (const entry of await readdir(knowledgeRoot, { withFileTypes: true, recursive: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'INDEX.md') continue;
  const text = await readFile(resolveContained(entry.parentPath ?? entry.path, entry.name), 'utf8');
  for (const id of parseKnowledgeSources(text).ids) citedSourceIds.add(id);
}

// secondary는 영감·사례 용도라 한 곳의 장애가 승격을 영구히 막지 않도록 기록만 남긴다.
// catalog에 없는 source_id는 판단 근거가 없으므로 차단 쪽으로 처리한다.
const blockingFailures = collection.failures.filter((failure) => {
  const authority = authorityById.get(failure.source_id);
  if (authority === 'secondary') return false;
  if (authority === undefined) return true;
  return citedSourceIds.has(failure.source_id);
});
if (blockingFailures.length > 0) {
  const ids = blockingFailures.map((failure) => failure.source_id).join(', ');
  throw new Error(
    `Cannot promote ${reportDate}: ${blockingFailures.length} primary source(s) cited by approved knowledge failed: ${ids}`
  );
}
const uncitedFailures = collection.failures.filter(
  (failure) => authorityById.get(failure.source_id) === 'primary' && !citedSourceIds.has(failure.source_id)
);
if (uncitedFailures.length > 0) {
  console.warn(
    `${uncitedFailures.length} primary source(s) failed but are not cited by any knowledge document yet; ` +
      'promotion continues and they stay recorded as unavailable.'
  );
}
// blockingFailures 검사를 통과했으므로 남은 실패는 모두 secondary 출처다.
const unavailableSources = collection.failures.map((failure) => ({
  source_id: failure.source_id,
  authority: authorityById.get(failure.source_id)
}));

const sourceHashes = {};
for (const roleEntry of await readdir(reportRoot, { withFileTypes: true })) {
  if (!roleEntry.isDirectory()) continue;
  if (!/^[a-z0-9-]+$/.test(roleEntry.name)) throw new Error(`Invalid report role: ${roleEntry.name}`);
  const roleRoot = resolveContained(reportRoot, roleEntry.name);
  for (const file of (await readdir(roleRoot)).filter((name) => name.endsWith('.json'))) {
    if (!/^[a-z0-9-]+\.json$/.test(file)) throw new Error(`Invalid snapshot filename: ${file}`);
    const snapshotText = await readFile(resolveContained(roleRoot, file), 'utf8');
    const snapshot = JSON.parse(snapshotText);
    assertSnapshot(snapshot);
    sourceHashes[snapshot.source_id] = {
      content_sha256: snapshot.content_sha256,
      metadata_sha256: snapshot.metadata_sha256,
      snapshot_sha256: sha256(snapshotText),
      retrieved_at: snapshot.retrieved_at
    };
  }
}

const manifest = {
  schema_version: 1,
  snapshot_status: 'approved-main',
  approved_report_date: reportDate,
  approved_at: new Date().toISOString(),
  approved_commit: null,
  trust: 'human-reviewed-main-only',
  knowledge_index: 'akasha/knowledge/INDEX.md',
  unavailable_sources: unavailableSources,
  source_hashes: sourceHashes
};
await writeFile(resolveContained(ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared ${reportDate} for human-reviewed promotion.`);
