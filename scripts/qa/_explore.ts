// Throwaway exploration helper (harness only); deleted after the finalization run.
import { studentPage, FE } from './harness-browser';

(async () => {
  const { browser, page, issues } = await studentPage('explore');
  page.on('response', (r) => {
    if (r.url().includes(':3101') && r.request().method() !== 'GET')
      console.log('  api', r.request().method(), r.url().slice(21), r.status());
  });
  const dump = async (label: string) => {
    const buttons = await page.$$eval('button', (bs) =>
      bs
        .filter((b) => (b as HTMLElement).offsetParent !== null)
        .map(
          (b) =>
            `${(b.textContent ?? '').trim().slice(0, 28)}${b.hasAttribute('disabled') ? '(d)' : ''}`,
        ),
    );
    console.log(
      `[${label}] ${page.url().slice(21)} :: ${buttons.filter(Boolean).slice(0, 45).join(' ; ')}`,
    );
  };
  const steps = process.argv.slice(2);
  await page.goto(FE + steps[0], { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(2500);
  await dump('open');
  for (const label of steps.slice(1)) {
    await page
      .getByRole('button', { name: new RegExp(label) })
      .first()
      .click();
    await page.waitForTimeout(4000);
    await dump(label);
  }
  await page.screenshot({
    path: 'C:/Users/luamo/AppData/Local/Temp/explore.png',
    fullPage: false,
  });
  console.log(
    '5xx:',
    issues.filter((x) => x.startsWith('api 5')),
  );
  await browser.close();
})();
