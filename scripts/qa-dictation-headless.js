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

async function runDictationHeadlessQA() {
  console.log('====================================================');
  console.log('=== STARTING HEADLESS PLAYWRIGHT DICTATION QA ===');
  console.log('====================================================');

  const timestamp = Date.now();
  const syntheticEmail = `synthetic_dictation_qa_${timestamp}@breadtrans.qa`;
  let syntheticUser = null;
  const networkAudit = [];

  try {
    // 1. Create synthetic student user
    syntheticUser = await prisma.user.create({
      data: {
        email: syntheticEmail,
        role: 'STUDENT',
        profile: {
          create: {
            fullName: `Synthetic Dictation QA Student ${timestamp}`,
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

    const deviceId = 'qa-dictation-headless-device';
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

    // 2. Launch headless browser (Playwright in headless mode)
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    // Intercept network requests to /questions/*/check
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/questions/') && url.includes('/check')) {
        try {
          const status = response.status();
          const json = await response.json();
          networkAudit.push({
            url,
            status,
            data: json.data || json,
            timestamp: new Date().toISOString(),
          });
          console.log(
            '[Network Intercept] Check response:',
            status,
            'isCorrect:',
            json.data?.isCorrect,
            'verifiedPrefix:',
            json.data?.verifiedPrefix,
            'nextWordMask:',
            json.data?.nextWordMask,
          );
        } catch {
          // not json
        }
      }
    });

    // Set auth in localStorage
    console.log('[Browser] Setting up auth session on /login...');
    await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((authJson) => {
      localStorage.setItem('auth-storage-junior', authJson);
    }, authStorage);

    // 3. Navigate to Dictation Quiz 23
    console.log('[Browser] Navigating to /listening/23...');
    await page.goto(`${FRONTEND_URL}/listening/23`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(1500);

    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 25000 });
    console.log('[Browser] Found dictation textarea input.');

    // =========================================================================
    // SCENARIO 1: Empty Input Check
    // Target: "Hey, Leo. Are we still meeting at the library on Saturday morning?"
    // Input: ""
    // Expected: First word "Hey," masked (3 letters) -> "***,"
    // =========================================================================
    console.log('\n--- SCENARIO 1: Empty Input ---');
    await textarea.fill('');
    await page.waitForTimeout(200);

    const checkButton = page.locator('button:has-text("Kiểm tra")').first();
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/check'), {
        timeout: 10000,
      }),
      checkButton.click(),
    ]);
    await page.waitForTimeout(1000);

    const emptyRes = networkAudit[networkAudit.length - 1];
    if (emptyRes.data.isCorrect !== false) {
      throw new Error(
        'Scenario 1 Failed: Empty input must not be marked correct.',
      );
    }
    if (emptyRes.data.correctAnswer !== undefined) {
      throw new Error(
        'SECURITY VIOLATION: correctAnswer returned on failed check!',
      );
    }
    if (!emptyRes.data.nextWordMask.includes('***')) {
      throw new Error(
        `Scenario 1 Failed: Expected 3-letter mask for "Hey,", got ${emptyRes.data.nextWordMask}`,
      );
    }

    const feedbackPanel1 = page.locator('div[role="alert"]').first();
    await feedbackPanel1.waitFor({ state: 'visible', timeout: 5000 });
    const feedbackText1 = await feedbackPanel1.textContent();
    console.log('[DOM Audit S1] Feedback panel text:', feedbackText1);

    if (
      feedbackText1.includes('Thiếu từ') ||
      feedbackText1.includes('Chưa đúng')
    ) {
      throw new Error(
        'UX VIOLATION: Found inline "Thiếu từ" or "Chưa đúng" in reconstructed sentence!',
      );
    }
    if (
      feedbackText1.includes('vị trí cần kiểm tra') &&
      !feedbackText1.includes('vị trí tiếp theo')
    ) {
      throw new Error('UX VIOLATION: Found old multi-error count in feedback!');
    }

    const remainingEl1 = page
      .locator('[data-testid="dictation-remaining-masks"]')
      .first();
    const hasRemaining1 = await remainingEl1.isVisible();
    console.log('[DOM Audit S1] Gray remaining masks visible:', hasRemaining1);
    if (!hasRemaining1) {
      throw new Error(
        'Expected gray remaining masks element in DOM, but not visible.',
      );
    }
    const remainingText1 = await remainingEl1.textContent();
    console.log(
      '[DOM Audit S1] Gray remaining masks text:',
      remainingText1.trim(),
    );

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01_desktop_empty_input.png'),
    });
    console.log('[Screenshot] Saved 01_desktop_empty_input.png');

    // Test "Xem đáp án" button
    const revealBtn = page.locator('button:has-text("Xem đáp án")').first();
    const hasRevealBtn = await revealBtn.isVisible();
    console.log('[DOM Audit] "Xem đáp án" button visible:', hasRevealBtn);
    if (hasRevealBtn) {
      console.log('[DOM Audit] Clicking "Xem đáp án"...');
      await revealBtn.click();
      await page.waitForTimeout(1000);
      const revealedSentenceEl = page
        .locator('[data-testid="dictation-revealed-sentence"]')
        .first();
      await revealedSentenceEl.waitFor({ state: 'visible', timeout: 5000 });
      const revealedText = await revealedSentenceEl.textContent();
      console.log(
        '[DOM Audit] Revealed full sentence text:',
        revealedText.trim(),
      );
      if (
        !revealedText.includes(
          'Hey, Leo. Are we still meeting at the library on Saturday morning?',
        )
      ) {
        throw new Error(
          `Reveal Failed: Expected full sentence, got "${revealedText.trim()}"`,
        );
      }
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '01b_reveal_full_answer.png'),
      });
      console.log('[Screenshot] Saved 01b_reveal_full_answer.png');

      const hideBtn = page.locator('button:has-text("Ẩn đáp án")').first();
      await hideBtn.click();
      await page.waitForTimeout(500);
      console.log(
        '[DOM Audit] Successfully toggled back from "Ẩn đáp án" to progressive mask.',
      );
    }

    // =========================================================================
    // STEP 1: Single Word "hey" -> textarea becomes "Hey,"
    // =========================================================================
    console.log(
      '\n--- STEP 1: Single Word "hey" -> Textarea becomes "Hey," ---',
    );
    await textarea.fill('hey');
    await page.waitForTimeout(300);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/check'), {
        timeout: 10000,
      }),
      textarea.press('Enter'),
    ]);
    await page.waitForTimeout(1000);

    const inputVal1 = await textarea.inputValue();
    console.log(
      '[DOM Audit Step 1] Textarea auto-canonicalized value:',
      inputVal1,
    );
    if (inputVal1 !== 'Hey,') {
      throw new Error(
        `Step 1 Failed: Expected textarea "Hey,", got "${inputVal1}"`,
      );
    }

    const sentenceEl1 = page
      .locator('[data-testid="dictation-progressive-sentence"]')
      .first();
    const sentenceText1 = await sentenceEl1.textContent();
    console.log('[DOM Audit Step 1] Progressive sentence:', sentenceText1);
    if (!sentenceText1.includes('Hey,')) {
      throw new Error(
        `Step 1 Failed: DOM sentence does not contain "Hey,": "${sentenceText1}"`,
      );
    }

    // =========================================================================
    // STEP 2: Short Correct Prefix ("Hey, leo") -> textarea becomes "Hey, Leo."
    // =========================================================================
    console.log('\n--- STEP 2: "Hey, leo" -> Textarea becomes "Hey, Leo." ---');
    await textarea.fill('Hey, leo');
    await page.waitForTimeout(300);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/check'), {
        timeout: 10000,
      }),
      textarea.press('Enter'),
    ]);
    await page.waitForTimeout(1000);

    const inputVal2 = await textarea.inputValue();
    console.log(
      '[DOM Audit Step 2] Textarea auto-canonicalized value:',
      inputVal2,
    );
    if (inputVal2 !== 'Hey, Leo.') {
      throw new Error(
        `Step 2 Failed: Expected textarea "Hey, Leo.", got "${inputVal2}"`,
      );
    }

    const s2Res = networkAudit[networkAudit.length - 1];
    if (s2Res.data.verifiedPrefix !== 'Hey, Leo.') {
      throw new Error(
        `Scenario 2 Failed: Expected verifiedPrefix "Hey, Leo.", got "${s2Res.data.verifiedPrefix}"`,
      );
    }
    if (s2Res.data.nextWordMask !== '***') {
      throw new Error(
        `Scenario 2 Failed: Expected nextWordMask "***" (Are = 3 letters), got "${s2Res.data.nextWordMask}"`,
      );
    }

    const sentenceEl2 = page
      .locator('[data-testid="dictation-progressive-sentence"]')
      .first();
    const sentenceText2 = await sentenceEl2.textContent();
    console.log('[DOM Audit S2] Progressive sentence:', sentenceText2);

    if (!sentenceText2.includes('Hey, Leo.')) {
      throw new Error(
        `Scenario 2 Failed: DOM sentence does not contain "Hey, Leo.": "${sentenceText2}"`,
      );
    }
    if (!sentenceText2.includes('***')) {
      throw new Error(
        `Scenario 2 Failed: DOM sentence does not contain "***": "${sentenceText2}"`,
      );
    }
    if (
      sentenceText2.includes('Are') ||
      sentenceText2.includes('meeting') ||
      sentenceText2.includes('library')
    ) {
      throw new Error(
        'LEAK VIOLATION: Downstream target words revealed in DOM!',
      );
    }

    const remainingEl2 = page
      .locator('[data-testid="dictation-remaining-masks"]')
      .first();
    const hasRemaining2 = await remainingEl2.isVisible();
    console.log('[DOM Audit S2] Gray remaining masks visible:', hasRemaining2);
    if (!hasRemaining2) {
      throw new Error(
        'Expected gray remaining masks element in DOM in Scenario 2, but not visible.',
      );
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02_desktop_short_prefix.png'),
    });
    console.log('[Screenshot] Saved 02_desktop_short_prefix.png');

    // =========================================================================
    // SCENARIO 3: Later Error ("hey leo are we still meet")
    // Target: "Hey, Leo. Are we still meeting at the library on Saturday morning?"
    // Input: "hey leo are we still meet"
    // Expected: "Hey, Leo. Are we still *******" (meeting = 7 letters)
    // Responsive viewports: 1440x900, 768x1024, 390x844
    // =========================================================================
    console.log(
      '\n--- SCENARIO 3: Later Error ("hey leo are we still meet") ---',
    );
    await textarea.fill('hey leo are we still meet');
    await page.waitForTimeout(300);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/check'), {
        timeout: 10000,
      }),
      textarea.press('Enter'),
    ]);
    await page.waitForTimeout(1000);

    const s3Res = networkAudit[networkAudit.length - 1];
    if (s3Res.data.verifiedPrefix !== 'Hey, Leo. Are we still') {
      throw new Error(
        `Scenario 3 Failed: Expected prefix "Hey, Leo. Are we still", got "${s3Res.data.verifiedPrefix}"`,
      );
    }
    if (s3Res.data.nextWordMask !== '*******') {
      throw new Error(
        `Scenario 3 Failed: Expected nextWordMask "*******" (7 letters), got "${s3Res.data.nextWordMask}"`,
      );
    }

    const inputVal3 = await textarea.inputValue();
    console.log(
      '[DOM Audit Step 3] Textarea auto-canonicalized value:',
      inputVal3,
    );
    if (inputVal3 !== 'Hey, Leo. Are we still meet') {
      throw new Error(
        `Step 3 Failed: Expected textarea "Hey, Leo. Are we still meet", got "${inputVal3}"`,
      );
    }

    const sentenceEl3 = page
      .locator('[data-testid="dictation-progressive-sentence"]')
      .first();
    const sentenceText3 = await sentenceEl3.textContent();
    console.log('[DOM Audit S3] Progressive sentence:', sentenceText3);

    if (!sentenceText3.includes('*******')) {
      throw new Error(
        `Scenario 3 Failed: Expected 7-star mask in DOM, got "${sentenceText3}"`,
      );
    }

    // Capture Responsive Screenshots
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03a_desktop_1440x900_wrong_word.png'),
    });
    console.log('[Screenshot] Saved 03a_desktop_1440x900_wrong_word.png');

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03b_tablet_768x1024_wrong_word.png'),
    });
    console.log('[Screenshot] Saved 03b_tablet_768x1024_wrong_word.png');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03c_mobile_390x844_wrong_word.png'),
    });
    console.log('[Screenshot] Saved 03c_mobile_390x844_wrong_word.png');

    // =========================================================================
    // SCENARIO 4: Missing Word ("hey leo we still meeting")
    // Reset to Desktop 1440x900
    // =========================================================================
    console.log('\n--- SCENARIO 4: Missing Word ---');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);

    await textarea.fill('hey leo we still meeting');
    await page.waitForTimeout(300);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/check'), {
        timeout: 10000,
      }),
      textarea.press('Enter'),
    ]);
    await page.waitForTimeout(1000);

    const s4Res = networkAudit[networkAudit.length - 1];
    console.log(
      '[Network Audit S4] Missing word verifiedPrefix:',
      s4Res.data.verifiedPrefix,
      'mask:',
      s4Res.data.nextWordMask,
    );
    if (
      s4Res.data.verifiedPrefix !== 'Hey, Leo.' ||
      s4Res.data.nextWordMask !== '***'
    ) {
      throw new Error(`Scenario 4 Failed: Expected "Hey, Leo." + "***"`);
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '04_missing_word.png'),
    });
    console.log('[Screenshot] Saved 04_missing_word.png');

    // =========================================================================
    // SCENARIO 5: Extra Word ("hey really leo")
    // =========================================================================
    console.log('\n--- SCENARIO 5: Extra Word ---');
    await textarea.fill('hey really leo');
    await page.waitForTimeout(300);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/check'), {
        timeout: 10000,
      }),
      textarea.press('Enter'),
    ]);
    await page.waitForTimeout(1000);

    const s5Res = networkAudit[networkAudit.length - 1];
    console.log(
      '[Network Audit S5] Extra word hint:',
      s5Res.data.hint,
      'mask:',
      s5Res.data.nextWordMask,
    );
    if (!s5Res.data.hint.includes('từ thừa')) {
      throw new Error(
        `Scenario 5 Failed: Expected hint to mention "từ thừa", got "${s5Res.data.hint}"`,
      );
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '05_extra_word.png'),
    });
    console.log('[Screenshot] Saved 05_extra_word.png');

    // =========================================================================
    // SCENARIO 6: Lowercase & No Punctuation -> Full Success!
    // Input: "hey leo are we still meeting at the library on saturday morning"
    // =========================================================================
    console.log(
      '\n--- SCENARIO 6: Lowercase & No Punctuation Correct Answer ---',
    );
    const fullInput =
      'hey leo are we still meeting at the library on saturday morning';
    await textarea.fill(fullInput);
    await page.waitForTimeout(300);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/check'), {
        timeout: 10000,
      }),
      textarea.press('Enter'),
    ]);
    await page.waitForTimeout(1000);

    const s6Res = networkAudit[networkAudit.length - 1];
    if (s6Res.data.isCorrect !== true) {
      throw new Error(
        'Scenario 6 Failed: Lowercase & punctuation-omitted answer must be marked CORRECT.',
      );
    }
    console.log(
      '[Network Audit S6] Successful check response: isCorrect=true, wordAccuracy=100',
    );

    const inputVal6 = await textarea.inputValue();
    console.log(
      '[DOM Audit Step 4] Textarea auto-canonicalized value:',
      inputVal6,
    );
    const expectedCanonicalFull =
      'Hey, Leo. Are we still meeting at the library on Saturday morning?';
    if (inputVal6 !== expectedCanonicalFull) {
      throw new Error(
        `Step 4 Failed: Expected textarea "${expectedCanonicalFull}", got "${inputVal6}"`,
      );
    }

    const successBadge = page.locator('text=✓ Chính xác').first();
    await successBadge.waitFor({ state: 'visible', timeout: 5000 });
    console.log('[DOM Audit S6 PASSED] "✓ Chính xác" displayed.');

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '06_lowercase_no_punct_success.png'),
    });
    console.log('[Screenshot] Saved 06_lowercase_no_punct_success.png');

    // =========================================================================
    // SCENARIO 7: Reload & Persistence Check
    // =========================================================================
    console.log('\n--- SCENARIO 7: Reload Persistence ---');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const reloadedSuccess = page.locator('text=✓ Chính xác').first();
    const isSuccessPersisted = await reloadedSuccess.isVisible();
    console.log(
      '[Persistence Audit S7] Success state restored after refresh:',
      isSuccessPersisted,
    );

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '07_persistence_after_reload.png'),
    });
    console.log('[Screenshot] Saved 07_persistence_after_reload.png');

    await browser.close();
    console.log('\n=== ALL BROWSER QA SCENARIOS PASSED WITH EVIDENCE ===');
    return {
      success: true,
      syntheticUser: { id: syntheticUser.id, email: syntheticUser.email },
      networkAudit,
    };
  } catch (error) {
    console.error('*** QA EXECUTION FAILED ***', error);
    throw error;
  } finally {
    // Purge synthetic student data
    if (syntheticUser) {
      console.log('\n[Cleanup] Cleaning up synthetic test user data...');
      try {
        await prisma.listeningPracticeAttempt.deleteMany({
          where: { userId: syntheticUser.id },
        });
        await prisma.profile.deleteMany({
          where: { userId: syntheticUser.id },
        });
        await prisma.user.deleteMany({
          where: { id: syntheticUser.id },
        });
        console.log(
          '[Cleanup] Successfully purged synthetic test user:',
          syntheticUser.email,
        );
      } catch (cleanErr) {
        console.error(
          '[Cleanup Error] Failed to purge synthetic user:',
          cleanErr.message,
        );
      }
      await prisma.$disconnect();
    }
  }
}

runDictationHeadlessQA()
  .then(() => {
    console.log('DICTATION_HEADLESS_QA_RESULT=SUCCESS');
    process.exit(0);
  })
  .catch((err) => {
    console.error('DICTATION_HEADLESS_QA_RESULT=FAILED', err);
    process.exit(1);
  });
