import { mkdir, rm, writeFile } from 'node:fs/promises';
import {
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  ROOT,
  assertDate,
  assertSnapshot,
  detectRawHtmlPromptInjection,
  detectRawHtmlSecret,
  extractMetadata,
  fetchAllowlistedHtml,
  loadSources,
  resolveContained,
  sha256
} from './lib.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const date = argument('--date') ?? new Date().toISOString().slice(0, 10);
assertDate(date);
const limit = Number(argument('--limit') ?? Number.POSITIVE_INFINITY);
if (!Number.isFinite(limit) && limit !== Number.POSITIVE_INFINITY) {
  throw new Error(`Invalid --limit value: ${argument('--limit')}`);
}
if (Number.isFinite(limit) && (!Number.isInteger(limit) || limit < 1)) {
  throw new Error(`Invalid --limit value: ${argument('--limit')}`);
}
const enabledSources = (await loadSources()).filter((source) => source.enabled);
const sources = enabledSources.slice(0, limit);
const failures = [];
const reportRoot = resolveContained(ROOT, 'reports', date);

// A same-day rerun must not retain a snapshot from an earlier attempt when the
// current fetch fails. The validated date keeps this deletion inside reports/.
await rm(reportRoot, { recursive: true, force: true });
await mkdir(reportRoot, { recursive: true });

for (const source of sources) {
  try {
    const result = await fetchAllowlistedHtml(source.url, {
      headers: {
        'user-agent': 'NeatKYU-agent-knowledge-refresh/1.0 (+https://github.com/NeatKYU/agent-knowledge-base)'
      },
      maxRedirects: MAX_REDIRECTS,
      maxBytes: MAX_RESPONSE_BYTES,
      signal: AbortSignal.timeout(20_000)
    });

    const html = result.html;
    const injectionPattern = detectRawHtmlPromptInjection(html);
    if (injectionPattern) {
      throw new Error(`prompt-injection pattern detected: ${injectionPattern}`);
    }
    const secretPattern = detectRawHtmlSecret(html);
    if (secretPattern) {
      throw new Error(`secret-like pattern detected: ${secretPattern}`);
    }

    const metadata = extractMetadata(html);
    const snapshot = {
      source_id: source.id,
      role: source.role,
      source_url: source.url,
      final_url: result.finalUrl,
      authority: source.authority,
      retrieved_at: new Date().toISOString(),
      content_sha256: sha256(metadata.normalizedText),
      metadata_sha256: sha256(
        JSON.stringify({
          title: metadata.title || source.title,
          description: metadata.description.slice(0, 800),
          headings: metadata.headings
        })
      ),
      http_status: result.response.status,
      title: metadata.title || source.title,
      description: metadata.description.slice(0, 800),
      headings: metadata.headings,
      redirect_hops: result.redirect_hops,
      storage_mode: 'metadata-only',
      body_stored: false,
      trust: 'untrusted-external-data'
    };
    assertSnapshot(snapshot);
    const outputDir = resolveContained(ROOT, 'reports', date, source.role);
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      resolveContained(outputDir, `${source.id}.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`
    );
  } catch (error) {
    failures.push({ source_id: source.id, url: source.url, error: String(error.message) });
  }
}

await writeFile(
  resolveContained(reportRoot, '_collection.json'),
  `${JSON.stringify(
    {
      schema_version: 1,
      date,
      attempted: sources.length,
      expected: enabledSources.length,
      complete: sources.length === enabledSources.length,
      succeeded: sources.length - failures.length,
      failures,
      max_response_bytes: MAX_RESPONSE_BYTES,
      max_redirects: MAX_REDIRECTS,
      trust: 'quarantine-only'
    },
    null,
    2
  )}\n`
);

console.log(`Refreshed ${sources.length - failures.length}/${sources.length} sources for ${date}.`);
if (failures.length > 0) {
  console.warn(`${failures.length} source(s) remain quarantined as failures.`);
  for (const failure of failures) console.warn(`${failure.source_id}: ${failure.error}`);
}
