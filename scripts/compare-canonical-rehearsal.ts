import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=', 2);
  return [key, value];
}));
if (!args.before || !args.after || !args.output) throw new Error('Usage: --before=... --after=... --output=...');

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

async function main() {
  const before = JSON.parse(await readFile(resolve(args.before), 'utf8')).stable;
  const after = JSON.parse(await readFile(resolve(args.after), 'utf8')).stable;
  const beforeCanonical = canonical(before);
  const afterCanonical = canonical(after);
  const result = {
    equal: beforeCanonical === afterCanonical,
    before: resolve(args.before), after: resolve(args.after),
    beforeBytes: Buffer.byteLength(beforeCanonical), afterBytes: Buffer.byteLength(afterCanonical),
    difference: beforeCanonical === afterCanonical ? null : 'Stable canonical snapshot drift detected; preserve rehearsal DB for forensic comparison.',
  };
  await writeFile(resolve(args.output), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (!result.equal) process.exitCode = 2;
  console.log(JSON.stringify(result, null, 2));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
