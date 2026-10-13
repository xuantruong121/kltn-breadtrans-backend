const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');

const JWT_SECRET =
  '8fe80d1b6eaf0e7874442df29b9fb405564808c20d16ae38be8d658c77fd05f5';
const FRONTEND_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.resolve(
  'D:/Study/KLTN/artifacts/dictation-listening-repair/screenshots',
);

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function runSkipAndLookupQA() {
  console.log('===========================================================');
  console.log('=== STARTING HEADLESS PLAYWRIGHT SKIP & WORD LOOKUP QA ===');
  console.log('===========================================================');

  const timestamp = Date.now();
  const syntheticEmail = `synthetic_skip_lookup_${timestamp}@breadtrans.qa`;
  let syntheticUser = null;

  try {
    // 1. Create synthetic student user
    syntheticUser = await prisma.user.create({
      data: {
        email: syntheticEmail,
        role: 'STUDENT',
        profile: {
          create: {
            fullName: `Synthetic Skip QA Student ${timestamp}`,
          },
        },
      },
      include: { profile: true },
    });
    console.log(
      '[QA Setup] Created synthetic student user:',
      syntheticUser.id,
      syntheticUser.email,
    );

    const deviceId = 'qa-skip-lookup-device';
    const accessToken = jwt.sign(
      {
        sub: syntheticUser.id,
        email: syntheticUser.email,
        role: syntheticUser.role,
        deviceId,
        type: 'access',
        jti: randomUUID(),
      },
      JWT_SECRET,
      { expiresIn: '1d' },
    );

    const authStorage = JSON.stringify({
      state: {
        accessToken,
        refreshToken: accessToken,
        user: {
          id: syntheticUser.id,
          email: syntheticUser.email,
          role: syntheticUser.role,
          profile: syntheticUser.profile,
        },
      },
      version: 0,
    });

    // 2. Launch headless browser
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    // Set auth in localStorage
    console.log('[Browser] Setting up auth session on /login...');
    await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((authJson) => {
      localStorage.setItem('auth-storage-junior', authJson);
    }, authStorage);

    // 3. Navigate to Dictation Quiz 23
    console.log('[Browser] Navigating to /listening/23...');
    await page.goto(`${FRONTEND_URL}/listening/23`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2000);

    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 25000 });
    console.log('[Browser] Found dictation textarea input.');

    // 4. Click "Bỏ qua" button
    console.log('[Action] Clicking "Bỏ qua" (Skip) button...');
    const skipButton = page.locator('button:has-text("Bỏ qua")').first();
    await skipButton.waitFor({ state: 'visible', timeout: 5000 });
    await skipButton.click();

    // Wait for state update
    await page.waitForTimeout(1500);

    // 5. Verify textarea value contains full canonical answer
    const textareaVal = await textarea.inputValue();
    console.log('[Verification] Textarea input value after skip:', `"${textareaVal}"`);
    if (!textareaVal || textareaVal.trim().length === 0) {
      throw new Error('FAILURE: Textarea is still empty after clicking "Bỏ qua"!');
    }
    if (!textareaVal.includes('Hey, Leo') || !textareaVal.includes('library')) {
      throw new Error(`FAILURE: Textarea does not contain expected canonical answer: "${textareaVal}"`);
    }
    console.log('==> SUCCESS: Textarea correctly populated with canonical answer!');

    // 6. Verify Pronunciation section
    const pronunciationCard = page.locator('div.rounded-2xl').filter({ hasText: 'Phát âm (Pronunciation)' }).first();
    await pronunciationCard.waitFor({ state: 'visible', timeout: 5000 });
    const pronunciationText = await pronunciationCard.textContent();
    console.log('[Verification] Pronunciation section content:', pronunciationText);
    if (pronunciationText.includes('(Đang cập nhật phát âm)')) {
      throw new Error('FAILURE: Pronunciation section still shows "(Đang cập nhật phát âm)"!');
    }
    console.log('==> SUCCESS: Pronunciation section shows actual words!');

    // 7. Test clicking a word in Pronunciation to open dictionary popup
    console.log('[Action] Clicking word "library" in Pronunciation section...');
    const wordButton = pronunciationCard.locator('button', { hasText: 'library' }).first();
    await wordButton.waitFor({ state: 'visible', timeout: 5000 });
    await wordButton.click();

    await page.waitForTimeout(1000);

    // Verify WordDictionaryPopup appeared
    const dictionaryPopup = page.locator('div[role="dialog"], div.fixed.inset-0').filter({
      hasText: /Tra từ|Từ điển|library/i
    }).first();
    await dictionaryPopup.waitFor({ state: 'visible', timeout: 5000 });
    console.log('==> SUCCESS: WordDictionaryPopup opened successfully after clicking word!');

    // Take screenshot of the complete state with WordDictionaryPopup
    const screenshotPath = path.join(SCREENSHOT_DIR, 'skip_answer_and_dictionary_popup.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('[Screenshot] Saved proof screenshot to:', screenshotPath);

    await browser.close();
    console.log('\n===========================================================');
    console.log('=== ALL SKIP & PRONUNCIATION WORD LOOKUP CHECKS PASSED ===');
    console.log('===========================================================');
  } catch (err) {
    console.error('[Error in try block]:', err);
    throw err;
  } finally {
    if (syntheticUser) {
      console.log('[QA Teardown] Cleaning up synthetic student user...');
      try {
        await prisma.listeningPracticeAttempt?.deleteMany({ where: { userId: syntheticUser.id } }).catch(() => {});
        await prisma.listeningTranscriptReveal?.deleteMany({ where: { userId: syntheticUser.id } }).catch(() => {});
        await prisma.profile?.deleteMany({ where: { userId: syntheticUser.id } }).catch(() => {});
        await prisma.user?.delete({ where: { id: syntheticUser.id } }).catch(() => {});
      } catch (cleanErr) {
        console.warn('[QA Teardown Warning]:', cleanErr.message);
      }
      console.log('[QA Teardown] Cleanup complete.');
    }
    await prisma.$disconnect();
  }
}

runSkipAndLookupQA().catch((err) => {
  console.error('\n[QA FAILED]', err);
  process.exit(1);
});
