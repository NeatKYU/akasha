import { readFile, writeFile } from 'node:fs/promises';
import { ROOT, resolveContained } from './lib.mjs';

const version = process.argv[2];
const stableSemver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!stableSemver.test(version ?? '')) {
  throw new Error('Usage: npm run version:set -- <major.minor.patch[-prerelease]>');
}

async function readJson(...segments) {
  return JSON.parse(await readFile(resolveContained(ROOT, ...segments), 'utf8'));
}

async function writeJson(value, ...segments) {
  await writeFile(resolveContained(ROOT, ...segments), `${JSON.stringify(value, null, 2)}\n`);
}

const packageJson = await readJson('package.json');
packageJson.version = version;
await writeJson(packageJson, 'package.json');

const packageLock = await readJson('package-lock.json');
packageLock.version = version;
packageLock.packages[''].version = version;
await writeJson(packageLock, 'package-lock.json');

for (const directory of ['.claude-plugin', '.codex-plugin']) {
  const manifest = await readJson('akasha', directory, 'plugin.json');
  manifest.version = version;
  await writeJson(manifest, 'akasha', directory, 'plugin.json');
}

console.log(`Set Akasha release version to ${version}.`);
