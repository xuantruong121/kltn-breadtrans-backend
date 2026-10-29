/**
 * CP60.3 (harness): Arena leaderboard avatars fall back to the initial when
 * the image fails to load, keep the image when it loads, and keep the initial
 * when there is no URL. Desktop Chromium 1366 and 1440.
 *
 * Setup on the harness DB: user 177 avatar = an unreachable URL, user 584
 * avatar = the app logo; the rest have none.
 */
import { check, failureCount } from './harness-api';
import { FE, studentPage } from './harness-browser';

void (async () => {
  for (const width of [1366, 1440]) {
    const { browser, page, issues } = await studentPage(
      `cp603-arena-${width}`,
      width,
    );
    await page.goto(`${FE}/arena`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page
      .getByText('Harness fsj-pro')
      .first()
      .waitFor({ timeout: 60_000 })
      .catch(() => undefined);
    await page.waitForTimeout(3000);
    const state = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')];
      return {
        broken: imgs
          .filter(
            (i) =>
              i.complete &&
              i.naturalWidth === 0 &&
              i.getBoundingClientRect().width > 0,
          )
          .map((i) => i.currentSrc || i.src),
        failingUrlStillRendered: imgs.some((i) =>
          i.src.includes('cp603-fails'),
        ),
        logoAvatarLoaded: imgs.some(
          (i) =>
            i.alt === 'Harness fsj-pro' &&
            i.src.includes('/logo.png') &&
            i.naturalWidth > 0,
        ),
      };
    });
    check(
      `@${width} no broken avatar image is visible`,
      state.broken.length === 0,
      JSON.stringify(state.broken),
    );
    check(
      `@${width} the failed avatar URL is replaced by the fallback`,
      !state.failingUrlStillRendered,
    );
    check(`@${width} a loading avatar keeps its image`, state.logoAvatarLoaded);
    const initials = await page
      .locator('div.rounded-full.w-10.h-10')
      .allInnerTexts();
    check(
      `@${width} fallback avatars show the initial letter`,
      initials.filter((t) => t.trim() === 'H').length >= 2,
      `(${initials.map((t) => t.trim() || '·').join(' ')})`,
    );
    await page.screenshot({
      path: `artifacts/qa-screens/cp603-arena-avatar-${width}.png`,
    });
    check(
      `@${width} no page error`,
      !issues.some((x) => x.startsWith('pageerror')),
      issues.filter((x) => x.startsWith('pageerror')).join(' | '),
    );
    await browser.close();
  }
  console.log(`\nCP603_ARENA_AVATAR_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
