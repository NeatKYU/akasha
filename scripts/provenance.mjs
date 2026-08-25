// 실행 provenance — 어떤 플러그인 상태·측정 코드·정답 데이터가 이 수치를 냈는지 고정한다.
// commit만으로는 dirty worktree의 후보 상태를 구분하지 못하는 것이 이전 A/B에서 확인됐으므로
// (docs/handoffs/codex-round2-verification-and-verdict.md), 내용 해시를 1차 식별자로 두고
// commit·describe는 보조 라벨로만 쓴다. 런타임이 실제로 읽는 plugin 사본과 작업 트리를
// 따로 해싱해, 둘이 갈라진 상태에서 잰 수치를 사후에 식별할 수 있게 한다.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const PROVENANCE_SCHEMA_VERSION = 1;

const SKIP_ENTRIES = new Set(['.git', 'node_modules', '.DS_Store']);
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function hashText(content) {
  return createHash('sha256').update(content).digest('hex');
}

// 이름-해시 쌍의 정렬된 목록을 다시 해싱한다. 구성 요소가 하나라도 바뀌면 합성 해시가 바뀐다.
export function combineHashes(entries) {
  return hashText(Object.entries(entries)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, hash]) => `${name} ${hash ?? 'null'}\n`)
    .join(''));
}

export async function tryCommandOutput(bin, args, cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: String(error) });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    // 선행 공백은 지우지 않는다. `git status --porcelain`의 상태 코드 자리가 공백이라
    // trim()을 쓰면 첫 줄 경로의 첫 글자가 잘린다.
    child.on('error', (error) => resolve({ ok: false, stdout: stdout.trimEnd(), stderr: String(error) }));
    child.on('close', (code) => resolve({ ok: code === 0, stdout: stdout.trimEnd(), stderr: stderr.trim() }));
  });
}

export async function hashFile(filePath) {
  try {
    const content = await readFile(filePath);
    return { sha256: hashText(content), bytes: content.length };
  } catch {
    return null;
  }
}

export async function hashTree(rootDir) {
  let exists = true;
  try { await stat(rootDir); } catch { exists = false; }
  const files = [];
  async function walk(relative) {
    let entries;
    try { entries = await readdir(path.join(rootDir, relative), { withFileTypes: true }); } catch { return; }
    for (const entry of [...entries].sort(byName)) {
      if (SKIP_ENTRIES.has(entry.name)) continue;
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) {
        const hashed = await hashFile(path.join(rootDir, next));
        if (hashed) files.push({ path: next, ...hashed });
      }
    }
  }
  await walk('');
  files.sort(byPath);
  return {
    root: rootDir,
    exists,
    file_count: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    hash: hashText(files.map((file) => `${file.path} ${file.sha256}\n`).join('')),
    files,
  };
}

export async function hashFiles(rootDir, relativePaths) {
  const files = [];
  for (const relative of [...relativePaths].sort()) {
    const hashed = await hashFile(path.join(rootDir, relative));
    files.push({ path: relative, sha256: hashed?.sha256 ?? null, bytes: hashed?.bytes ?? null });
  }
  files.sort(byPath);
  return {
    file_count: files.length,
    missing: files.filter((file) => file.sha256 === null).map((file) => file.path),
    hash: hashText(files.map((file) => `${file.path} ${file.sha256}\n`).join('')),
    files,
  };
}

// codex가 프로젝트 로컬 `.agents/`에서 실제로 읽는 하위 트리. 플러그인 버전 A/B의 subject는
// 이 부분만 대상으로 해싱한다(.claude-plugin의 버전 문자열처럼 동작에 영향 없는 차이로
// 해시가 흔들리지 않게). 전체 트리 해시는 참고용으로 따로 남긴다.
export const PLUGIN_READ_DIRS = ['skills', 'knowledge', 'agents', 'roles'];

export async function hashPluginSubject(pluginDir, readDirs = PLUGIN_READ_DIRS) {
  const parts = {};
  const directories = {};
  for (const name of readDirs) {
    const tree = await hashTree(path.join(pluginDir, name));
    if (!tree.exists) continue;
    parts[name] = tree.hash;
    directories[name] = { file_count: tree.file_count, bytes: tree.bytes, hash: tree.hash };
  }
  return { root: pluginDir, hash: combineHashes(parts), directories, read_dirs: Object.keys(directories) };
}

export async function gitProvenance(repoRoot) {
  const run = (args) => tryCommandOutput('git', args, repoRoot);
  const value = (result) => (result.ok ? result.stdout.trim() : null);
  const [commit, short, branch, describe, status] = await Promise.all([
    run(['rev-parse', 'HEAD']),
    run(['rev-parse', '--short', 'HEAD']),
    run(['rev-parse', '--abbrev-ref', 'HEAD']),
    run(['describe', '--always', '--tags', '--dirty']),
    run(['status', '--porcelain']),
  ]);
  const lines = status.ok ? status.stdout.split('\n').filter(Boolean) : [];
  const untracked = lines.filter((line) => line.startsWith('??')).map((line) => line.slice(3));
  const modified = lines.filter((line) => !line.startsWith('??')).map((line) => line.slice(3));
  return {
    commit: value(commit),
    commit_short: value(short),
    branch: value(branch),
    describe: value(describe),
    dirty_tracked: modified.length > 0,
    modified_count: modified.length,
    modified_paths: modified.slice(0, 100),
    untracked_count: untracked.length,
    untracked_paths: untracked.slice(0, 100),
  };
}

// codex가 실제로 읽는 plugin 사본의 위치를 찾는다. CLI 출력이 바뀌어도 실행을 막지 않고
// cache 경로 규칙으로 물러선다(찾은 방법을 resolution에 남긴다).
export async function resolvePluginRuntime({ plugin, marketplace, version, homeDir = os.homedir() }) {
  const cacheDir = path.join(homeDir, '.codex/plugins/cache', marketplace, plugin, version);
  const listed = await tryCommandOutput('codex', ['plugin', 'list']);
  let cli = null;
  if (listed.ok) {
    const prefix = `${plugin}@${marketplace}`;
    const row = listed.stdout.split('\n').find((line) => line.startsWith(prefix));
    if (row) {
      const columns = row.slice(prefix.length).trim().split(/\s{2,}/).map((column) => column.trim()).filter(Boolean);
      cli = {
        status: columns[0] ?? null,
        version: columns.find((column) => /^\d/.test(column)) ?? null,
        path: columns.find((column) => column.startsWith('/')) ?? null,
      };
    }
  }
  let cacheExists = true;
  try { await stat(cacheDir); } catch { cacheExists = false; }
  return {
    cache_dir: cacheDir,
    cache_exists: cacheExists,
    cli,
    cli_available: listed.ok,
    resolution: cacheExists ? 'cache-path' : cli?.path ? 'cli-path' : 'worktree-fallback',
  };
}
