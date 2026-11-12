/**
 * Chapter 4 screenshots of the report, taken again after the glossary
 * sweep (owner 2026-11-12). Runs on a harness clone of kltn_db so the
 * learner and admin screens show the real seed accounts; it never touches
 * kltn_db. In the clone only, the two accounts get a temporary password
 * copied from a freshly registered harness user.
 *
 * Same frame as the v7 figures: 1440 px wide at device scale 1.5.
 *
 *   HARNESS_DB=<clone> OUT=<dir> npx ts-node --transpile-only scripts/qa/report-ch4-screens.ts
 */
import { chromium, type Page } from 'playwright';
import { newStudent } from './harness-api';
import { FE } from './harness-browser';
import { harnessExec } from './harness-db';

const OUT = process.env.OUT ?? 'artifacts/report-ch4-screens';
const LEARNER = process.env.LEARNER ?? 'student2@breadtrans.com';
const ADMIN = 'admin@breadtrans.com';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function login(page: Page, email: string, password: string) {
  await page.goto(`${FE}/login`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  await page.click('button[aria-controls="email-login-panel"]');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('#email-login-panel button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 60_000,
    waitUntil: 'commit',
  });
}

async function open(page: Page, path: string, settle = 3500) {
  await page.goto(`${FE}${path}`, {
    waitUntil: 'networkidle',
    timeout: 120_000,
  });
  // The Next.js dev indicator is not part of the product.
  await page.addStyleTag({
    content: 'nextjs-portal { display: none !important; }',
  });
  await sleep(settle);
}

/** The box from the block holding `top` to the block holding `bottom`, padded. */
async function blockClip(page: Page, top: string, bottom: string, pad = 25) {
  return page.evaluate(
    ({ top, bottom, pad }) => {
      const wide = (text: string) => {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        let n: Node | null;
        while ((n = walker.nextNode()))
          if (n.textContent?.includes(text)) {
            // The card itself: the first wide ancestor drawn with a border.
            let el = n.parentElement;
            while (
              el &&
              (el.getBoundingClientRect().width < 1000 ||
                getComputedStyle(el).borderTopWidth === '0px')
            )
              el = el.parentElement;
            if (el) return el.getBoundingClientRect();
          }
        throw new Error(`text not found: ${text}`);
      };
      const a = wide(top);
      const b = wide(bottom);
      const y = a.top + window.scrollY - pad;
      return {
        x: Math.max(0, a.left - pad),
        y: Math.max(0, y),
        width: a.width + 2 * pad,
        height: b.bottom + window.scrollY + pad - y,
      };
    },
    { top, bottom, pad },
  );
}

async function main() {
  // A known password, only in the clone.
  const temp = await newStudent('shots');
  harnessExec(
    `update "User" set password = (select password from "User" where id = ${temp.userId}), "mustChangePassword" = false where email in ('${LEARNER}', '${ADMIN}')`,
  );

  const browser = await chromium.launch();
  const learner = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });
  await login(learner, LEARNER, temp.password);

  await open(learner, '/dashboard', 5000);
  await learner.screenshot({
    path: `${OUT}/fig_4_04.png`,
    fullPage: true,
    clip: await blockClip(learner, 'Chào buổi', 'Lộ trình mức'),
  });
  await learner.screenshot({
    path: `${OUT}/fig_4_05.png`,
    fullPage: true,
    clip: await blockClip(learner, 'Tuần này của bạn', 'Bài luyện hôm nay'),
  });

  // The plain study screen the report describes: the learner's own
  // "Không gian" switch turns the forest scene and its sounds off.
  await learner.evaluate(() =>
    localStorage.setItem(
      'breadtrans.study.ambience',
      JSON.stringify({ scene: false, music: false, rain: false, sfx: false }),
    ),
  );
  await open(learner, '/flashcard/1', 4000);
  await learner.screenshot({ path: `${OUT}/fig_4_06.png` });

  await open(learner, '/listening/24', 4000);
  await learner.screenshot({
    path: `${OUT}/fig_4_07.png`,
    clip: { x: 0, y: 0, width: 1440, height: 480 },
  });

  await open(learner, '/speaking/1', 4000);
  await learner.screenshot({ path: `${OUT}/fig_4_08.png` });

  await learner.setViewportSize({ width: 1440, height: 940 });
  await open(learner, '/plans', 4000);
  // 90 days, as in v7: the cards then show the price per 30 days too.
  await learner.getByRole('radio', { name: /90 ngày/ }).click();
  await sleep(1500);
  await learner.screenshot({ path: `${OUT}/fig_4_12.png` });

  await learner.setViewportSize({ width: 1440, height: 900 });
  await open(learner, '/market', 4000);
  await learner.screenshot({ path: `${OUT}/fig_4_13.png` });

  const admin = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });
  await login(admin, ADMIN, temp.password);
  await open(admin, '/admin', 5000);
  await admin.screenshot({ path: `${OUT}/fig_4_14.png` });

  await browser.close();
  console.log(`saved to ${OUT}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
