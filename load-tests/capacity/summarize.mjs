// Summarises one capacity run: node summarize.mjs out/<label>
// Prints markdown: per-30-s windows (virtual learners, requests/s, p95, errors,
// Mbps the server sent), the first window that broke a threshold, per-endpoint
// p95 / errors / bytes, and container peaks (CPU, memory, egress), Postgres
// connections and API event-loop delay.
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node summarize.mjs out/<label>');
const WINDOW = 30;
const p95 = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
};
const mb = (b) => (b / 1e6).toFixed(1);

// ── k6 time series ────────────────────────────────────────────────────────────
const windows = new Map();
const win = (t) => {
  const k = Math.floor(t / WINDOW) * WINDOW;
  if (!windows.has(k))
    windows.set(k, { vus: 0, reqs: 0, failed: 0, durations: [], received: 0 });
  return windows.get(k);
};
const csvPath = join(dir, 'metrics.csv.gz');
if (existsSync(csvPath)) {
  const lines = gunzipSync(readFileSync(csvPath)).toString('utf8').split('\n');
  const head = lines[0].split(',');
  const col = (n) => head.indexOf(n);
  const [cName, cTime, cValue] = [
    col('metric_name'),
    col('timestamp'),
    col('metric_value'),
  ];
  for (let i = 1; i < lines.length; i += 1) {
    const f = lines[i].split(',');
    if (f.length < 3) continue;
    const name = f[cName];
    const t = Number(f[cTime]);
    const v = Number(f[cValue]);
    if (name === 'vus') win(t).vus = Math.max(win(t).vus, v);
    else if (name === 'http_reqs') win(t).reqs += v;
    else if (name === 'http_req_failed') win(t).failed += v;
    else if (name === 'http_req_duration') win(t).durations.push(v);
    else if (name === 'data_received') win(t).received += v;
  }
}
const keys = [...windows.keys()].sort((a, b) => a - b);
const t0 = keys[0] ?? 0;
console.log(`## ${dir}\n`);
console.log(readFileSync(join(dir, 'setup.txt'), 'utf8').trim(), '\n');
console.log(
  '| t (s) | VUs | req/s | p95 (ms) | errors | Mbps sent by server |',
);
console.log('|---:|---:|---:|---:|---:|---:|');
let broke = null;
for (const k of keys) {
  const w = windows.get(k);
  if (!w.reqs) continue;
  const p = p95(w.durations);
  const errRate = w.failed / w.reqs;
  const mbps = (w.received * 8) / WINDOW / 1e6;
  if (!broke && w.vus > 0 && (p > 1000 || errRate > 0.01))
    broke = { t: k - t0, vus: w.vus, p, errRate };
  console.log(
    `| ${k - t0} | ${w.vus} | ${(w.reqs / WINDOW).toFixed(0)} | ${p.toFixed(0)} | ${(errRate * 100).toFixed(2)}% | ${mbps.toFixed(1)} |`,
  );
}
console.log(
  broke
    ? `\nFIRST_BREAK=t${broke.t}s VUS=${broke.vus} P95=${broke.p.toFixed(0)}ms ERRORS=${(broke.errRate * 100).toFixed(2)}%`
    : '\nFIRST_BREAK=none',
);

// ── k6 summary per endpoint ───────────────────────────────────────────────────
const sum = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')).metrics;
const total = sum.http_reqs?.count ?? 0;
console.log(
  `\nTOTAL requests=${total} failed=${((sum.http_req_failed?.value ?? 0) * 100).toFixed(2)}% ` +
    `p95=${Math.round(sum.http_req_duration?.['p(95)'] ?? 0)}ms p99=${Math.round(sum.http_req_duration?.['p(99)'] ?? 0)}ms ` +
    `5xx=${sum.status_5xx?.count ?? 0} data_received=${mb(sum.data_received?.count ?? 0)} MB`,
);
console.log(
  '\n| endpoint | p95 (ms) | p99 (ms) | errors | MB |\n|---|---:|---:|---:|---:|',
);
for (const k of Object.keys(sum)
  .filter((k) => k.startsWith('latency_'))
  .sort()) {
  const n = k.slice(8);
  console.log(
    `| ${n} | ${Math.round(sum[k]['p(95)'] ?? 0)} | ${Math.round(sum[k]['p(99)'] ?? 0)} | ${sum[`errors_${n}`]?.count ?? 0} | ${mb(sum[`bytes_${n}`]?.count ?? 0)} |`,
  );
}

// ── containers, Postgres, event loop ──────────────────────────────────────────
const toBytes = (s) => {
  const m = /([\d.]+)\s*([kMG]?i?B)/.exec(s || '');
  if (!m) return 0;
  const u =
    {
      B: 1,
      kB: 1e3,
      KiB: 1024,
      MB: 1e6,
      MiB: 1024 ** 2,
      GB: 1e9,
      GiB: 1024 ** 3,
    }[m[2]] ?? 1;
  return Number(m[1]) * u;
};
const peaks = new Map();
const lastSent = new Map();
for (const line of readFileSync(join(dir, 'samples.csv'), 'utf8')
  .split('\n')
  .slice(1)) {
  const [t, name, cpu, mem, net] = line.split(',');
  if (!name) continue;
  const p = peaks.get(name) ?? { cpu: 0, mem: 0, mbps: 0 };
  p.cpu = Math.max(p.cpu, parseFloat(cpu) || 0);
  p.mem = Math.max(p.mem, toBytes((mem || '').split('/')[0]));
  const sent = toBytes((net || '').split('/')[1]);
  const prev = lastSent.get(name);
  if (prev && Number(t) > prev.t)
    p.mbps = Math.max(
      p.mbps,
      ((sent - prev.sent) * 8) / (Number(t) - prev.t) / 1e6,
    );
  lastSent.set(name, { t: Number(t), sent });
  peaks.set(name, p);
}
console.log(
  '\n| container | peak CPU (% of one core) | peak memory (MB) | peak egress (Mbps) |\n|---|---:|---:|---:|',
);
for (const [n, p] of peaks)
  console.log(
    `| ${n} | ${p.cpu.toFixed(0)} | ${mb(p.mem)} | ${p.mbps.toFixed(1)} |`,
  );

let pgMax = { active: 0, total: 0 };
const byTime = new Map();
for (const line of readFileSync(join(dir, 'pg.csv'), 'utf8')
  .split('\n')
  .slice(1)) {
  const [t, state, count] = line.split(',');
  if (!state) continue;
  const e = byTime.get(t) ?? { active: 0, total: 0 };
  e.total += Number(count);
  if (state === 'active') e.active += Number(count);
  byTime.set(t, e);
}
for (const e of byTime.values())
  pgMax = {
    active: Math.max(pgMax.active, e.active),
    total: Math.max(pgMax.total, e.total),
  };
console.log(
  `\nPG_CONNECTIONS peak_active=${pgMax.active} peak_total=${pgMax.total}`,
);

const api = existsSync(join(dir, 'api.log'))
  ? readFileSync(join(dir, 'api.log'), 'utf8').split('\n')
  : [];
let loopMax = 0;
let cpuMax = 0;
let rssMax = 0;
for (const l of api) {
  const m = /\[PHASE812_RUNTIME\] (\{.*\})/.exec(l);
  if (!m) continue;
  const j = JSON.parse(m[1]);
  loopMax = Math.max(loopMax, j.eventLoopP95Ms);
  cpuMax = Math.max(cpuMax, j.cpuPercent);
  rssMax = Math.max(rssMax, j.rssBytes);
}
const poolTimeouts = api.filter((l) =>
  /Timed out fetching|P2024|P2028|Unable to start a transaction/.test(l),
).length;
console.log(
  `API_RUNTIME event_loop_p95_max=${loopMax.toFixed(0)}ms cpu_max=${cpuMax.toFixed(0)}% rss_max=${mb(rssMax)}MB pool_timeouts=${poolTimeouts}`,
);
