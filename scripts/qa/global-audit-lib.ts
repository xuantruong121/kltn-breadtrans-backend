/**
 * Shared harness for the bounded global learner browser audit.
 *
 * Each phase is a separate short-lived process: it creates its own QA learner,
 * runs its assertions, appends evidence, deletes its learner, and exits. That
 * keeps every run well under the ~64s limits earlier phases kept hitting and
 * means a crash in one phase cannot leave another phase's state behind.
 *
 * Read-only with respect to canonical content. The only rows written are the
 * QA learner and whatever that learner legitimately creates, all removed in a
 * finally block.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as bcrypt from 'bcrypt';
import { chromium, type Browser, type Page } from 'playwright';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';

/**
 * Targets are explicit; there is no default. This audit creates and deletes
 * QA learners directly in the database, so it must never fall back to `.env`
 * (kltn_db) or to the owner's running app (:3000/:3001). CP60.1 found that
 * the old defaults did exactly that.
 *
 *   RECOVERY_FE_BASE_URL       e.g. http://localhost:3100 (harness FE)
 *   SMOKE_BASE_URL             e.g. http://localhost:3101 (harness API)
 *   GLOBAL_AUDIT_DATABASE_URL  the database behind SMOKE_BASE_URL
 *
 * assertAuditTarget() refuses the protected kltn_db cluster unless
 * GLOBAL_AUDIT_PROTECTED_DB=owner-approved is set for an owner-approved run.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name} is required: the global audit has no default target (see global-audit-lib.ts)`,
    );
  return value;
}

/** pg_control_system().system_identifier of the kltn_db cluster. */
const PROTECTED_SYSTEM_IDENTIFIER = '7674533776495505443';

export const FE = requireEnv('RECOVERY_FE_BASE_URL');
export const BE = requireEnv('SMOKE_BASE_URL');
export const EVIDENCE = resolve('artifacts/learner-runtime-qa.jsonl');
export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export const prisma = new PrismaClient({
  datasources: { db: { url: requireEnv('GLOBAL_AUDIT_DATABASE_URL') } },
});

/** Call before the first write: refuses the protected cluster. */
export async function assertAuditTarget() {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT system_identifier::text AS id FROM pg_control_system()`;
  if (
    rows[0]?.id === PROTECTED_SYSTEM_IDENTIFIER &&
    process.env.GLOBAL_AUDIT_PROTECTED_DB !== 'owner-approved'
  )
    throw new Error(
      'GLOBAL_AUDIT_DATABASE_URL is the protected kltn_db cluster; refusing to create QA learners there',
    );
}

/** Markers are phase-scoped so cleanup can assert zero orphans per phase. */
export function makeMarker(phase: string) {
  return `qa-global-${phase.toLowerCase()}-${randomUUID()}`;
}

export type RouteVerdict = 'PASS' | 'FAIL' | 'BLOCKED';

export type Evidence = Record<string, unknown>;

export async function log(phase: string, marker: string, value: Evidence) {
  await mkdir(dirname(EVIDENCE), { recursive: true });
  await appendFile(
    EVIDENCE,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      marker,
      phase: `global-audit-${phase}`,
      ...value,
    })}\n`,
  );
}

export type QaLearner = {
  userId: number;
  email: string;
  password: string;
};

/**
 * A QA learner on a given plan. PLUS/PRO carry the premium entitlements; FREE
 * gets no subscription at all, which is what the entitlement smoke needs.
 */
export async function createQaLearner(
  marker: string,
  tier: 'FREE' | 'PLUS' | 'PRO' = 'PLUS',
  suffix = '',
): Promise<QaLearner> {
  const email = `${marker}${suffix}@breadtrans.local`;
  const password = `Qa-${randomUUID()}-Aa1!`;
  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(password, 10),
      role: Role.STUDENT,
      emailVerifiedAt: new Date(),
      profile: { create: { fullName: `QA global audit ${tier}` } },
    },
  });
  if (tier !== 'FREE') {
    const planVersion = await prisma.planVersion.findFirstOrThrow({
      where: {
        isCurrent: true,
        status: 'PUBLISHED',
        plan: { code: tier, status: 'ACTIVE' },
      },
      select: { id: true },
    });
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planVersionId: planVersion.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
  }
  return { userId: user.id, email, password };
}

/** Deletes a QA learner and everything it owns, in FK-safe order. */
export async function destroyQaLearner(userId: number) {
  const ignore = () => undefined;
  await prisma.toeicAssessmentAttempt
    .deleteMany({ where: { userId } })
    .catch(ignore);
  await prisma.toeicAttempt.deleteMany({ where: { userId } }).catch(ignore);
  await prisma.subscription.deleteMany({ where: { userId } }).catch(ignore);
  await prisma.user.delete({ where: { id: userId } }).catch(ignore);
}

/** Orphan count for this phase's marker prefix; must be 0 after cleanup. */
export async function orphanCount(marker: string) {
  return prisma.user.count({ where: { email: { startsWith: marker } } });
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: CHROME, headless: true });
}

export async function login(page: Page, learner: QaLearner) {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  await page.locator('[aria-controls="email-login-panel"]').click();
  await page.locator('#emailInput').fill(learner.email);
  await page.locator('#passwordInput').fill(learner.password);
  const response = page.waitForResponse(
    (item) =>
      item.url().includes('/auth/login') && item.request().method() === 'POST',
    { timeout: 25_000 },
  );
  await page.locator('#email-login-panel button[type="submit"]').click();
  if ((await response).status() !== 200) throw new Error('AUTH_FAILED');
  await page.waitForFunction(
    () => !location.pathname.startsWith('/login'),
    undefined,
    { timeout: 25_000 },
  );
}

/** Signatures of a broken render that an HTTP 200 would happily hide. */
const ERROR_BOUNDARY = [
  'Application error',
  'client-side exception',
  'Unhandled Runtime Error',
  'This page could not be found',
  'Something went wrong',
];
const RAW_BACKEND_LEAK = [
  '"statusCode":',
  'Internal server error',
  'at Object.<anonymous>',
  'TypeError:',
  'Cannot read properties of undefined',
];

export type RouteExpectation = {
  /** Route pattern for reporting, e.g. /courses/:id */
  pattern: string;
  /** Concrete path to visit. */
  path: string;
  domain: string;
  /** Text that proves this really is the right domain's page. */
  identity: RegExp;
  /** Optional: a primary action the learner must be able to reach. */
  primaryAction?: RegExp;
  /** Routes that legitimately render an empty state rather than content. */
  emptyStateAllowed?: boolean;
};

export type RouteResult = {
  pattern: string;
  path: string;
  domain: string;
  verdict: RouteVerdict;
  httpStatus: number | null;
  identityFound: boolean;
  primaryActionFound: boolean | null;
  errorBoundary: string | null;
  backendLeak: string | null;
  stillLoading: boolean;
  textLength: number;
  notes?: string;
};

/**
 * The render gate from §8: a 200 is not enough. The page must settle, prove
 * its own identity, and show neither an error boundary nor a raw backend
 * exception nor a permanent spinner.
 */
export async function auditRoute(
  page: Page,
  expectation: RouteExpectation,
): Promise<RouteResult> {
  let httpStatus: number | null = null;
  const result: RouteResult = {
    pattern: expectation.pattern,
    path: expectation.path,
    domain: expectation.domain,
    verdict: 'BLOCKED',
    httpStatus: null,
    identityFound: false,
    primaryActionFound: null,
    errorBoundary: null,
    backendLeak: null,
    stillLoading: false,
    textLength: 0,
  };
  try {
    const response = await page.goto(`${FE}${expectation.path}`, {
      waitUntil: 'networkidle',
      timeout: 35_000,
    });
    httpStatus = response?.status() ?? null;
    result.httpStatus = httpStatus;

    // Settle: wait for any heading or main landmark, then let hydration finish.
    await page
      .locator('h1, h2, main')
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => undefined);
    await page.waitForTimeout(900);

    const body = await page.locator('body').innerText();
    result.textLength = body.trim().length;

    result.errorBoundary =
      ERROR_BOUNDARY.find((needle) => body.includes(needle)) ?? null;
    result.backendLeak =
      RAW_BACKEND_LEAK.find((needle) => body.includes(needle)) ?? null;

    // A spinner still on screen after settling means a permanent loading state.
    result.stillLoading = await page.evaluate(() => {
      const spinners = document.querySelectorAll('.animate-spin');
      if (!spinners.length) return false;
      const text = document.body.innerText.trim();
      // A spinner inside an otherwise populated page is a local control.
      return text.length < 120;
    });

    result.identityFound = expectation.identity.test(body);
    if (expectation.primaryAction) {
      const actionInText = expectation.primaryAction.test(body);
      const actionAsControl = await page
        .getByRole('button', { name: expectation.primaryAction })
        .count()
        .catch(() => 0);
      const actionAsLink = await page
        .getByRole('link', { name: expectation.primaryAction })
        .count()
        .catch(() => 0);
      result.primaryActionFound =
        actionInText || actionAsControl > 0 || actionAsLink > 0;
    }

    const ok =
      httpStatus !== null &&
      httpStatus < 400 &&
      !result.errorBoundary &&
      !result.backendLeak &&
      !result.stillLoading &&
      result.identityFound &&
      (result.primaryActionFound ?? true) &&
      (expectation.emptyStateAllowed ? true : result.textLength > 0);
    result.verdict = ok ? 'PASS' : 'FAIL';
  } catch (error) {
    result.verdict = 'BLOCKED';
    result.notes = error instanceof Error ? error.message : String(error);
  }
  return result;
}

/** Viewports for the responsive smoke (§9). */
export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 860 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

export type ResponsiveResult = {
  path: string;
  viewport: string;
  horizontalOverflow: boolean;
  overflowPx: number;
  tinyText: number;
  offscreenCta: number;
  verdict: RouteVerdict;
};

export async function auditResponsive(
  page: Page,
  path: string,
  viewport: (typeof VIEWPORTS)[number],
): Promise<ResponsiveResult> {
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.goto(`${FE}${path}`, {
    waitUntil: 'networkidle',
    timeout: 35_000,
  });
  await page
    .locator('h1, h2, main')
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => undefined);
  await page.waitForTimeout(700);

  const measured = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflowPx = doc.scrollWidth - window.innerWidth;
    // Body copy under 12px is unreadable on a phone.
    let tinyText = 0;
    for (const node of Array.from(
      document.querySelectorAll('p, span, li, div'),
    )) {
      const text = (node.textContent ?? '').trim();
      if (text.length < 12) continue;
      if (node.children.length) continue;
      const size = parseFloat(getComputedStyle(node).fontSize || '16');
      if (size > 0 && size < 12) tinyText += 1;
    }
    // A primary control whose box starts beyond the viewport is unreachable.
    let offscreenCta = 0;
    for (const node of Array.from(
      document.querySelectorAll('button, a[href]'),
    )) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.left >= window.innerWidth + 1 || rect.right <= -1) {
        offscreenCta += 1;
      }
    }
    return { overflowPx, tinyText, offscreenCta };
  });

  // 1px of overflow is rounding; a real break is wider.
  const horizontalOverflow = measured.overflowPx > 2;
  return {
    path,
    viewport: viewport.name,
    horizontalOverflow,
    overflowPx: measured.overflowPx,
    tinyText: measured.tinyText,
    offscreenCta: measured.offscreenCta,
    verdict:
      !horizontalOverflow && measured.offscreenCta === 0 ? 'PASS' : 'FAIL',
  };
}

/**
 * Forward-navigation scroll check (§10): scroll the origin deeply, navigate by
 * clicking as a learner would, then measure the destination's scroll.
 */
export async function auditForwardScroll(
  page: Page,
  origin: string,
  clickName: RegExp,
  expectedUrl: RegExp,
): Promise<{
  origin: string;
  originScrollY: number;
  destination: string | null;
  destinationScrollY: number | null;
  verdict: RouteVerdict;
  notes?: string;
}> {
  try {
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.goto(`${FE}${origin}`, {
      waitUntil: 'networkidle',
      timeout: 35_000,
    });
    await page
      .locator('h1, h2, main')
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => undefined);
    await page.waitForTimeout(700);
    await page.evaluate(() =>
      window.scrollTo(0, Math.min(900, document.documentElement.scrollHeight)),
    );
    await page.waitForTimeout(350);
    const originScrollY = await page.evaluate(() => window.scrollY);
    if (originScrollY === 0) {
      return {
        origin,
        originScrollY,
        destination: null,
        destinationScrollY: null,
        verdict: 'BLOCKED',
        notes: 'origin page is not scrollable at this viewport',
      };
    }
    const target = page
      .getByRole('link', { name: clickName })
      .or(page.getByRole('button', { name: clickName }));
    if (!(await target.count())) {
      return {
        origin,
        originScrollY,
        destination: null,
        destinationScrollY: null,
        verdict: 'BLOCKED',
        notes: 'no matching navigation control found',
      };
    }
    await target.first().click();
    await page.waitForURL(expectedUrl, { timeout: 25_000 });
    await page
      .locator('h1, h2, main')
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => undefined);
    await page.waitForTimeout(800);
    const destinationScrollY = await page.evaluate(() => window.scrollY);
    return {
      origin,
      originScrollY,
      destination: new URL(page.url()).pathname,
      destinationScrollY,
      verdict: destinationScrollY <= 2 ? 'PASS' : 'FAIL',
    };
  } catch (error) {
    return {
      origin,
      originScrollY: -1,
      destination: null,
      destinationScrollY: null,
      verdict: 'BLOCKED',
      notes: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Same-page interaction must not reset document scroll (§11). */
export async function auditSamePageScroll(
  page: Page,
  path: string,
  controlName: RegExp,
  label: string,
): Promise<{
  path: string;
  interaction: string;
  before: number;
  after: number;
  verdict: RouteVerdict;
  notes?: string;
}> {
  try {
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.goto(`${FE}${path}`, {
      waitUntil: 'networkidle',
      timeout: 35_000,
    });
    await page
      .locator('h1, h2, main')
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => undefined);
    await page.waitForTimeout(700);
    await page.evaluate(() =>
      window.scrollTo(0, Math.min(700, document.documentElement.scrollHeight)),
    );
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.scrollY);
    if (before === 0) {
      return {
        path,
        interaction: label,
        before,
        after: 0,
        verdict: 'BLOCKED',
        notes: 'page not scrollable',
      };
    }
    const control = page
      .getByRole('button', { name: controlName })
      .or(page.getByRole('tab', { name: controlName }));
    if (!(await control.count())) {
      return {
        path,
        interaction: label,
        before,
        after: before,
        verdict: 'BLOCKED',
        notes: 'control not found',
      };
    }
    await control.first().click();
    await page.waitForTimeout(1100);
    const after = await page.evaluate(() => window.scrollY);
    // Staying put, or shifting slightly as content reflows, is acceptable;
    // snapping back to the very top is the regression being hunted.
    return {
      path,
      interaction: label,
      before,
      after,
      verdict: after > 2 ? 'PASS' : 'FAIL',
    };
  } catch (error) {
    return {
      path,
      interaction: label,
      before: -1,
      after: -1,
      verdict: 'BLOCKED',
      notes: error instanceof Error ? error.message : String(error),
    };
  }
}
