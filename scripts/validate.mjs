import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  assertAllowlistedUrl,
  assertDate,
  assertRelativePath,
  assertSnapshot,
  assertSource,
  detectPromptInjection,
  detectRawHtmlPromptInjection,
  detectRawHtmlSecret,
  detectSecret,
  loadSources,
  resolveContained
} from './lib.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function validateReleaseVersion() {
  const packageJson = JSON.parse(await readFile(resolveContained(ROOT, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(await readFile(resolveContained(ROOT, 'package-lock.json'), 'utf8'));
  const claudeManifest = JSON.parse(
    await readFile(resolveContained(ROOT, 'akasha', '.claude-plugin', 'plugin.json'), 'utf8')
  );
  const codexManifest = JSON.parse(
    await readFile(resolveContained(ROOT, 'akasha', '.codex-plugin', 'plugin.json'), 'utf8')
  );
  const changelog = await readFile(resolveContained(ROOT, 'CHANGELOG.md'), 'utf8');
  const stableSemver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

  assert(stableSemver.test(packageJson.version), 'package.json version must be stable SemVer without build metadata');
  assert(packageLock.version === packageJson.version, 'package-lock.json version must match package.json');
  assert(packageLock.packages?.['']?.version === packageJson.version, 'package-lock root version must match package.json');
  assert(claudeManifest.version === packageJson.version, 'Claude plugin version must match package.json');
  assert(codexManifest.version === packageJson.version, 'Codex plugin version must match package.json');
  assert(
    changelog.includes(`## [${packageJson.version}]`),
    `CHANGELOG.md must contain a ${packageJson.version} release entry`
  );
}

async function validateManifest() {
  const manifest = JSON.parse(await readFile(resolveContained(ROOT, 'manifest.json'), 'utf8'));
  assert(manifest.schema_version === 1, 'manifest.schema_version must be 1');
  assert(
    ['bootstrap', 'approved-main'].includes(manifest.snapshot_status),
    'manifest.snapshot_status is invalid'
  );
  assert(manifest.trust === 'human-reviewed-main-only', 'manifest trust boundary is invalid');
  assertRelativePath(manifest.knowledge_index, 'manifest.knowledge_index');
  assert(
    manifest.knowledge_index === 'akasha/knowledge/INDEX.md',
    'manifest.knowledge_index must point to akasha/knowledge/INDEX.md'
  );
  await access(resolveContained(ROOT, manifest.knowledge_index));
  if (manifest.approved_report_date !== undefined) assertDate(manifest.approved_report_date);
  if (manifest.approved_commit !== null && manifest.approved_commit !== undefined) {
    assert(/^[a-f0-9]{40}$/.test(manifest.approved_commit), 'manifest.approved_commit is invalid');
  }
  if (manifest.unavailable_sources !== undefined) {
    assert(
      Array.isArray(manifest.unavailable_sources),
      'manifest.unavailable_sources must be an array'
    );
    for (const entry of manifest.unavailable_sources) {
      assert(
        entry && /^[a-z0-9-]+$/.test(entry.source_id),
        'manifest unavailable source id is invalid'
      );
      // 승인된 스냅샷은 secondary 출처만 누락할 수 있다. primary 누락은 승격 자체가 막혀야 한다.
      assert(
        entry.authority === 'secondary',
        `manifest unavailable source ${entry.source_id} must be secondary`
      );
      assert(
        !Object.hasOwn(manifest.source_hashes ?? {}, entry.source_id),
        `manifest unavailable source ${entry.source_id} must not carry a hash`
      );
    }
  }
  assert(
    manifest.source_hashes && typeof manifest.source_hashes === 'object' && !Array.isArray(manifest.source_hashes),
    'manifest.source_hashes must be an object'
  );
  for (const [sourceId, hashes] of Object.entries(manifest.source_hashes)) {
    assert(/^[a-z0-9-]+$/.test(sourceId), `manifest source id is invalid: ${sourceId}`);
    assert(/^[a-f0-9]{64}$/.test(hashes.content_sha256), `manifest content hash is invalid for ${sourceId}`);
    assert(/^[a-f0-9]{64}$/.test(hashes.snapshot_sha256), `manifest snapshot hash is invalid for ${sourceId}`);
  }
}

async function validateReports(sourcesById) {
  const reportsRoot = resolveContained(ROOT, 'reports');
  let dateEntries = [];
  try {
    dateEntries = await readdir(reportsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const dateEntry of dateEntries.filter((entry) => entry.isDirectory())) {
    assertDate(dateEntry.name);
    const dateRoot = resolveContained(reportsRoot, dateEntry.name);
    const collectionPath = resolveContained(dateRoot, '_collection.json');
    const collection = JSON.parse(await readFile(collectionPath, 'utf8'));
    assert(collection.schema_version === 1, `${dateEntry.name} collection schema_version must be 1`);
    assert(collection.date === dateEntry.name, `${dateEntry.name} collection date mismatch`);
    assert(collection.trust === 'quarantine-only', `${dateEntry.name} collection trust marker is invalid`);
    assert(Number.isInteger(collection.attempted) && collection.attempted >= 0, 'collection attempted is invalid');
    assert(Number.isInteger(collection.succeeded) && collection.succeeded >= 0, 'collection succeeded is invalid');
    assert(Array.isArray(collection.failures), 'collection failures must be an array');
    assert(
      collection.attempted === collection.succeeded + collection.failures.length,
      `${dateEntry.name} collection attempted/succeeded/failures mismatch`
    );
    let snapshotCount = 0;
    const roleEntries = await readdir(dateRoot, { withFileTypes: true });
    for (const roleEntry of roleEntries.filter((entry) => entry.isDirectory())) {
      assert(/^[a-z0-9-]+$/.test(roleEntry.name), `Invalid report role directory: ${roleEntry.name}`);
      const roleRoot = resolveContained(dateRoot, roleEntry.name);
      const files = await readdir(roleRoot);
      for (const file of files.filter((name) => name.endsWith('.json'))) {
        assert(/^[a-z0-9-]+\.json$/.test(file), `Invalid report filename: ${file}`);
        const snapshot = JSON.parse(
          await readFile(resolveContained(roleRoot, file), 'utf8')
        );
        assertSnapshot(snapshot);
        const source = sourcesById.get(snapshot.source_id);
        assert(source, `Unknown snapshot source ${snapshot.source_id}`);
        assert(snapshot.role === source.role, `Snapshot role mismatch for ${snapshot.source_id}`);
        assert(snapshot.source_url === source.url, `Snapshot URL mismatch for ${snapshot.source_id}`);
        if (snapshot.final_url !== undefined) assertAllowlistedUrl(snapshot.final_url, 'Snapshot final_url');
        assert(/^[a-f0-9]{64}$/.test(snapshot.content_sha256), 'Invalid snapshot SHA-256');
        assert(snapshot.trust === 'untrusted-external-data', 'Snapshot trust marker is missing');
        snapshotCount += 1;
      }
    }
    assert(
      snapshotCount === collection.succeeded,
      `${dateEntry.name} collection succeeded count does not match snapshots`
    );
  }
}

async function validateKnowledgeDocuments() {
  const knowledgeRoot = resolveContained(ROOT, 'akasha', 'knowledge');
  const indexPath = resolveContained(knowledgeRoot, 'INDEX.md');
  const indexText = await readFile(indexPath, 'utf8');
  const indexLinks = [...indexText.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => ({
    label: match[1],
    href: match[2]
  }));

  const seenIndexLabels = new Map();
  const seenIndexTargets = new Map();
  const indexTargets = new Set();

  for (const link of indexLinks) {
    assertRelativePath(link.href, `knowledge index link ${link.label}`);
    assert(!link.href.includes('#'), `knowledge index link must not include a fragment: ${link.href}`);
    const targetPath = resolveContained(knowledgeRoot, link.href);
    assert(targetPath.endsWith('.md'), `knowledge index link must target a Markdown file: ${link.href}`);
    await access(targetPath);

    const normalizedLabel = normalizeComparable(link.label);
    const duplicateLabel = seenIndexLabels.get(normalizedLabel);
    assert(
      !duplicateLabel,
      `Duplicate knowledge index label: ${duplicateLabel} and ${link.label}`
    );
    seenIndexLabels.set(normalizedLabel, link.label);

    const relativeTarget = normalizeRelativePath(path.relative(knowledgeRoot, targetPath));
    const duplicateTarget = seenIndexTargets.get(relativeTarget);
    assert(
      !duplicateTarget,
      `Duplicate knowledge index target: ${duplicateTarget} and ${link.href}`
    );
    seenIndexTargets.set(relativeTarget, link.href);
    indexTargets.add(relativeTarget);
  }

  const documents = await collectKnowledgeDocuments(knowledgeRoot);
  const seenHeadings = new Map();
  const documentPaths = new Set();

  for (const documentPath of documents) {
    const relativePath = normalizeRelativePath(path.relative(knowledgeRoot, documentPath));
    documentPaths.add(relativePath);
    const text = await readFile(documentPath, 'utf8');
    const heading = text.split(/\r?\n/).find((line) => line.startsWith('# '))?.slice(2).trim();
    assert(heading, `Knowledge document must have an H1 heading: akasha/knowledge/${relativePath}`);

    const normalizedHeading = normalizeComparable(heading);
    const duplicateHeading = seenHeadings.get(normalizedHeading);
    assert(
      !duplicateHeading,
      `Duplicate knowledge document H1: ${duplicateHeading} and akasha/knowledge/${relativePath}`
    );
    seenHeadings.set(normalizedHeading, `akasha/knowledge/${relativePath}`);

    assert(
      indexTargets.has(relativePath),
      `Knowledge document is not listed in akasha/knowledge/INDEX.md: akasha/knowledge/${relativePath}`
    );
  }

  for (const indexTarget of indexTargets) {
    assert(
      documentPaths.has(indexTarget),
      `akasha/knowledge/INDEX.md points outside approved knowledge documents: ${indexTarget}`
    );
  }

  return documentPaths;
}

async function validateRoleKnowledgeRouting(documentPaths) {
  const rolesRoot = resolveContained(ROOT, 'akasha', 'agents');
  const knowledgeRoot = resolveContained(ROOT, 'akasha', 'knowledge');
  const roleEntries = (await readdir(rolesRoot)).filter((entry) => entry.endsWith('.md')).sort();
  assert(roleEntries.length > 0, 'akasha/agents must contain at least one role document');

  const routedDocuments = new Map();
  const roleNames = new Set();
  const roleTexts = new Map();

  for (const roleEntry of roleEntries) {
    assert(
      roleEntry.startsWith('akasha-'),
      `Role agent filename must be prefixed to avoid colliding with project agents: akasha/agents/${roleEntry}`
    );
    const roleName = roleEntry.slice('akasha-'.length, -3);
    assert(/^[a-z0-9-]+$/.test(roleName), `Invalid role document name: akasha/agents/${roleEntry}`);
    roleNames.add(roleName);
    const roleText = await readFile(resolveContained(rolesRoot, roleEntry), 'utf8');
    roleTexts.set(roleName, { file: roleEntry, text: roleText });

    const section = roleText.match(/^## 담당 지식\s*$([\s\S]*?)(?=^## |\Z)/m);
    assert(section, `Role document must declare a 담당 지식 section: akasha/agents/${roleEntry}`);

    const references = [...section[1].matchAll(/`([^`]+\.md)`/g)].map((match) => match[1]);
    assert(
      references.length > 0,
      `Role document must reference at least one knowledge document: akasha/agents/${roleEntry}`
    );

    const seenInRole = new Set();
    for (const reference of references) {
      assertRelativePath(reference, `role ${roleName} 담당 지식 reference`);
      assert(
        reference.startsWith('knowledge/'),
        `Role knowledge reference must be plugin-root relative and start with knowledge/: ${reference} (akasha/agents/${roleEntry})`
      );

      const relativePath = normalizeRelativePath(
        path.relative(knowledgeRoot, resolveContained(knowledgeRoot, reference.slice('knowledge/'.length)))
      );
      assert(
        documentPaths.has(relativePath),
        `Role knowledge reference does not resolve to an approved knowledge document: ${reference} (akasha/agents/${roleEntry})`
      );
      assert(
        !seenInRole.has(relativePath),
        `Duplicate 담당 지식 reference in akasha/agents/${roleEntry}: ${reference}`
      );
      seenInRole.add(relativePath);

      const owners = routedDocuments.get(relativePath) ?? [];
      owners.push(roleName);
      routedDocuments.set(relativePath, owners);
    }
  }

  const orphans = [...documentPaths].filter((documentPath) => !routedDocuments.has(documentPath)).sort();
  if (orphans.length > 0) {
    const details = orphans.map((documentPath) => {
      const directory = documentPath.split('/')[0];
      const target = roleNames.has(directory)
        ? `akasha/agents/akasha-${directory}.md`
        : 'the owning role document';
      return [
        `  - akasha/knowledge/${documentPath}`,
        `      add to ${target} under "## 담당 지식":`,
        `        - \`knowledge/${documentPath}\``
      ].join('\n');
    });
    assert(
      false,
      [
        `Knowledge documents are not routed to any role (${orphans.length}):`,
        ...details,
        '  The directory name is only a suggestion; wire each document to whichever role owns the judgment.'
      ].join('\n')
    );
  }

  return roleTexts;
}

// 자식에게 절대 주어져서는 안 되는 도구. 역할 문서가 그대로 Claude Code 서브에이전트가
// 되므로, 읽기 전용 경계는 이 검사로만 보장된다.
const FORBIDDEN_AGENT_TOOLS = [
  'Bash', 'Write', 'Edit', 'NotebookEdit', 'Task', 'Agent', 'WebFetch', 'WebSearch'
];

// 자식 실행에만 쓰이는 절. 모든 역할에서 완전히 같아야 Codex와 Claude Code의 판정
// 규칙이 갈라지지 않는다.
const SHARED_CHILD_SECTIONS = ['규칙', '실행 예산', '반환 계약', '도구 경계'];

function parseFrontmatter(text, label) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert(match, `${label} must start with YAML frontmatter so Claude Code can load it as an agent`);
  return new Map(
    match[1]
      .split('\n')
      .map((line) => line.match(/^([a-z]+): (.*)$/))
      .filter(Boolean)
      .map((entry) => [entry[1], entry[2].trim()])
  );
}

function sectionText(text, name) {
  const heading = `\n## ${name}\n`;
  const start = text.indexOf(heading);
  if (start === -1) return null;
  const rest = text.slice(start + heading.length);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

async function validateAgentContract(roleTexts) {
  let baseline = null;

  for (const [roleName, { file, text }] of roleTexts) {
    const label = `akasha/agents/${file}`;
    const fields = parseFrontmatter(text, label);

    assert(
      fields.get('name') === file.slice(0, -3),
      `${label} name field must match its filename — Claude Code derives the subagent type from the filename`
    );
    assert(fields.get('description'), `${label} must declare a description`);

    const tools = (fields.get('tools') ?? '').split(',').map((tool) => tool.trim()).filter(Boolean);
    assert(tools.length > 0, `${label} must declare an explicit read-only tools allowlist`);
    for (const tool of tools) {
      assert(
        !FORBIDDEN_AGENT_TOOLS.includes(tool),
        `${label} grants a non-read-only tool: ${tool}`
      );
    }

    // 모델 상속은 검증되지 않은 역할별 tiering을 막는 계약이다.
    assert(
      fields.get('model') === 'inherit',
      `${label} must inherit the parent model until routing passes the promotion gate`
    );

    const shared = SHARED_CHILD_SECTIONS.map((name) => {
      const body = sectionText(text, name);
      assert(body, `${label} must declare a "## ${name}" section`);
      return `## ${name}\n${body}`;
    }).join('\n\n');

    if (baseline === null) baseline = { roleName, shared };
    else {
      assert(
        shared === baseline.shared,
        `Shared child sections diverge between akasha/agents/akasha-${baseline.roleName}.md and ${label}. ` +
          `Every role must carry byte-identical ${SHARED_CHILD_SECTIONS.map((n) => `"## ${n}"`).join(', ')} sections.`
      );
    }
  }
}

async function validateAkashaSkillContract() {
  const skillPath = resolveContained(ROOT, 'akasha', 'skills', 'akasha', 'SKILL.md');
  const skillText = await readFile(skillPath, 'utf8');

  assert(
    skillText.includes('`fork_turns: "none"`으로 실행한다'),
    'Akasha skill must isolate Codex subagents with fork_turns: "none"'
  );
  assert(
    skillText.includes('`fork_turns: "all"`을 사용할 때는 `agent_type`, `model`, `reasoning_effort`를 함께'),
    'Akasha skill must prohibit incompatible full-history agent overrides'
  );
  assert(
    skillText.includes('항상 `timeout_ms: 30000`을 사용한다'),
    'Akasha skill must use one deterministic wait_agent timeout'
  );
  assert(
    skillText.includes('`30000`보다 짧거나 긴 값을 임의로 쓰지 않고'),
    'Akasha skill must prohibit wait timeout drift'
  );
  assert(
    skillText.includes('역할 context packet'),
    'Akasha skill must define a bounded role context packet'
  );
  assert(
    skillText.includes('diff 본문은 메시지에 넣지 않는다'),
    'Akasha skill must not inline full diffs in subagent messages'
  );
  assert(
    skillText.includes('사용자 요청 원문이나\n  부모 대화 전문을 다시 복사하지 않는다'),
    'Akasha skill must not duplicate the user request or parent history'
  );
  assert(
    skillText.includes('판정을 최대 5개, 지식 공백을 최대 3개'),
    'Akasha skill must bound subagent output'
  );
  assert(
    skillText.includes('성공한 `spawn_agent` 호출이 정확히 하나'),
    'Akasha skill must spawn every selected role exactly once'
  );
  assert(
    skillText.includes('`content+path`, `path-only`, `content-only`, `advisory-no-diff`'),
    'Akasha skill must preserve content-only and path-based selection reasons'
  );
  assert(
    skillText.includes('secret·token·개인정보는 값을 packet에 넣지 않고'),
    'Akasha skill must redact sensitive values from subagent packets'
  );
  assert(
    skillText.includes('기본 호출 인자는 정확히 `task_name`, `fork_turns: "none"`,\n  `message`만 사용한다'),
    'Akasha skill must keep the bounded child invocation contract'
  );
  assert(
    skillText.includes('production 기본값은 부모 model·effort 상속'),
    'Akasha skill must keep unproven automatic tiering out of the production default'
  );
  assert(
    skillText.includes('역할 이름만으로 model이나 reasoning effort를 자동 변경하지 않는다'),
    'Akasha skill must prohibit role-name-only model escalation'
  );
  assert(
    skillText.includes('모델은 보안 경계가 아니며'),
    'Akasha skill must not treat model tiering as a security boundary'
  );
  assert(
    skillText.includes('`model_routes` 배열') && skillText.includes('`fallbacks`를 빈 배열'),
    'Akasha skill must report auditable model routes and fallbacks'
  );
  assert(
    skillText.includes('`reasoning_effort`만 생략하고 같은 model로 한 번만\n재시도한다'),
    'Akasha skill must preserve user-selected models while bounding fallback retries'
  );
  assert(
    skillText.includes('읽기 도구 호출은 최대 3회'),
    'Akasha skill must bound child read tool calls'
  );
  assert(
    skillText.includes('역할 선택 전에 최대 2회의 읽기 호출'),
    'Akasha skill must bound root routing reads'
  );
  assert(
    skillText.includes('종합 단계 재검증은 최대 2회의 읽기 호출'),
    'Akasha skill must bound root synthesis reads'
  );
  assert(
    skillText.includes('다른 지식 문서·manifest·catalog·플러그인 전체를 검색하거나 네트워크를 조회하지'),
    'Akasha skill must stop source URL discovery when the assigned knowledge document has no URL'
  );
  assert(
    skillText.includes('`send_message`·`followup_task`를 호출하지'),
    'Akasha child agents must return once without follow-up messaging'
  );
  assert(
    skillText.includes('`needs_parent_expansion`에 `reason`, `missing_scope`, 최대 3개의'),
    'Akasha skill must provide a bounded parent expansion escape hatch'
  );
  assert(
    skillText.includes('`subagent_type`에 `akasha-<역할>`'),
    'Akasha skill must bind Claude Code subagents to the role documents by filename'
  );
  assert(
    skillText.includes('`tools: Read, Grep, Glob`으로 고정'),
    'Akasha skill must document the read-only tool boundary of role subagents'
  );
  assert(
    skillText.includes('도구 제한이 적용되지 않았다는'),
    'Akasha skill must report when the read-only agent definitions are unavailable'
  );
  assert(
    skillText.includes('읽기 전용 도구만 가진 서브에이전트에는 부모가 같은 범위의 scoped diff를'),
    'Akasha skill must supply scoped diffs to shell-less subagents'
  );
}

async function validateFixtures() {
  const malicious = JSON.parse(
    await readFile(path.join(ROOT, 'fixtures', 'malicious-source.json'), 'utf8')
  );
  assert(
    detectPromptInjection(malicious.body) !== null,
    'Malicious prompt-injection fixture was not rejected'
  );
  assert(
    detectRawHtmlPromptInjection(malicious.body) !== null,
    'Malicious raw HTML prompt-injection fixture was not rejected'
  );
  assert(
    detectRawHtmlPromptInjection('window.__data = { tool_call: "documented API field" };') === null,
    'Benign raw HTML tool_call fixture was rejected'
  );

  const invalid = JSON.parse(
    await readFile(path.join(ROOT, 'fixtures', 'invalid-source.json'), 'utf8')
  );
  let rejected = false;
  try {
    assertSource(invalid, 'security');
  } catch {
    rejected = true;
  }
  assert(rejected, 'Non-HTTPS source fixture was not rejected');

  const oversizedSnapshot = JSON.parse(
    await readFile(resolveContained(ROOT, 'fixtures', 'oversized-snapshot.json'), 'utf8')
  );
  rejected = false;
  try {
    assertSnapshot(oversizedSnapshot);
  } catch {
    rejected = true;
  }
  assert(rejected, 'Oversized snapshot fixture was not rejected');

  const pathTraversalManifest = JSON.parse(
    await readFile(resolveContained(ROOT, 'fixtures', 'path-traversal-manifest.json'), 'utf8')
  );
  rejected = false;
  try {
    assertRelativePath(pathTraversalManifest.knowledge_index, 'fixture.knowledge_index');
  } catch {
    rejected = true;
  }
  assert(rejected, 'Path traversal fixture was not rejected');

  const promptInjectionSnapshot = JSON.parse(
    await readFile(resolveContained(ROOT, 'fixtures', 'prompt-injection-snapshot.json'), 'utf8')
  );
  rejected = false;
  try {
    assertSnapshot(promptInjectionSnapshot);
  } catch {
    rejected = true;
  }
  assert(rejected, 'Prompt-injection snapshot fixture was not rejected');

  const secretPayloadParts = JSON.parse(
    await readFile(resolveContained(ROOT, 'fixtures', 'secret-payload-parts.json'), 'utf8')
  );
  const secretFixture = secretPayloadParts.parts.join('');
  assert(detectSecret(secretFixture) !== null, 'Secret fixture was not detected');
  assert(
    detectRawHtmlSecret('Gov.uk generated class sk-example-token-shaped-text') === null,
    'Benign raw HTML sk-* fixture was rejected'
  );
}

async function validateRepoSecretScan() {
  const candidateFiles = await collectFiles(ROOT);
  for (const file of candidateFiles) {
    const text = await readFile(file, 'utf8');
    const pattern = detectSecret(text);
    assert(pattern === null, `Secret-like payload detected in ${path.relative(ROOT, file)}: ${pattern}`);
  }
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const resolved = resolveContained(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(resolved)));
    } else if (/\.(json|md|mjs|ya?ml)$/.test(entry.name)) {
      files.push(resolved);
    }
  }
  return files;
}

async function collectKnowledgeDocuments(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolved = resolveContained(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectKnowledgeDocuments(resolved)));
    } else if (entry.name.endsWith('.md') && path.basename(resolved) !== 'INDEX.md') {
      files.push(resolved);
    }
  }
  return files.sort();
}

function normalizeComparable(value) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

const sources = await loadSources();
await validateReleaseVersion();
await validateManifest();
await validateAgentContract(await validateRoleKnowledgeRouting(await validateKnowledgeDocuments()));
await validateAkashaSkillContract();
await validateReports(new Map(sources.map((source) => [source.id, source])));
await validateRepoSecretScan();
if (process.argv.includes('--fixtures')) await validateFixtures();

console.log(`Validated ${sources.length} allowlisted sources and the knowledge manifest.`);
