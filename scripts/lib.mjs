import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

export const ALLOWED_HOSTS = new Set([
  'cheatsheetseries.owasp.org',
  'design-system.service.gov.uk',
  'developers-apps-in-toss.toss.im',
  'developers.google.com',
  'developers.openai.com',
  'docs.github.com',
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
  /reveal (?:the )?(?:system|developer) prompt/i,
  /execute (?:this|the following) command/i,
  /send (?:the )?(?:secret|token|credential)/i,
  /override (?:the )?(?:system|developer) instructions/i
];

export function detectPromptInjection(value) {
  return INJECTION_PATTERNS.find((pattern) => pattern.test(value))?.source ?? null;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function assertSource(source, expectedRole) {
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

  const url = new URL(source.url);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Source ${source.id} uses a non-allowlisted URL: ${source.url}`);
  }

  if (!['primary', 'secondary'].includes(source.authority)) {
    throw new Error(`Source ${source.id} has invalid authority ${source.authority}`);
  }

  if (typeof source.enabled !== 'boolean') {
    throw new Error(`Source ${source.id} has invalid enabled flag`);
  }
}

export async function loadSources() {
  const rolesRoot = path.join(ROOT, 'catalog', 'roles');
  const roleEntries = await readdir(rolesRoot, { withFileTypes: true });
  const sources = [];
  const seenIds = new Set();

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
      sources.push(source);
    }
  }

  return sources.sort((left, right) => left.id.localeCompare(right.id));
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
