import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  assertSource,
  detectPromptInjection,
  loadSources
} from './lib.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function validateManifest() {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert(manifest.schema_version === 1, 'manifest.schema_version must be 1');
  assert(
    ['bootstrap', 'approved-main'].includes(manifest.snapshot_status),
    'manifest.snapshot_status is invalid'
  );
  assert(manifest.trust === 'human-reviewed-main-only', 'manifest trust boundary is invalid');
  await access(path.join(ROOT, manifest.knowledge_index));
}

async function validateReports(sourcesById) {
  const reportsRoot = path.join(ROOT, 'reports');
  let dateEntries = [];
  try {
    dateEntries = await readdir(reportsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const dateEntry of dateEntries.filter((entry) => entry.isDirectory())) {
    const dateRoot = path.join(reportsRoot, dateEntry.name);
    const roleEntries = await readdir(dateRoot, { withFileTypes: true });
    for (const roleEntry of roleEntries.filter((entry) => entry.isDirectory())) {
      const files = await readdir(path.join(dateRoot, roleEntry.name));
      for (const file of files.filter((name) => name.endsWith('.json'))) {
        const snapshot = JSON.parse(
          await readFile(path.join(dateRoot, roleEntry.name, file), 'utf8')
        );
        const source = sourcesById.get(snapshot.source_id);
        assert(source, `Unknown snapshot source ${snapshot.source_id}`);
        assert(snapshot.role === source.role, `Snapshot role mismatch for ${snapshot.source_id}`);
        assert(snapshot.source_url === source.url, `Snapshot URL mismatch for ${snapshot.source_id}`);
        assert(/^[a-f0-9]{64}$/.test(snapshot.content_sha256), 'Invalid snapshot SHA-256');
        assert(snapshot.trust === 'untrusted-external-data', 'Snapshot trust marker is missing');
        assert(
          detectPromptInjection(JSON.stringify(snapshot)) === null,
          `Snapshot ${snapshot.source_id} contains an instruction-like payload`
        );
      }
    }
  }
}

async function validateFixtures() {
  const malicious = JSON.parse(
    await readFile(path.join(ROOT, 'fixtures', 'malicious-source.json'), 'utf8')
  );
  assert(
    detectPromptInjection(malicious.body) !== null,
    'Malicious prompt-injection fixture was not rejected'
  );

  const invalid = JSON.parse(
    await readFile(path.join(ROOT, 'fixtures', 'invalid-source.json'), 'utf8')
  );
  let rejected = false;
  try {
    assertSource(invalid, 'security');
  } catch {
    rejected = true;
  }
  assert(rejected, 'Non-HTTPS source fixture was not rejected');
}

const sources = await loadSources();
await validateManifest();
await validateReports(new Map(sources.map((source) => [source.id, source])));
if (process.argv.includes('--fixtures')) await validateFixtures();

console.log(`Validated ${sources.length} allowlisted sources and the knowledge manifest.`);
