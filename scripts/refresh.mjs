import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  detectPromptInjection,
  extractMetadata,
  loadSources,
  sha256
} from './lib.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const date = argument('--date') ?? new Date().toISOString().slice(0, 10);
const limit = Number(argument('--limit') ?? Number.POSITIVE_INFINITY);
const enabledSources = (await loadSources()).filter((source) => source.enabled);
const sources = enabledSources.slice(0, limit);
const failures = [];

for (const source of sources) {
  try {
    const response = await fetch(source.url, {
      headers: {
        'user-agent': 'NeatKYU-agent-knowledge-refresh/1.0 (+https://github.com/NeatKYU/agent-knowledge-base)'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const injectionPattern = detectPromptInjection(html);
    if (injectionPattern) {
      throw new Error(`prompt-injection pattern detected: ${injectionPattern}`);
    }

    const metadata = extractMetadata(html);
    const snapshot = {
      source_id: source.id,
      role: source.role,
      source_url: source.url,
      authority: source.authority,
      retrieved_at: new Date().toISOString(),
      content_sha256: sha256(metadata.normalizedText),
      http_status: response.status,
      title: metadata.title || source.title,
      description: metadata.description.slice(0, 800),
      headings: metadata.headings,
      trust: 'untrusted-external-data'
    };
    const outputDir = path.join(ROOT, 'reports', date, source.role);
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      path.join(outputDir, `${source.id}.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`
    );
  } catch (error) {
    failures.push({ source_id: source.id, url: source.url, error: String(error.message) });
  }
}

const reportRoot = path.join(ROOT, 'reports', date);
await mkdir(reportRoot, { recursive: true });
await writeFile(
  path.join(reportRoot, '_collection.json'),
  `${JSON.stringify(
    {
      schema_version: 1,
      date,
      attempted: sources.length,
      expected: enabledSources.length,
      complete: sources.length === enabledSources.length,
      succeeded: sources.length - failures.length,
      failures,
      trust: 'quarantine-only'
    },
    null,
    2
  )}\n`
);

console.log(`Refreshed ${sources.length - failures.length}/${sources.length} sources for ${date}.`);
if (failures.length > 0) console.warn(`${failures.length} source(s) remain quarantined as failures.`);
