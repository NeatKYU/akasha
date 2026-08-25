import { readFile, writeFile } from 'node:fs/promises';

const baselinePath = '/tmp/akasha-quality-first-ab.nzjDof/artifacts/enriched.jsonl';
const candidatePath = '/tmp/akasha-quality-final.kz2ctq/artifacts/raw.jsonl';
const baseline = (await readFile(baselinePath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
  .filter((record) => record.condition === 'A');
const candidate = (await readFile(candidatePath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
  .filter((record) => record.condition === 'B');
const combined = [...baseline, ...candidate].sort((a, b) => a.run_id.localeCompare(b.run_id));
await writeFile('/tmp/akasha-quality-final.kz2ctq/artifacts/raw.jsonl', combined.map((record) => JSON.stringify(record)).join('\n') + '\n');
