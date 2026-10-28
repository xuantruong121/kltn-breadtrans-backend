/**
 * CP60-UX-02 (harness): on the TOEIC exam page the companion pet no longer
 * covers the part checkboxes or the start button at 1366 px; the exam list
 * and a practice catalog still show the pet.
 *
 * Run: npx ts-node --transpile-only scripts/qa/cp60-pet-exam-browser.ts
 */
import { check, failureCount } from './harness-api';
import { FE, studentPage } from './harness-browser';
import { harnessQuery } from './harness-db';

const PET = 'button[aria-label^="Thú cưng đồng hành"]';

void (async () => {
  const lrId = harnessQuery(
    `select id from "Exam" where "variantCode" = 'TOEIC_LR' and "publicationStatus" = 'PUBLISHED' order by id limit 1`,
  )[0]?.[0];
  const { browser, page, issues } = await studentPage('cp60-pet-exam', 1366);
  const petCount = async (path: string) => {
    await page.goto(`${FE}${path}`, {
      waitUntil: 'networkidle',
      timeout: 120_000,
    });
    await page.waitForTimeout(3000);
    return page.locator(PET).count();
  };

  check('the exam list keeps the pet', (await petCount('/exams')) === 1);
  check(
    'the listening catalog keeps the pet',
    (await petCount('/listening')) === 1,
  );
  check(
    `the L&R exam page (${lrId}) shows no pet`,
    (await petCount(`/exams/${lrId}`)) === 0,
  );

  // Every part checkbox and the CTA take a real click: nothing covers them.
  const boxes = page.getByRole('checkbox');
  const n = await boxes.count();
  let clicked = 0;
  for (let i = 0; i < n; i += 1) {
    await boxes
      .nth(i)
      .click({ timeout: 5_000 })
      .then(
        () => (clicked += 1),
        () => undefined,
      );
  }
  check(
    'all seven part checkboxes take a click',
    n === 7 && clicked === 7,
    `(${clicked}/${n})`,
  );
  const cta = page.getByRole('button', {
    name: /Bắt đầu ở chế độ toàn màn hình/,
  });
  const box = await cta.boundingBox();
  const hit = box
    ? await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y);
          return !!el
            ?.closest('button')
            ?.textContent?.includes('Bắt đầu ở chế độ toàn màn hình');
        },
        [box.x + box.width / 2, box.y + box.height / 2],
      )
    : false;
  check('the start button is the top element at its own centre', hit);
  await page.screenshot({
    path: 'artifacts/qa-screens/cp60-exam-lr-no-pet.png',
  });
  check(
    'no server error',
    !issues.some((x) => x.startsWith('api 5')),
    issues.join(' | '),
  );
  await browser.close();
  console.log(`\nCP60_PET_EXAM_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
})();
