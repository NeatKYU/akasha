import { readFile, writeFile } from 'node:fs/promises';
import { ROOT, resolveContained } from './lib.mjs';

// 승인 태그가 만들어진 뒤 마켓플레이스 카탈로그를 그 태그에 핀 고정한다.
// main의 카탈로그는 항상 "마지막으로 승인된 스냅샷"만 가리키고, 에이전트가
// 승인 전 내용을 설치할 경로를 남기지 않는 것이 목적이다.
const REPO_URL = 'https://github.com/NeatKYU/akasha.git';

const [tag, sha] = process.argv.slice(2);
if (!/^kb-\d{4}-W\d{2}-[a-f0-9]{7}$/.test(tag ?? '')) {
  throw new Error('Usage: pin-marketplace.mjs <kb-YYYY-Www-abcdef0> <40-hex sha>');
}
if (!/^[a-f0-9]{40}$/.test(sha ?? '')) {
  throw new Error('sha must be a full lowercase commit SHA');
}

async function readJson(...segments) {
  return JSON.parse(await readFile(resolveContained(ROOT, ...segments), 'utf8'));
}

async function writeJson(value, ...segments) {
  await writeFile(
    resolveContained(ROOT, ...segments),
    `${JSON.stringify(value, null, 2)}\n`
  );
}

// kb-* 태그는 승인 지식 스냅샷을 식별하고, plugin version은 독립적인 SemVer를 쓴다.
// promotion 전에 version:set과 CHANGELOG 갱신이 끝나 있어야 한다.
const packageJson = await readJson('package.json');
const version = packageJson.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version ?? '')) {
  throw new Error('package.json version must be stable SemVer without build metadata');
}

const claudeMarketplace = await readJson('.claude-plugin', 'marketplace.json');
const claudeEntry = claudeMarketplace.plugins?.find((plugin) => plugin.name === 'akasha');
if (!claudeEntry) throw new Error('akasha entry is missing in .claude-plugin/marketplace.json');
claudeEntry.version = version;
claudeEntry.source = { source: 'git-subdir', url: REPO_URL, path: 'akasha', ref: tag, sha };
await writeJson(claudeMarketplace, '.claude-plugin', 'marketplace.json');

// Codex git-subdir 소스는 문서화된 필드가 ref까지라 sha 없이 태그로 고정한다.
const codexMarketplace = await readJson('.agents', 'plugins', 'marketplace.json');
const codexEntry = codexMarketplace.plugins?.find((plugin) => plugin.name === 'akasha');
if (!codexEntry) throw new Error('akasha entry is missing in .agents/plugins/marketplace.json');
codexEntry.source = { source: 'git-subdir', url: REPO_URL, path: './akasha', ref: tag };
await writeJson(codexMarketplace, '.agents', 'plugins', 'marketplace.json');

// 두 런타임 manifest가 배포 SemVer와 일치하는지 확인한다. 핀 단계에서 버전을
// 묵시적으로 바꾸지 않아 release commit과 배포 artifact의 provenance를 보존한다.
for (const dir of ['.claude-plugin', '.codex-plugin']) {
  const pluginManifest = await readJson('akasha', dir, 'plugin.json');
  if (pluginManifest.version !== version) {
    throw new Error(`akasha/${dir}/plugin.json version must match package.json`);
  }
}

console.log(`Pinned akasha marketplace entries to ${tag} (${sha.slice(0, 7)}) as version ${version}.`);
