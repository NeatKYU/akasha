import { readFile, writeFile } from 'node:fs/promises';
import { ROOT, resolveContained } from './lib.mjs';

// 승인 태그가 만들어진 뒤 마켓플레이스 카탈로그를 그 태그에 핀 고정한다.
// main의 카탈로그는 항상 "마지막으로 승인된 스냅샷"만 가리키고, 에이전트가
// 승인 전 내용을 설치할 경로를 남기지 않는 것이 목적이다.
const REPO_URL = 'https://github.com/NeatKYU/agent-knowledge-base.git';

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

// 버전은 승인 스냅샷 날짜에서 파생한다. 마켓플레이스가 이 문자열을 바꿔야만
// 설치된 플러그인에 업데이트가 전파된다.
const manifest = await readJson('manifest.json');
const approvedDate = manifest.approved_report_date;
if (!/^\d{4}-\d{2}-\d{2}$/.test(approvedDate ?? '')) {
  throw new Error('manifest.approved_report_date is missing or invalid');
}
const [year, month, day] = approvedDate.split('-').map(Number);
const version = `${year}.${month}.${day}`;

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

// plugin.json 버전은 다음 태그 스냅샷에 실리도록 main에서 함께 올린다.
for (const dir of ['.claude-plugin', '.codex-plugin']) {
  const pluginManifest = await readJson('akasha', dir, 'plugin.json');
  pluginManifest.version = version;
  await writeJson(pluginManifest, 'akasha', dir, 'plugin.json');
}

console.log(`Pinned akasha marketplace entries to ${tag} (${sha.slice(0, 7)}) as version ${version}.`);
