import { readdir, readFile, writeFile } from 'node:fs/promises';
import { ROOT, assertDate, assertSnapshot, loadSources, resolveContained, sha256 } from './lib.mjs';

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

// primary 출처는 규범적 결론의 근거이므로 한 건이라도 실패하면 승격을 막는다. secondary 출처는
// 영감·사례 용도라 한 곳의 장애가 주간 승격 전체를 영구히 막지 않도록 기록만 남기고 통과시킨다.
// catalog에 없는 source_id는 판단 근거가 없으므로 차단 쪽으로 처리한다.
const blockingFailures = collection.failures.filter(
  (failure) => authorityById.get(failure.source_id) !== 'secondary'
);
if (blockingFailures.length > 0) {
  throw new Error(
    `Cannot promote ${reportDate}: ${blockingFailures.length} primary source fetches failed.`
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
