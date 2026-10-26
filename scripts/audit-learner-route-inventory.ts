/**
 * Derive the learner route inventory from the frontend source (spec §10).
 *
 * The historical "47 routes" figure is not trusted: this walks the current
 * Next.js app directory, keeps only learner-reachable routes, and extracts the
 * API surface each route touches by reading the page and the service modules it
 * imports. Admin, auth-plumbing and unreachable files are excluded and the
 * exclusions are reported so the delta is explainable.
 *
 * Read-only. Writes artifacts/learner-route-inventory.json.
 *
 * Usage: npx ts-node scripts/audit-learner-route-inventory.ts
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const FRONTEND =
  process.env.FRONTEND_ROOT ??
  resolve(process.cwd(), '..', 'kltn-breadtrans-frontend-junior');
const APP = join(FRONTEND, 'src', 'app');
const OUT = join(process.cwd(), 'artifacts', 'learner-route-inventory.json');

/** Route groups that are not learner product surface. */
const EXCLUDED_GROUPS = ['(admin)'];
/** Auth plumbing and static legal pages are not product features. */
const AUTH_PLUMBING = new Set([
  '/login',
  '/register',
  '/change-password',
  '/auth/callback',
  '/auth/error',
  '/forgot-password',
  '/reset-password',
]);
const STATIC_CONTENT = new Set(['/help', '/privacy', '/terms']);

const DOMAIN_RULES: Array<[RegExp, string]> = [
  [/^\/(dashboard|student-home|hub|learn)$/, 'Dashboard'],
  [/^\/plans/, 'Plans / Entitlement'],
  [/^\/(courses|my-courses)/, 'Courses'],
  [/^\/flashcard/, 'Flashcards'],
  [/^\/vocabulary/, 'Vocabulary'],
  [/^\/arena/, 'Vocabulary 1v1 Arena'],
  [/^\/listening/, 'Listening'],
  [/^\/speaking/, 'Speaking'],
  [/^\/reading/, 'Reading'],
  [/^\/writing/, 'Writing'],
  [/^\/grammar/, 'Grammar'],
  [/^\/diagnostic/, 'Diagnostic'],
  [/^\/market/, 'Market / Shop'],
  [/^\/pet/, 'Gamification'],
  [/^\/(exams|toeic)/, 'TOEIC'],
  [/^\/classes/, 'Classes'],
  [/^\/(messages|notifications)/, 'Notifications'],
  [/^\//, 'Other'],
];

function domainOf(pattern: string): string {
  for (const [re, domain] of DOMAIN_RULES) if (re.test(pattern)) return domain;
  return 'Other';
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name === 'page.tsx') out.push(full);
  }
  return out;
}

/** Collect endpoint-looking strings from a file. */
function endpointsIn(source: string): string[] {
  const found = new Set<string>();
  const direct =
    /axiosClient\.(get|post|patch|put|delete)\(\s*[`'"]([^`'"]+)[`'"]/g;
  let match: RegExpExecArray | null;
  while ((match = direct.exec(source)))
    found.add(`${match[1].toUpperCase()} ${match[2]}`);
  const templated = /axiosClient\.(get|post|patch|put|delete)\(\s*`([^`]+)`/g;
  while ((match = templated.exec(source)))
    found.add(`${match[1].toUpperCase()} ${match[2]}`);
  return [...found];
}

/** Service modules the page imports from @/lib/api/services. */
function serviceImports(source: string): string[] {
  const out = new Set<string>();
  const re = /from\s+"@\/lib\/api\/services\/([a-zA-Z0-9._-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.add(m[1]);
  return [...out];
}

const MEDIA_HINTS: Array<[RegExp, string]> = [
  [/<audio|new Audio\(|audioRef|AudioContext/, 'audio'],
  [/next\/image|<img|imageUrl|thumbnail|coverImage/, 'image'],
  [/MediaRecorder|getUserMedia/, 'microphone'],
];

const INTERACTION_HINTS: Array<[RegExp, string]> = [
  [/\.play\(\)|audioRef/, 'audio playback'],
  [/useMutation/, 'write/submit'],
  [/MediaRecorder|getUserMedia/, 'recording'],
  [/onSubmit|handleSubmit/, 'form submit'],
  [/router\.push|router\.replace/, 'navigation'],
  [/localStorage|sessionStorage/, 'local draft/state'],
];

async function main() {
  const pages = await walk(APP);
  const routes: Array<Record<string, unknown>> = [];
  const excluded: Array<{ pattern: string; reason: string }> = [];

  for (const file of pages.sort()) {
    const rel = file.slice(APP.length + 1).replace(/\\/g, '/');
    const segments = rel.replace(/\/page\.tsx$/, '').split('/');
    const group = segments.find((s) => s.startsWith('('));
    const pattern =
      '/' +
      segments
        .filter((s) => !s.startsWith('('))
        .join('/')
        .replace(/\[([^\]]+)\]/g, ':$1');
    const normalized = pattern === '/' ? '/' : pattern.replace(/\/$/, '');

    if (group && EXCLUDED_GROUPS.includes(group)) {
      excluded.push({ pattern: normalized, reason: 'admin-only route group' });
      continue;
    }
    if (AUTH_PLUMBING.has(normalized)) {
      excluded.push({
        pattern: normalized,
        reason: 'authentication plumbing, not a learner product feature',
      });
      continue;
    }
    if (STATIC_CONTENT.has(normalized)) {
      excluded.push({
        pattern: normalized,
        reason: 'static legal/help content, no learner data or media',
      });
      continue;
    }

    const source = readFileSync(file, 'utf8');
    const apis = new Set(endpointsIn(source));
    for (const service of serviceImports(source)) {
      const servicePath = join(
        FRONTEND,
        'src',
        'lib',
        'api',
        'services',
        `${service}.ts`,
      );
      if (existsSync(servicePath)) {
        for (const endpoint of endpointsIn(readFileSync(servicePath, 'utf8'))) {
          apis.add(endpoint);
        }
      }
    }

    const mediaTypes = MEDIA_HINTS.filter(([re]) => re.test(source)).map(
      ([, label]) => label,
    );
    const interactions = INTERACTION_HINTS.filter(([re]) =>
      re.test(source),
    ).map(([, label]) => label);
    const isStudent = group === '(student)';
    const dynamic = normalized.includes(':');

    routes.push({
      routeId:
        normalized.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') ||
        'root',
      routePattern: normalized,
      domain: domainOf(normalized),
      component: rel,
      group: group ?? '(root)',
      authRequired: isStudent,
      dynamic,
      apis: [...apis].sort(),
      mediaTypes,
      criticalInteractions: interactions,
      // Priority: media or write paths first, then dynamic detail pages.
      auditPriority:
        mediaTypes.length || interactions.includes('recording')
          ? 'P0'
          : interactions.includes('write/submit')
            ? 'P1'
            : dynamic
              ? 'P2'
              : 'P3',
    });
  }

  const byDomain: Record<string, number> = {};
  for (const route of routes) {
    const d = route.domain as string;
    byDomain[d] = (byDomain[d] ?? 0) + 1;
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      frontendRoot: 'kltn-breadtrans-frontend-junior',
      appDir: 'src/app',
      note: 'Derived from the current app directory, not from the historical count of 47.',
    },
    counts: {
      pagesFound: pages.length,
      learnerRoutes: routes.length,
      excluded: excluded.length,
      byDomain,
      byPriority: routes.reduce<Record<string, number>>((acc, r) => {
        acc[r.auditPriority as string] =
          (acc[r.auditPriority as string] ?? 0) + 1;
        return acc;
      }, {}),
    },
    excluded,
    routes,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`inventory written: ${OUT}`);
  console.log(`pages found        : ${pages.length}`);
  console.log(`learner routes     : ${routes.length}`);
  console.log(`excluded           : ${excluded.length}`);
  console.log(`CURRENT_LEARNER_ROUTE_COUNT=${routes.length}`);
  console.log('\nby domain:');
  for (const [domain, count] of Object.entries(byDomain).sort())
    console.log(`  ${domain.padEnd(26)} ${count}`);
  console.log('\nexcluded:');
  for (const item of excluded)
    console.log(`  ${item.pattern.padEnd(22)} ${item.reason}`);
}

void main().catch((error: unknown) => {
  console.error(
    'Route inventory failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
