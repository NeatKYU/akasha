import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

function parseArgs(argv) {
  const args = { input: null, output: null, mapping: null, configs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') args.input = argv[++index];
    else if (argv[index] === '--output') args.output = argv[++index];
    else if (argv[index] === '--mapping') args.mapping = argv[++index];
    else if (argv[index] === '--configs') args.configs = argv[++index].split(',');
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!args.input || !args.output || !args.mapping || !args.configs.length) throw new Error('--input, --output, --mapping and --configs are required');
  return args;
}

const cli = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tasks = JSON.parse(await readFile(path.join(repoRoot, 'benchmarks/model-routing/tasks.json'), 'utf8'));
const taskById = new Map(tasks.map((task) => [task.id, task]));
const records = (await readFile(cli.input, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
  .filter((record) => cli.configs.includes(record.config_id))
  .sort((a, b) => a.task_id.localeCompare(b.task_id) || a.run_id.localeCompare(b.run_id));
const salt = 'akasha-blind-routing-v1';
const packet = [];
const mapping = [];
for (const record of records) {
  const alias = createHash('sha256').update(`${salt}:${record.run_id}`).digest('hex').slice(0, 10);
  const task = taskById.get(record.task_id);
  packet.push({
    alias,
    task_id: record.task_id,
    task_title: task.title,
    evaluation_contract: task.prompt,
    rubric: task.rubric,
    answer: record.final_message,
  });
  mapping.push({ alias, run_id: record.run_id, lane: record.lane, config_id: record.config_id });
}
await writeFile(cli.output, `${JSON.stringify({ schema_version: 1, records: packet }, null, 2)}\n`);
await writeFile(cli.mapping, `${JSON.stringify({ schema_version: 1, records: mapping }, null, 2)}\n`);
console.log(JSON.stringify({ blinded_records: packet.length, output: cli.output, mapping: cli.mapping }));
