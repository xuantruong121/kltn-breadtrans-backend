/**
 * Responsive measurement of every page (owner 2026-11-10: "đo toàn bộ
 * responsive trên các trang"). Harness only (FE :3100, BE :3101).
 *
 * Three roles: a guest; student2 of the harness clone (it has TOEIC and
 * assessment history, so result pages have data; its password is reset in
 * the clone only); a fresh ADMIN. Every route under src/app is visited at
 * eight viewports. Dynamic routes are filled from links seen on the pages,
 * else from the clone's rows; a route that cannot be filled is NOT_RUN.
 *
 * Measured in the browser, per page and viewport:
 *   sideways     the page itself scrolls sideways (the document is wider
 *                than the screen; body has overflow-x: clip, so content past
 *                the edge is usually cut off rather than scrollable)
 *   offscreen    visible elements past the screen's edge that no box of
 *                their own clips or scrolls (cut off, or the cause of sideways)
 *   clipped      text or controls partly cut off by a box with overflow
 *                hidden/clip that does not scroll (a toolbar whose last
 *                button is hidden); empty decoration is not counted
 *   spill        text wider than its own box, overflowing it
 *   tapTargets   on screens under 768 px: controls smaller than 24x24 px
 *                (WCAG 2.5.8), inline links in running text excepted
 *   tinyText     visible text under 11 px
 * A regex or a count of zero is what was measured, not proof the page is
 * right: screenshots at 390 and 1366 (and of every page with a finding) are
 * kept for review.
 *
 *   QA_FE_DIR=<frontend repo> HARNESS_DB=<db> [SHOTS=<dir>] [OUT=<json>]
 *   [ONLY=role] [ROUTES=/route,/route/[id]]
 *     npx ts-node --transpile-only scripts/qa/finalization-responsive-crawl.ts
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import * as bcrypt from 'bcrypt';
import { chromium, type Browser, type Page } from 'playwright';

import { BE, newAdmin } from './harness-api';
import { FE } from './harness-browser';
import { harnessExec, harnessQuery } from './harness-db';

const SHOTS = process.env.SHOTS ?? 'artifacts/finalization/evidence/responsive';
const OUT = process.env.OUT ?? `${SHOTS}/responsive-crawl.json`;
const VIEWPORTS: [number, number][] = [
  [320, 568],
  [360, 740],
  [390, 844],
  [412, 915],
  [768, 1024],
  [1024, 768],
  [844, 390],
  [1366, 900],
];
const SHOT_ALWAYS = new Set(['390x844', '1366x900']);

type Role = 'guest' | 'student' | 'admin';
type Finding = {
  role: Role;
  route: string;
  url: string;
  finalUrl: string;
  viewport: string;
  sideways: boolean;
  offscreen: string[];
  clipped: string[];
  spill: string[];
  tapTargets: string[];
  tinyText: number;
  error?: string;
};

/** Every page route under one route group (or the app root for loose ones). */
function routes(feDir: string): Record<Role, string[]> {
  const found: string[] = [];
  const app = join(feDir, 'src', 'app');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'page.tsx') {
        const rel = relative(app, dir).split(sep);
        found.push(
          `/${rel.filter((p) => !p.startsWith('(')).join('/')}`.replace(
            /\/$/,
            '',
          ) || '/',
        );
      }
    }
  };
  walk(app);
  const uniq = [...new Set(found)].sort();
  const guest = [
    '/',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/help',
    '/privacy',
    '/terms',
    '/auth/error',
  ].filter((r) => uniq.includes(r));
  // Not pages a learner or admin opens by link: OAuth return, the dropped teacher role.
  const skip = new Set(['/auth/callback', '/activate-teacher']);
  return {
    guest,
    admin: uniq.filter((r) => r.startsWith('/admin')),
    student: uniq.filter(
      (r) =>
        !r.startsWith('/admin') &&
        !guest.includes(r) &&
        !skip.has(r) &&
        !r.startsWith('/teacher'),
    ),
  };
}

/** Measures the page as it is now. Runs in the browser. */
function measure(): Omit<
  Finding,
  'role' | 'route' | 'url' | 'finalUrl' | 'viewport' | 'error'
> {
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const cs = getComputedStyle(el);
    return (
      cs.visibility !== 'hidden' &&
      cs.display !== 'none' &&
      Number(cs.opacity) > 0.05 &&
      !el.closest('[aria-hidden="true"],[inert]')
    );
  };
  const name = (el: Element) => {
    const cls =
      typeof (el as HTMLElement).className === 'string'
        ? (el as HTMLElement).className
        : '';
    const text = ((el as HTMLElement).innerText ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, 40);
    const r = el.getBoundingClientRect();
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls.split(/\s+/).slice(0, 4).join('.')}` : ''} [${Math.round(r.left)}..${Math.round(r.right)}]${text ? ` "${text}"` : ''}`;
  };
  // A box of its own that clips or scrolls sideways, and sits on screen.
  const ownClip = (el: Element) => {
    for (
      let p = el.parentElement;
      p && p !== document.body && p !== doc;
      p = p.parentElement
    ) {
      const o = getComputedStyle(p).overflowX;
      if (o !== 'visible') {
        const pr = p.getBoundingClientRect();
        if (pr.left >= -1 && pr.right <= vw + 1) return true;
      }
    }
    return false;
  };
  const all = [...document.body.querySelectorAll('*')].filter(
    (el) => !(el.closest('svg') && el.tagName.toLowerCase() !== 'svg'),
  );
  const off = all.filter((el) => {
    const r = el.getBoundingClientRect();
    return (r.right > vw + 1 || r.left < -1) && shown(el) && !ownClip(el);
  });
  const offSet = new Set(off);
  const offscreen = off
    .filter((el) => !offSet.has(el.parentElement as Element))
    .slice(0, 8)
    .map(name);

  // Partly cut by a box that hides overflow and cannot be scrolled.
  const control =
    'a[href],button,input,select,textarea,[role=button],[role=tab]';
  const hasText = (el: Element) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
  const clipBox = (el: Element) => {
    for (let p = el.parentElement; p && p !== doc; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const o = cs.overflowX;
      // Cut on purpose with an ellipsis ("truncate"): not a defect.
      if (cs.textOverflow === 'ellipsis') return null;
      if (o === 'hidden' || o === 'clip') return p;
      if (o === 'auto' || o === 'scroll') return null;
    }
    return null;
  };
  const cut = all.filter((el) => {
    if (!shown(el) || !(hasText(el) || el.matches(control))) return false;
    if (getComputedStyle(el).pointerEvents === 'none') return false;
    const box = clipBox(el);
    if (!box) return false;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    // Against the box's own edges: the screen edge is the offscreen check's
    // job, and a card half-scrolled in a carousel is not cut by its box.
    // Partly inside only: wholly outside is a carousel slide or a closed drawer.
    return (
      (r.right > b.right + 2 && r.left < b.right) ||
      (r.left < b.left - 2 && r.right > b.left)
    );
  });
  const cutSet = new Set(cut);
  const clipped = cut
    .filter((el) => !cutSet.has(el.parentElement as Element))
    .slice(0, 8)
    .map(name);

  const spill = all
    .filter((el) => {
      const h = el as HTMLElement;
      if (!shown(el) || h.clientWidth === 0) return false;
      if (
        ![...el.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent!.trim(),
        )
      )
        return false;
      const cs = getComputedStyle(el);
      return (
        cs.overflowX === 'visible' &&
        cs.display !== 'inline' &&
        h.scrollWidth > h.clientWidth + 2
      );
    })
    .slice(0, 8)
    .map(name);

  const tapTargets =
    vw < 768
      ? [
          ...document.querySelectorAll(
            'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=switch],[role=checkbox]',
          ),
        ]
          .filter((el) => {
            if (!shown(el)) return false;
            if (el.tagName === 'A' && el.parentElement?.closest('p,li'))
              return false;
            const r = el.getBoundingClientRect();
            return r.width < 24 || r.height < 24;
          })
          .slice(0, 8)
          .map(name)
      : [];

  let tinyText = 0;
  for (const el of all) {
    if (!shown(el)) continue;
    if (
      ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())
    )
      continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 11) tinyText += 1;
  }
  return {
    sideways: doc.scrollWidth > vw + 1,
    offscreen,
    clipped,
    spill,
    tapTargets,
    tinyText,
  };
}

async function login(page: Page, email: string, password: string) {
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 180_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
  });
}

async function settle(page: Page, url: string) {
  try {
    await page.goto(`${FE}${url}`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
  } catch {
    // Canvases, sockets and polling never go idle; the page has loaded.
  }
  await page.waitForTimeout(900);
}

const pattern = (route: string) =>
  new RegExp(`^${route.replace(/\[[^\]]+\]/g, '[^/?#]+')}$`);

/** Dynamic routes from the links seen, else from the clone. */
function fill(
  dynamic: string[],
  hrefs: Set<string>,
  fallback: Record<string, string | undefined>,
) {
  const urls = new Map<string, string>();
  for (const route of dynamic) {
    const re = pattern(route);
    const seen = [...hrefs].find((h) => re.test(h) && !h.endsWith('/new'));
    const url = seen ?? fallback[route];
    if (url) urls.set(route, url);
  }
  return urls;
}

const one = (sql: string) => harnessQuery(sql)[0]?.[0];

function studentFallback(userId: number): Record<string, string | undefined> {
  const toeic = one(
    `select id from "ToeicAttempt" where "userId" = ${userId} order by id desc limit 1`,
  );
  const assess = harnessQuery(
    `select "assessmentId", id from "ToeicAssessmentAttempt" where "userId" = ${userId} order by id desc limit 1`,
  )[0];
  const sub = one(
    `select id from "Submission" where "userId" = ${userId} order by id desc limit 1`,
  );
  return {
    '/toeic/results/[attemptId]': toeic && `/toeic/results/${toeic}`,
    '/toeic/review/[attemptId]': toeic && `/toeic/review/${toeic}`,
    '/toeic/attempts/[attemptId]': toeic && `/toeic/attempts/${toeic}`,
    '/toeic/assessments/[id]/attempts/[attemptId]':
      assess && `/toeic/assessments/${assess[0]}/attempts/${assess[1]}`,
    '/toeic/assessments/[id]/attempts/[attemptId]/result':
      assess && `/toeic/assessments/${assess[0]}/attempts/${assess[1]}/result`,
    '/exams/submissions/[id]': sub && `/exams/submissions/${sub}`,
    '/gate/[skill]': '/gate/listening',
  };
}

async function crawl(
  browser: Browser,
  role: Role,
  list: string[],
  auth: { email: string; password: string } | null,
  fallback: Record<string, string | undefined>,
  results: Finding[],
  notRun: string[],
) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  if (auth) await login(page, auth.email, auth.password);
  const fixed = list.filter((r) => !r.includes('['));
  const dynamic = list.filter((r) => r.includes('['));
  // First pass: collect links to fill the dynamic routes.
  const hrefs = new Set<string>();
  for (const route of fixed) {
    await settle(page, route);
    for (const h of await page.$$eval('a[href]', (as) =>
      as.map((a) => a.getAttribute('href') ?? ''),
    ))
      if (h.startsWith('/')) hrefs.add(h.split(/[?#]/)[0]);
  }
  const filled = fill(dynamic, hrefs, fallback);
  // ROUTES=/a,/b/[id]: measure only these (after a fix). Every page is still
  // visited once above, so dynamic routes are filled the same way.
  const pick = process.env.ROUTES?.split(',');
  for (const route of dynamic)
    if (!filled.has(route) && (!pick || pick.includes(route)))
      notRun.push(`${role} ${route}`);
  const targets: [string, string][] = [
    ...fixed.map((r): [string, string] => [r, r]),
    ...[...filled.entries()],
  ].filter(([route]) => !pick || pick.includes(route));
  for (const [w, h] of VIEWPORTS) {
    const vp = `${w}x${h}`;
    await page.setViewportSize({ width: w, height: h });
    for (const [route, url] of targets) {
      const base: Finding = {
        role,
        route,
        url,
        finalUrl: '',
        viewport: vp,
        sideways: false,
        offscreen: [],
        clipped: [],
        spill: [],
        tapTargets: [],
        tinyText: 0,
      };
      try {
        await settle(page, url);
        // A client redirect can swap the document mid-measure: wait, retry once.
        const m = await page.evaluate(measure).catch(async () => {
          await page.waitForTimeout(2_000);
          return page.evaluate(measure);
        });
        const f = { ...base, ...m, finalUrl: page.url().replace(FE, '') };
        results.push(f);
        const bad =
          f.sideways ||
          f.offscreen.length > 0 ||
          f.clipped.length > 0 ||
          f.spill.length > 0;
        if (bad || SHOT_ALWAYS.has(vp)) {
          const file = `${role}${route.replace(/[/[\]]/g, '_')}-${vp}.png`;
          await page
            .screenshot({ path: `${SHOTS}/${file}` })
            .catch(() => undefined);
        }
        console.log(
          `${bad ? 'FIND' : 'ok  '} ${role} ${vp} ${url}${f.sideways ? ' SIDEWAYS' : ''}${f.offscreen.length ? ` off=${f.offscreen.length}` : ''}${f.clipped.length ? ` clip=${f.clipped.length}` : ''}${f.spill.length ? ` spill=${f.spill.length}` : ''}${f.tapTargets.length ? ` tap=${f.tapTargets.length}` : ''}`,
        );
      } catch (e) {
        results.push({ ...base, error: String(e).slice(0, 200) });
        console.log(`ERR  ${role} ${vp} ${url} ${String(e).slice(0, 120)}`);
      }
    }
  }
  await context.close();
}

void (async () => {
  const feDir = process.env.QA_FE_DIR;
  if (!feDir) throw new Error('QA_FE_DIR is required');
  if (!FE.includes('localhost:3100') || !BE.includes('localhost:3101'))
    throw new Error('REFUSED: this crawl only runs on the harness');
  const only = process.env.ONLY;
  const all = routes(feDir);

  const results: Finding[] = [];
  const notRun: string[] = [];
  const browser = await chromium.launch();

  if (!only || only === 'guest')
    await crawl(browser, 'guest', all.guest, null, {}, results, notRun);

  if (!only || only === 'student') {
    // student2 of the clone: known password in the clone only (never kltn_db).
    const row = harnessQuery(
      `select id, email from "User" where email = 'student2@breadtrans.com'`,
    )[0];
    if (!row) throw new Error('student2 not in the harness clone');
    const password = 'Harness-Responsive-1!';
    harnessExec(
      `update "User" set password = '${bcrypt.hashSync(password, 10)}' where id = ${row[0]}`,
    );
    await crawl(
      browser,
      'student',
      all.student,
      { email: row[1], password },
      studentFallback(Number(row[0])),
      results,
      notRun,
    );
  }

  if (!only || only === 'admin') {
    const admin = await newAdmin('responsive-crawl');
    await crawl(browser, 'admin', all.admin, admin, {}, results, notRun);
  }

  await browser.close();
  writeFileSync(
    OUT,
    JSON.stringify({ viewports: VIEWPORTS, notRun, results }, null, 2),
  );
  const pages = new Set(results.map((r) => `${r.role} ${r.route}`)).size;
  console.log(
    `\nPAGES ${pages} MEASUREMENTS ${results.length} NOT_RUN ${notRun.length} -> ${OUT}`,
  );
})();
