// akasha/ 의 변화를 분류해 필요한 SemVer 등급을 정하고, 실제로 올린 등급과 대조한다.
// 규칙은 docs/versioning.md 를 따른다. 배포되는 것은 akasha/ 뿐이므로 그 밖의 변경은 등급에 영향이 없다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ROOT, resolveContained } from './lib.mjs';

const LEVELS = ['none', 'patch', 'minor', 'major'];
const rank = (level) => LEVELS.indexOf(level);

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function parseArgs(argv) {
  const args = { base: 'main' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') args.base = argv[++i];
    else if (argv[i] === '--help') {
      console.log('Usage: node scripts/check-version.mjs [--base <ref>]');
      process.exit(0);
    }
  }
  return args;
}

const { base } = parseArgs(process.argv.slice(2));

let mergeBase;
try {
  mergeBase = git('merge-base', base, 'HEAD');
} catch {
  console.log(`base ref '${base}' 를 찾을 수 없어 버전 검사를 건너뜁니다.`);
  process.exit(0);
}

// HEAD 와 워킹트리 변경을 모두 본다. 커밋 전에도 필요한 등급을 알 수 있어야 한다.
const trackedStatus = git('diff', '--name-status', '-M', mergeBase, '--', 'akasha')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split('\t'));
const untrackedStatus = git('ls-files', '--others', '--exclude-standard', '--', 'akasha')
  .split('\n')
  .filter(Boolean)
  .map((file) => ['A', file]);
const status = [...trackedStatus, ...untrackedStatus];

if (status.length === 0) {
  console.log('akasha/ 변경 없음 — 버전을 올리지 않습니다.');
  process.exit(0);
}

const reasons = [];
let required = 'patch';
const raise = (level, reason) => {
  reasons.push(`[${level.toUpperCase()}] ${reason}`);
  if (rank(level) > rank(required)) required = level;
};

const isAgent = (p) => p.startsWith('akasha/agents/');
const isKnowledge = (p) => p.startsWith('akasha/knowledge/') && !p.endsWith('INDEX.md');

for (const [code, from, to] of status) {
  const kind = code[0];
  if (isAgent(from)) {
    if (kind === 'D') raise('major', `역할 삭제: ${from} — subagent_type 이 사라진다`);
    else if (kind === 'R') raise('major', `역할 이름 변경: ${from} → ${to}`);
    else if (kind === 'A') raise('minor', `역할 추가: ${from}`);
    else raise('patch', `역할 문서 내용 수정: ${from}`);
  } else if (isKnowledge(from)) {
    if (kind === 'A') raise('minor', `지식 문서 추가: ${from}`);
    else if (kind === 'D') raise('minor', `지식 문서 삭제: ${from}`);
    else if (kind === 'R') raise('minor', `지식 문서 이동: ${from} → ${to}`);
    else raise('patch', `지식 문서 내용 수정: ${from}`);
  } else if (from.endsWith('SKILL.md')) {
    const before = git('show', `${mergeBase}:${from}`);
    const nameOf = (text) => text.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const after = readFileSync(resolveContained(ROOT, ...from.split('/')), 'utf8');
    if (nameOf(before) !== nameOf(after)) raise('major', `스킬 name 변경: ${nameOf(before)} → ${nameOf(after)}`);
    else raise('patch', '스킬 내용 수정');
  }
}

const versionOf = (ref) => JSON.parse(git('show', `${ref}:package.json`)).version;
const bumpOf = (before, after) => {
  const [a, b, c] = before.split('.').map(Number);
  const [x, y, z] = after.split('.').map(Number);
  if (x > a) return 'major';
  if (x === a && y > b) return 'minor';
  if (x === a && y === b && z > c) return 'patch';
  return 'none';
};

const before = versionOf(mergeBase);
const after = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const actual = bumpOf(before, after);

console.log(`base ${base} (${mergeBase.slice(0, 7)}) ${before} → HEAD ${after}`);
console.log(`\n변경 분류 (${status.length}건):`);
for (const reason of [...new Set(reasons)].sort()) console.log(`  ${reason}`);
console.log(`\n필요한 등급: ${required.toUpperCase()}`);
console.log(`실제 올린 등급: ${actual.toUpperCase()}`);

if (rank(actual) < rank(required)) {
  console.error(
    `\n버전 등급 부족: ${required.toUpperCase()} 가 필요한데 ${actual.toUpperCase()} 만 올렸습니다.\n` +
      'docs/versioning.md 를 확인하고 `npm run version:set -- <새 버전>` 을 실행하세요.'
  );
  process.exit(1);
}
if (rank(actual) > rank(required)) {
  console.log(
    `\n참고: 필요한 것보다 높은 등급입니다. 의도한 것이 아니면 ${required.toUpperCase()} 로 낮추는 편이 정확합니다.`
  );
}
