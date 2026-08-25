import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
// 최신 문서 페이지는 1MB를 흔히 넘는다. 여전히 상한이지만 정상 문서를 막지 않는 크기로 둔다.
export const MAX_RESPONSE_BYTES = 5_000_000;
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
  'www.brandonsanderson.com',
  'www.gov.uk',
  'www.helpingwritersbecomeauthors.com',
  'www.korean.go.kr',
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

// 지식 문서의 `## 출처` 절이 단일 진실 원천이다. 각 출처 블록에서 id, URL, 권위,
// 그리고 검토 시점에 고정한 구조·본문 해시를 읽는다.
export function parseKnowledgeSources(text) {
  const sources = new Map();
  const blockPattern = /^- 출처 id: `([a-z0-9-]+)`\s*$/gm;
  for (const match of text.matchAll(blockPattern)) {
    const rest = text.slice(match.index);
    const field = (name) => rest.match(new RegExp(`^- ${name}: (.+)$`, 'm'))?.[1]?.trim();
    const pin = rest.match(/^- 검토 스냅샷: `([a-z0-9-]+)` 구조 `([a-f0-9]{12})` 본문 `([a-f0-9]{12})`\s*$/m);
    sources.set(match[1], {
      id: match[1],
      url: field('URL'),
      owner: field('소유자'),
      authority: field('권위'),
      pin: pin && pin[1] === match[1] ? { structure: pin[2], body: pin[3] } : null
    });
  }
  const sections = [...text.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1]);
  return { sources, sections, hasSourceSection: sections.includes('출처') };
}

// akasha/knowledge 아래 모든 지식 문서를 읽어 출처 목록을 만든다.
export async function loadKnowledgeSources() {
  const { readdir, readFile } = await import('node:fs/promises');
  const knowledgeRoot = path.join(ROOT, 'akasha', 'knowledge');
  const docs = [];
  for (const entry of await readdir(knowledgeRoot, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'INDEX.md') continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    const relative = path.relative(knowledgeRoot, full).split(path.sep).join('/');
    const text = await readFile(full, 'utf8');
    docs.push({ path: relative, ...parseKnowledgeSources(text) });
  }
  return docs.sort((a, b) => a.path.localeCompare(b.path));
}
