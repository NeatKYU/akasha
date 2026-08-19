import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

export const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
export const MAX_RESPONSE_BYTES = 1_000_000;
export const MAX_REDIRECTS = 5;

export const ALLOWED_HOSTS = new Set([
  'cheatsheetseries.owasp.org',
  'design-system.service.gov.uk',
  'developers-apps-in-toss.toss.im',
  'developers.google.com',
  'developers.openai.com',
  'docs.github.com',
  'learn.chatgpt.com',
  'learn.thedesignsystem.guide',
  'next-auth.js.org',
  'nextjs.org',
  'owasp.org',
  'playwright.dev',
  'react.dev',
  'toss.tech',
  'www.gov.uk',
  'www.postgresql.org',
  'www.prisma.io',
  'www.typescriptlang.org',
  'www.w3.org'
]);

const INJECTION_PATTERNS = [
  /ignore (?:all|any|the) previous instructions/i,
  /disregard (?:all|any|the) previous instructions/i,
  /reveal (?:the )?(?:system|developer) prompt/i,
  /(?:system|developer) (?:prompt|message):/i,
  /execute (?:this|the following) command/i,
  /send (?:the )?(?:secret|token|credential)/i,
  /override (?:the )?(?:system|developer) instructions/i,
  /\b(?:call|invoke)\s+(?:the\s+)?tool[_ -]?call\b/i,
  /exfiltrat(?:e|ion)/i
];

const RAW_HTML_INJECTION_PATTERNS = [
  /ignore (?:all|any|the) previous instructions/i,
  /disregard (?:all|any|the) previous instructions/i,
  /reveal (?:the )?(?:system|developer) prompt/i,
  /execute (?:this|the following) command/i,
  /override (?:the )?(?:system|developer) instructions/i,
  /exfiltrat(?:e|ion)/i
];

const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|credential)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{20,}/i,
  /ghp_[A-Za-z0-9_]{36,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/
];

const RAW_HTML_SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|credential)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{32,}/i,
  /ghp_[A-Za-z0-9_]{36,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/
];

export function detectPromptInjection(value) {
  return INJECTION_PATTERNS.find((pattern) => pattern.test(value))?.source ?? null;
}

export function detectRawHtmlPromptInjection(value) {
  return RAW_HTML_INJECTION_PATTERNS.find((pattern) => pattern.test(value))?.source ?? null;
}

export function detectSecret(value) {
  return SECRET_PATTERNS.find((pattern) => pattern.test(value))?.source ?? null;
}

export function detectRawHtmlSecret(value) {
  return RAW_HTML_SECRET_PATTERNS.find((pattern) => pattern.test(value))?.source ?? null;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const sourceSchema = JSON.parse(readFileSync(path.join(ROOT, 'schema', 'source.schema.json'), 'utf8'));
const snapshotSchema = JSON.parse(
  readFileSync(path.join(ROOT, 'schema', 'snapshot.schema.json'), 'utf8')
);
const validateSourceSchema = ajv.compile(sourceSchema);
const validateSnapshotSchema = ajv.compile(snapshotSchema);

function schemaErrorText(validate) {
  return ajv.errorsText(validate.errors, { separator: '; ' });
}

export function assertSchema(value, schemaName) {
  const validate = schemaName === 'source' ? validateSourceSchema : validateSnapshotSchema;
  if (!validate(value)) {
    throw new Error(`${schemaName} schema validation failed: ${schemaErrorText(validate)}`);
  }
}

export function assertRelativePath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (value.includes('\0') || path.isAbsolute(value) || value.split(/[\\/]+/).includes('..')) {
    throw new Error(`${label} must stay inside the repository: ${value}`);
  }
}

export function resolveContained(base, ...segments) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, ...segments);
  const relative = path.relative(resolvedBase, resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolved;
  }
  throw new Error(`Path escapes ${resolvedBase}: ${resolved}`);
}

export function assertDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid report date: ${value}`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid report date: ${value}`);
  }
}

export function assertAllowlistedUrl(value, label = 'URL') {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new Error(`${label} uses a non-allowlisted URL: ${value}`);
  }
  return url;
}

export function assertSource(source, expectedRole) {
  assertSchema(source, 'source');
  const requiredStrings = [
    'id',
    'role',
    'title',
    'url',
    'authority',
    'owner',
    'license_note',
    'allowed_purpose'
  ];

  for (const key of requiredStrings) {
    if (typeof source[key] !== 'string' || source[key].trim() === '') {
      throw new Error(`Source ${source.id ?? '<unknown>'} has invalid ${key}`);
    }
  }

  if (!/^[a-z0-9-]+$/.test(source.id) || !/^[a-z0-9-]+$/.test(source.role)) {
    throw new Error(`Source ${source.id} has an invalid id or role`);
  }

  if (source.role !== expectedRole) {
    throw new Error(`Source ${source.id} role ${source.role} does not match ${expectedRole}`);
  }

  assertAllowlistedUrl(source.url, `Source ${source.id}`);

  if (!['primary', 'secondary'].includes(source.authority)) {
    throw new Error(`Source ${source.id} has invalid authority ${source.authority}`);
  }

  if (typeof source.enabled !== 'boolean') {
    throw new Error(`Source ${source.id} has invalid enabled flag`);
  }
}

export function assertSnapshot(snapshot) {
  assertSchema(snapshot, 'snapshot');
  if (detectPromptInjection(JSON.stringify(snapshot)) !== null) {
    throw new Error(`Snapshot ${snapshot.source_id} contains an instruction-like payload`);
  }
  const secretPattern = detectSecret(JSON.stringify(snapshot));
  if (secretPattern) {
    throw new Error(`Snapshot ${snapshot.source_id} contains a secret-like payload: ${secretPattern}`);
  }
}

export async function loadSources() {
  const rolesRoot = path.join(ROOT, 'catalog', 'roles');
  const roleEntries = await readdir(rolesRoot, { withFileTypes: true });
  const sources = [];
  const seenIds = new Set();
  const seenUrls = new Map();

  for (const roleEntry of roleEntries.filter((entry) => entry.isDirectory())) {
    const file = path.join(rolesRoot, roleEntry.name, 'sources.json');
    const roleSources = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(roleSources) || roleSources.length === 0) {
      throw new Error(`${file} must contain a non-empty array`);
    }

    for (const source of roleSources) {
      assertSource(source, roleEntry.name);
      if (seenIds.has(source.id)) {
        throw new Error(`Duplicate source id: ${source.id}`);
      }
      seenIds.add(source.id);
      const sourceUrl = canonicalSourceUrl(source.url);
      const duplicateUrlSource = seenUrls.get(sourceUrl);
      if (duplicateUrlSource) {
        throw new Error(
          `Duplicate source URL: ${source.url} used by ${duplicateUrlSource} and ${source.id}`
        );
      }
      seenUrls.set(sourceUrl, source.id);
      sources.push(source);
    }
  }

  return sources.sort((left, right) => left.id.localeCompare(right.id));
}

function canonicalSourceUrl(value) {
  const url = assertAllowlistedUrl(value, 'Source URL');
  url.hash = '';
  return url.href.replace(/\/$/, '');
}

export async function fetchAllowlistedHtml(startUrl, options = {}) {
  const headers = options.headers ?? {};
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  const signal = options.signal;
  let currentUrl = assertAllowlistedUrl(startUrl, 'Fetch URL');
  const hops = [];

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      headers,
      redirect: 'manual',
      signal
    });
    hops.push(currentUrl.href);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect without location from ${currentUrl.href}`);
      if (redirectCount === maxRedirects) {
        throw new Error(`Too many redirects from ${startUrl}`);
      }
      currentUrl = assertAllowlistedUrl(new URL(location, currentUrl).href, 'Redirect URL');
      continue;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      response,
      html: await readResponseBodyLimited(response, maxBytes),
      finalUrl: currentUrl.href,
      redirect_hops: hops
    };
  }

  throw new Error(`Too many redirects from ${startUrl}`);
}

async function readResponseBodyLimited(response, maxBytes) {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    throw new Error(`Response body exceeds ${maxBytes} bytes`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error(`Response body exceeds ${maxBytes} bytes`);
    return buffer.toString('utf8');
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error(`Response body exceeds ${maxBytes} bytes`);
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

function decodeEntities(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

export function extractMetadata(html) {
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ');
  const title = decodeEntities(
    withoutNoise.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? ''
  );
  const descriptionMatch = withoutNoise.match(
    /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i
  ) ?? withoutNoise.match(
    /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i
  );
  const description = decodeEntities(descriptionMatch?.[1]?.trim() ?? '');
  const headings = [...withoutNoise.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => decodeEntities(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()))
    .filter(Boolean)
    .slice(0, 40);
  const normalizedText = decodeEntities(
    withoutNoise.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  );

  return { title, description, headings, normalizedText };
}

// 지식 문서가 어떤 출처를, 어떤 시점 스냅샷으로 요약했는지 읽는다.
// `- 출처 카탈로그: \`id\`` 와 그 아래 `- 검토 스냅샷: \`id@hash12\`` 쌍, 그리고
// 초기 스텁의 `Source catalog: \`a\`, \`b\`` 형식을 모두 인식한다.
export function parseKnowledgeSources(text) {
  const ids = new Set();
  const pins = new Map();
  for (const match of text.matchAll(/^- 출처 카탈로그: `([a-z0-9-]+)`\s*$/gm)) ids.add(match[1]);
  for (const match of text.matchAll(/^- 검토 스냅샷: `([a-z0-9-]+)@([a-f0-9]{12})`\s*$/gm)) {
    pins.set(match[1], match[2]);
  }
  const legacy = text.match(/^Source catalog:([\s\S]*?)\.\s*$/m);
  if (legacy) for (const match of legacy[1].matchAll(/`([a-z0-9-]+)`/g)) ids.add(match[1]);
  return { ids, pins, hasSourceSection: /^## 출처\s*$/m.test(text) };
}
