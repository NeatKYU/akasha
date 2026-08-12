import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  assertAllowlistedUrl,
  assertDate,
  assertRelativePath,
  assertSnapshot,
  assertSource,
  detectPromptInjection,
  detectRawHtmlPromptInjection,
  detectRawHtmlSecret,
  detectSecret,
  loadSources,
  resolveContained
} from './lib.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function validateManifest() {
  const manifest = JSON.parse(await readFile(resolveContained(ROOT, 'manifest.json'), 'utf8'));
  assert(manifest.schema_version === 1, 'manifest.schema_version must be 1');
  assert(
    ['bootstrap', 'approved-main'].includes(manifest.snapshot_status),
    'manifest.snapshot_status is invalid'
  );
  assert(manifest.trust === 'human-reviewed-main-only', 'manifest trust boundary is invalid');
  assertRelativePath(manifest.knowledge_index, 'manifest.knowledge_index');
  assert(
    manifest.knowledge_index === 'akasha/knowledge/INDEX.md',
    'manifest.knowledge_index must point to akasha/knowledge/INDEX.md'
  );
  await access(resolveContained(ROOT, manifest.knowledge_index));
  if (manifest.approved_report_date !== undefined) assertDate(manifest.approved_report_date);
  if (manifest.approved_commit !== null && manifest.approved_commit !== undefined) {
    assert(/^[a-f0-9]{40}$/.test(manifest.approved_commit), 'manifest.approved_commit is invalid');
  }
  if (manifest.unavailable_sources !== undefined) {
    assert(
      Array.isArray(manifest.unavailable_sources),
      'manifest.unavailable_sources must be an array'
    );
    for (const entry of manifest.unavailable_sources) {
      assert(
        entry && /^[a-z0-9-]+$/.test(entry.source_id),
        'manifest unavailable source id is invalid'
      );
      // 승인된 스냅샷은 secondary 출처만 누락할 수 있다. primary 누락은 승격 자체가 막혀야 한다.
      assert(
        entry.authority === 'secondary',
        `manifest unavailable source ${entry.source_id} must be secondary`
      );
      assert(
        !Object.hasOwn(manifest.source_hashes ?? {}, entry.source_id),
        `manifest unavailable source ${entry.source_id} must not carry a hash`
      );
    }
  }
  assert(
    manifest.source_hashes && typeof manifest.source_hashes === 'object' && !Array.isArray(manifest.source_hashes),
    'manifest.source_hashes must be an object'
  );
  for (const [sourceId, hashes] of Object.entries(manifest.source_hashes)) {
    assert(/^[a-z0-9-]+$/.test(sourceId), `manifest source id is invalid: ${sourceId}`);
    assert(/^[a-f0-9]{64}$/.test(hashes.content_sha256), `manifest content hash is invalid for ${sourceId}`);
    assert(/^[a-f0-9]{64}$/.test(hashes.snapshot_sha256), `manifest snapshot hash is invalid for ${sourceId}`);
  }
}

async function validateReports(sourcesById) {
  const reportsRoot = resolveContained(ROOT, 'reports');
  let dateEntries = [];
  try {
    dateEntries = await readdir(reportsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const dateEntry of dateEntries.filter((entry) => entry.isDirectory())) {
    assertDate(dateEntry.name);
    const dateRoot = resolveContained(reportsRoot, dateEntry.name);
    const collectionPath = resolveContained(dateRoot, '_collection.json');
    const collection = JSON.parse(await readFile(collectionPath, 'utf8'));
    assert(collection.schema_version === 1, `${dateEntry.name} collection schema_version must be 1`);
    assert(collection.date === dateEntry.name, `${dateEntry.name} collection date mismatch`);
    assert(collection.trust === 'quarantine-only', `${dateEntry.name} collection trust marker is invalid`);
    assert(Number.isInteger(collection.attempted) && collection.attempted >= 0, 'collection attempted is invalid');
    assert(Number.isInteger(collection.succeeded) && collection.succeeded >= 0, 'collection succeeded is invalid');
    assert(Array.isArray(collection.failures), 'collection failures must be an array');
    assert(
      collection.attempted === collection.succeeded + collection.failures.length,
      `${dateEntry.name} collection attempted/succeeded/failures mismatch`
    );
    let snapshotCount = 0;
    const roleEntries = await readdir(dateRoot, { withFileTypes: true });
    for (const roleEntry of roleEntries.filter((entry) => entry.isDirectory())) {
      assert(/^[a-z0-9-]+$/.test(roleEntry.name), `Invalid report role directory: ${roleEntry.name}`);
      const roleRoot = resolveContained(dateRoot, roleEntry.name);
      const files = await readdir(roleRoot);
      for (const file of files.filter((name) => name.endsWith('.json'))) {
        assert(/^[a-z0-9-]+\.json$/.test(file), `Invalid report filename: ${file}`);
        const snapshot = JSON.parse(
          await readFile(resolveContained(roleRoot, file), 'utf8')
        );
        assertSnapshot(snapshot);
        const source = sourcesById.get(snapshot.source_id);
        assert(source, `Unknown snapshot source ${snapshot.source_id}`);
        assert(snapshot.role === source.role, `Snapshot role mismatch for ${snapshot.source_id}`);
        assert(snapshot.source_url === source.url, `Snapshot URL mismatch for ${snapshot.source_id}`);
        if (snapshot.final_url !== undefined) assertAllowlistedUrl(snapshot.final_url, 'Snapshot final_url');
        assert(/^[a-f0-9]{64}$/.test(snapshot.content_sha256), 'Invalid snapshot SHA-256');
        assert(snapshot.trust === 'untrusted-external-data', 'Snapshot trust marker is missing');
        snapshotCount += 1;
      }
    }
    assert(
      snapshotCount === collection.succeeded,
      `${dateEntry.name} collection succeeded count does not match snapshots`
    );
  }
}

async function validateKnowledgeDocuments() {
  const knowledgeRoot = resolveContained(ROOT, 'akasha', 'knowledge');
  const indexPath = resolveContained(knowledgeRoot, 'INDEX.md');
  const indexText = await readFile(indexPath, 'utf8');
  const indexLinks = [...indexText.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => ({
    label: match[1],
    href: match[2]
  }));

  const seenIndexLabels = new Map();
  const seenIndexTargets = new Map();
  const indexTargets = new Set();

  for (const link of indexLinks) {
    assertRelativePath(link.href, `knowledge index link ${link.label}`);
    assert(!link.href.includes('#'), `knowledge index link must not include a fragment: ${link.href}`);
    const targetPath = resolveContained(knowledgeRoot, link.href);
    assert(targetPath.endsWith('.md'), `knowledge index link must target a Markdown file: ${link.href}`);
    await access(targetPath);

    const normalizedLabel = normalizeComparable(link.label);
    const duplicateLabel = seenIndexLabels.get(normalizedLabel);
    assert(
      !duplicateLabel,
      `Duplicate knowledge index label: ${duplicateLabel} and ${link.label}`
    );
    seenIndexLabels.set(normalizedLabel, link.label);

    const relativeTarget = normalizeRelativePath(path.relative(knowledgeRoot, targetPath));
    const duplicateTarget = seenIndexTargets.get(relativeTarget);
    assert(
      !duplicateTarget,
      `Duplicate knowledge index target: ${duplicateTarget} and ${link.href}`
    );
    seenIndexTargets.set(relativeTarget, link.href);
    indexTargets.add(relativeTarget);
  }

  const documents = await collectKnowledgeDocuments(knowledgeRoot);
  const seenHeadings = new Map();
  const documentPaths = new Set();

  for (const documentPath of documents) {
    const relativePath = normalizeRelativePath(path.relative(knowledgeRoot, documentPath));
    documentPaths.add(relativePath);
    const text = await readFile(documentPath, 'utf8');
    const heading = text.split(/\r?\n/).find((line) => line.startsWith('# '))?.slice(2).trim();
    assert(heading, `Knowledge document must have an H1 heading: akasha/knowledge/${relativePath}`);

    const normalizedHeading = normalizeComparable(heading);
    const duplicateHeading = seenHeadings.get(normalizedHeading);
    assert(
      !duplicateHeading,
      `Duplicate knowledge document H1: ${duplicateHeading} and akasha/knowledge/${relativePath}`
    );
    seenHeadings.set(normalizedHeading, `akasha/knowledge/${relativePath}`);

    assert(
      indexTargets.has(relativePath),
      `Knowledge document is not listed in akasha/knowledge/INDEX.md: akasha/knowledge/${relativePath}`
    );
  }

  for (const indexTarget of indexTargets) {
    assert(
      documentPaths.has(indexTarget),
      `akasha/knowledge/INDEX.md points outside approved knowledge documents: ${indexTarget}`
    );
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
  assert(
    detectRawHtmlPromptInjection(malicious.body) !== null,
    'Malicious raw HTML prompt-injection fixture was not rejected'
  );
  assert(
    detectRawHtmlPromptInjection('window.__data = { tool_call: "documented API field" };') === null,
    'Benign raw HTML tool_call fixture was rejected'
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

  const oversizedSnapshot = JSON.parse(
    await readFile(resolveContained(ROOT, 'fixtures', 'oversized-snapshot.json'), 'utf8')
  );
  rejected = false;
  try {
    assertSnapshot(oversizedSnapshot);
  } catch {
    rejected = true;
  }
  assert(rejected, 'Oversized snapshot fixture was not rejected');

  const pathTraversalManifest = JSON.parse(
    await readFile(resolveContained(ROOT, 'fixtures', 'path-traversal-manifest.json'), 'utf8')
  );
  rejected = false;
  try {
    assertRelativePath(pathTraversalManifest.knowledge_index, 'fixture.knowledge_index');
  } catch {
    rejected = true;
  }
  assert(rejected, 'Path traversal fixture was not rejected');

  const promptInjectionSnapshot = JSON.parse(
    await readFile(resolveContained(ROOT, 'fixtures', 'prompt-injection-snapshot.json'), 'utf8')
  );
  rejected = false;
  try {
    assertSnapshot(promptInjectionSnapshot);
  } catch {
    rejected = true;
  }
  assert(rejected, 'Prompt-injection snapshot fixture was not rejected');

  const secretPayloadParts = JSON.parse(
    await readFile(resolveContained(ROOT, 'fixtures', 'secret-payload-parts.json'), 'utf8')
  );
  const secretFixture = secretPayloadParts.parts.join('');
  assert(detectSecret(secretFixture) !== null, 'Secret fixture was not detected');
  assert(
    detectRawHtmlSecret('Gov.uk generated class sk-example-token-shaped-text') === null,
    'Benign raw HTML sk-* fixture was rejected'
  );
}

async function validateRepoSecretScan() {
  const candidateFiles = await collectFiles(ROOT);
  for (const file of candidateFiles) {
    const text = await readFile(file, 'utf8');
    const pattern = detectSecret(text);
    assert(pattern === null, `Secret-like payload detected in ${path.relative(ROOT, file)}: ${pattern}`);
  }
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const resolved = resolveContained(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(resolved)));
    } else if (/\.(json|md|mjs|ya?ml)$/.test(entry.name)) {
      files.push(resolved);
    }
  }
  return files;
}

async function collectKnowledgeDocuments(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolved = resolveContained(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectKnowledgeDocuments(resolved)));
    } else if (entry.name.endsWith('.md') && path.basename(resolved) !== 'INDEX.md') {
      files.push(resolved);
    }
  }
  return files.sort();
}

function normalizeComparable(value) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

const sources = await loadSources();
await validateManifest();
await validateKnowledgeDocuments();
await validateReports(new Map(sources.map((source) => [source.id, source])));
await validateRepoSecretScan();
if (process.argv.includes('--fixtures')) await validateFixtures();

console.log(`Validated ${sources.length} allowlisted sources and the knowledge manifest.`);
