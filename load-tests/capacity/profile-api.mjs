// Records a CPU profile of the capacity API through its inspector
// (started with CAP_NODE_OPTIONS=--inspect=0.0.0.0:9229) and prints where the
// time goes: top functions by self time, and self time per package.
//   node profile-api.mjs <seconds> <out.cpuprofile>
import { writeFileSync } from 'node:fs';

const seconds = Number(process.argv[2] ?? 60);
const out = process.argv[3] ?? 'out/api.cpuprofile';
const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const url = list[0].webSocketDebuggerUrl.replace(
  /\/\/[^/]+\//,
  '//127.0.0.1:9229/',
);
const ws = new WebSocket(url);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
};
await new Promise((ok) => (ws.onopen = ok));
const send = (method, params = {}) =>
  new Promise((ok) => {
    id += 1;
    pending.set(id, ok);
    ws.send(JSON.stringify({ id, method, params }));
  });
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 1000 });
await send('Profiler.start');
await new Promise((ok) => setTimeout(ok, seconds * 1000));
const { profile } = await send('Profiler.stop');
ws.close();
writeFileSync(out, JSON.stringify(profile));

// Self time per node: samples x interval.
const dt = new Map();
for (let i = 0; i < profile.samples.length; i += 1)
  dt.set(
    profile.samples[i],
    (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0),
  );
const byFn = new Map();
const byPkg = new Map();
let total = 0;
for (const n of profile.nodes) {
  const us = dt.get(n.id) ?? 0;
  total += us;
  const f = n.callFrame;
  const where = f.url || '(native)';
  const fnKey = `${f.functionName || '(anonymous)'}  ${where.replace(/^.*\/app\//, '')}:${f.lineNumber + 1}`;
  byFn.set(fnKey, (byFn.get(fnKey) ?? 0) + us);
  const pkg =
    /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(where)?.[1] ??
    (where.includes('/dist/')
      ? 'app (dist)'
      : where.startsWith('node:')
        ? 'node core'
        : f.functionName.startsWith('(')
          ? f.functionName
          : 'other');
  byPkg.set(pkg, (byPkg.get(pkg) ?? 0) + us);
}
const pct = (us) => ((us / total) * 100).toFixed(1).padStart(5) + '%';
console.log(`PROFILE ${seconds}s total=${(total / 1e6).toFixed(1)}s cpu`);
console.log('\nBy package:');
for (const [k, v] of [...byPkg].sort((a, b) => b[1] - a[1]).slice(0, 20))
  console.log(pct(v), k);
console.log('\nTop functions (self time):');
for (const [k, v] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 30))
  console.log(pct(v), k.slice(0, 150));
