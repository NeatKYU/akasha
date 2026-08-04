import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadSources, sha256 } from './lib.mjs';

const reportsRoot = path.join(ROOT, 'reports');
const dates = (await readdir(reportsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (dates.length === 0) throw new Error('No quarantine report is available for promotion.');
const reportDate = dates.at(-1);
const reportRoot = path.join(reportsRoot, reportDate);
const collection = JSON.parse(await readFile(path.join(reportRoot, '_collection.json'), 'utf8'));
const expectedSources = (await loadSources()).filter((source) => source.enabled).length;
if (!collection.complete || collection.attempted !== expectedSources) {
  throw new Error(
    `Cannot promote ${reportDate}: report covers ${collection.attempted}/${expectedSources} sources.`
  );
}
if (collection.failures.length > 0) {
  throw new Error(`Cannot promote ${reportDate}: ${collection.failures.length} source fetches failed.`);
}

const sourceHashes = {};
for (const roleEntry of await readdir(reportRoot, { withFileTypes: true })) {
  if (!roleEntry.isDirectory()) continue;
  const roleRoot = path.join(reportRoot, roleEntry.name);
  for (const file of (await readdir(roleRoot)).filter((name) => name.endsWith('.json'))) {
    const snapshotText = await readFile(path.join(roleRoot, file), 'utf8');
    const snapshot = JSON.parse(snapshotText);
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
  knowledge_index: 'knowledge/INDEX.md',
  source_hashes: sourceHashes
};
await writeFile(path.join(ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared ${reportDate} for human-reviewed promotion.`);
