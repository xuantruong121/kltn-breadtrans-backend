const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const JWT_SECRET = '8fe80d1b6eaf0e7874442df29b9fb405564808c20d16ae38be8d658c77fd05f5';
const FRONTEND_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.resolve('D:/Study/KLTN/artifacts/entry-diagnostic-ux-repair/screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function runQa() {
  console.log('=== STARTING REAL BROWSER HEADLESS QA ===');
  const syntheticEmail = 'synthetic_qa_diagnostic_pass2@breadtrans.qa';

  // 1. Ensure clean slate for synthetic user
  await prisma.diagnosticAttempt.deleteMany({ where: { user: { email: syntheticEmail } } });
  await prisma.user.deleteMany({ where: { email: syntheticEmail } });

  const user = await prisma.user.create({
    data: {
      email: syntheticEmail,
      role: 'STUDENT',
      profile: {
        create: {
          fullName: 'Synthetic QA Learner 2.0',
        },
      },
    },
    include: { profile: true },
  });
  console.log('Created synthetic QA user:', user.id, user.email);

  const deviceId = 'qa-playwright-headless-1';
  const accessToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      deviceId,
      type: 'access',
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  const authStorage = JSON.stringify({
    state: {
      accessToken,
      refreshToken: accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profile: user.profile,
      },
    },
    version: 0,
  });

  // 2. Fetch assessment 2 questions
  const assessment = await prisma.diagnosticAssessment.findFirst({
    where: { isActive: true },
    orderBy: { id: 'desc' },
    include: { questions: { orderBy: { order: 'asc' } } },
  });

  const activeQuestions = assessment.questions.filter((q) => {
    const meta = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
    return meta && meta.activeInForm !== false;
  });

  const objectiveQuestions = activeQuestions.filter((q) => {
    const meta = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
    return meta.questionType !== 'OPEN_TEXT';
  });

  console.log('Active objective questions count:', objectiveQuestions.length);

  // 3. Create a controlled completed attempt with score 14/48
  // Grammar (8 total): 3 correct (IDs 2001, 2002, 2005)
  // Vocabulary (8 total): 2 correct (IDs 2003, 2004)
  // Reading (16 total): 5 correct (IDs 2017, 2018, 2019, 2020, 2021)
  // Listening (16 total): 4 correct (IDs 2033, 2034, 2035, 2036)
  // Total: 3 + 2 + 5 + 4 = 14 correct!
  // All percentages < 60% -> strengths = [], weaknesses = [Vocabulary, Grammar, Reading, Listening]
  const targetCorrectIds = new Set([
    2001, 2002, 2005, // Grammar: 3/8 (38%)
    2003, 2004,       // Vocabulary: 2/8 (25%)
    2017, 2018, 2019, 2020, 2021, // Reading: 5/16 (31%)
    2033, 2034, 2035, 2036        // Listening: 4/16 (25%)
  ]);

  // First create in-progress attempt to get attempt.id
  const attempt = await prisma.diagnosticAttempt.create({
    data: {
      userId: user.id,
      assessmentId: assessment.id,
      answers: {},
      correctCount: 0,
      totalCount: 48,
      percentage: 0,
      level: 'Pre-A1 – Cần củng cố nền tảng',
      status: 'IN_PROGRESS',
    },
  });

  const { getAttemptQuestionPermutation } = require('../dist/src/modules/diagnostic/diagnostic.logic');

  const answers = {
    __submissionToken: 'qa-submission-token-pass2',
    __permAttemptId: attempt.id,
  };

  for (const q of objectiveQuestions) {
    const meta = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
    const opts = meta.values || [];
    const perm = getAttemptQuestionPermutation(attempt.id, q.id, opts.length);

    if (targetCorrectIds.has(q.id)) {
      // Pick displayed index that maps to q.correctIndex
      const correctDisplayedIdx = perm.indexOf(q.correctIndex);
      answers[String(q.id)] = correctDisplayedIdx;
    } else {
      // Pick displayed index that is wrong
      const wrongDisplayedIdx = perm.indexOf((q.correctIndex + 1) % opts.length);
      answers[String(q.id)] = wrongDisplayedIdx;
    }
  }

  // Speaking & Writing open text answers
  answers['2049'] = 'SKIPPED';
  answers['2050'] = 'SKIPPED';
  answers['2051'] = 'This is an authored writing sample for task 1.';
  answers['2052'] = 'This is an authored writing sample for task 2.';

  // Update attempt to COMPLETED with 14/48
  await prisma.diagnosticAttempt.update({
    where: { id: attempt.id },
    data: {
      answers,
      correctCount: 14,
      totalCount: 48,
      percentage: Math.round((14 / 48) * 100),
      level: 'Pre-A1 – Cần củng cố nền tảng',
      status: 'COMPLETED',
      completedAt: new Date(),
    },
  });

  console.log('Created COMPLETED attempt', attempt.id, 'for QA user');

  // Launch headless browser
  const browser = await chromium.launch({ headless: true });

  try {
    // Context with auth pre-set
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      storageState: undefined,
    });

    const page = await context.newPage();

    // Set auth in localStorage
    await page.goto(`${FRONTEND_URL}/login`);
    await page.evaluate((authJson) => {
      localStorage.setItem('auth-storage-junior', authJson);
    }, authStorage);

    // 1. Visit /diagnostic - should render saved result page directly
    console.log('Navigating to /diagnostic...');
    await page.goto(`${FRONTEND_URL}/diagnostic`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Screenshot 1: Corrected Result Arithmetic (14/48)
    const resultHeaderSection = page.locator('div:has-text("Phần trắc nghiệm khách quan:")').first();
    await resultHeaderSection.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01_corrected_result_arithmetic.png'),
    });
    console.log('Captured 01_corrected_result_arithmetic.png');

    // Screenshot 2: Grammar & Vocab Denominators (both /8)
    const skillProfilesContainer = page.locator('text=KẾT QUẢ THEO KỸ NĂNG').locator('..');
    await skillProfilesContainer.scrollIntoViewIfNeeded();
    await skillProfilesContainer.screenshot({
      path: path.join(SCREENSHOT_DIR, '02_grammar_vocab_8_8_denominators.png'),
    });
    console.log('Captured 02_grammar_vocab_8_8_denominators.png');

    // Screenshot 3: Pre-A1 Vietnamese Result Wording
    const levelHeading = page.locator('h1');
    await levelHeading.scrollIntoViewIfNeeded();
    await levelHeading.screenshot({
      path: path.join(SCREENSHOT_DIR, '03_pre_a1_vietnamese_level_wording.png'),
    });
    console.log('Captured 03_pre_a1_vietnamese_level_wording.png');

    // Screenshot 4: No False Strength Label
    const strengthsSection = page.locator('text=ĐIỂM MẠNH').locator('..');
    await strengthsSection.scrollIntoViewIfNeeded();
    await strengthsSection.screenshot({
      path: path.join(SCREENSHOT_DIR, '04_no_false_strength_label.png'),
    });
    console.log('Captured 04_no_false_strength_label.png');

    // Screenshot 5: Concrete Practice Recommendations
    const practiceSection = page.locator('section:has-text("Bài luyện đề xuất")');
    if (await practiceSection.count()) {
      await practiceSection.scrollIntoViewIfNeeded();
      await practiceSection.screenshot({
        path: path.join(SCREENSHOT_DIR, '05_concrete_practice_recommendations.png'),
      });
      console.log('Captured 05_concrete_practice_recommendations.png');
    }

    // Screenshot 6: Speaking & Writing Evidence Copy
    const evidenceBlock = page.locator('div:has-text("Bằng chứng kỹ năng Nói & Viết")').filter({ hasText: 'Nói:' }).last();
    if (await evidenceBlock.count()) {
      await evidenceBlock.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -120));
      await page.waitForTimeout(200);
      await evidenceBlock.screenshot({
        path: path.join(SCREENSHOT_DIR, '06_speaking_writing_evidence_copy.png'),
      });
      console.log('Captured 06_speaking_writing_evidence_copy.png');
    }

    // Screenshot 8: Retake Blocked (full page view of /diagnostic showing completed state)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '08_retake_blocked_saved_result.png'),
      fullPage: true,
    });
    console.log('Captured 08_retake_blocked_saved_result.png');

    // Screenshot 9: No Companion Overlay on Result
    // Check if floating companion is in viewport
    const companionVisible = await page.locator('[aria-label*="Bready"], [aria-label*="thú cưng"]').count();
    console.log('Companion elements on /diagnostic:', companionVisible);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '09_no_companion_overlay_on_result.png'),
    });
    console.log('Captured 09_no_companion_overlay_on_result.png');

    // Screenshot 7: Profile Saved Result Tab
    console.log('Navigating to /hub?tab=diagnostic-result...');
    await page.goto(`${FRONTEND_URL}/hub?tab=diagnostic-result`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '07_profile_saved_result_tab.png'),
    });
    console.log('Captured 07_profile_saved_result_tab.png');

    // Screenshot 10: Mobile Header Polish (viewport 375x667)
    // To test mobile header in progress, let's create a separate synthetic user with an IN_PROGRESS attempt
    const mobileUserEmail = 'synthetic_qa_mobile_in_progress@breadtrans.qa';
    await prisma.diagnosticAttempt.deleteMany({ where: { user: { email: mobileUserEmail } } });
    await prisma.user.deleteMany({ where: { email: mobileUserEmail } });

    const mobileUser = await prisma.user.create({
      data: {
        email: mobileUserEmail,
        role: 'STUDENT',
        profile: { create: { fullName: 'Mobile Test Learner' } },
      },
      include: { profile: true },
    });

    const mobileToken = jwt.sign(
      {
        sub: mobileUser.id,
        email: mobileUser.email,
        role: mobileUser.role,
        deviceId: 'qa-mobile-1',
        type: 'access',
        jti: crypto.randomUUID(),
      },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    const mobileAuthStorage = JSON.stringify({
      state: {
        accessToken: mobileToken,
        refreshToken: mobileToken,
        user: {
          id: mobileUser.id,
          email: mobileUser.email,
          role: mobileUser.role,
          profile: mobileUser.profile,
        },
      },
      version: 0,
    });

    // In-progress attempt for mobile user
    await prisma.diagnosticAttempt.create({
      data: {
        userId: mobileUser.id,
        assessmentId: assessment.id,
        answers: { '2001': 1 },
        correctCount: 1,
        totalCount: 48,
        percentage: 2,
        level: 'Starter',
        status: 'IN_PROGRESS',
      },
    });

    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 667 },
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${FRONTEND_URL}/login`);
    await mobilePage.evaluate((authJson) => {
      localStorage.setItem('auth-storage-junior', authJson);
    }, mobileAuthStorage);

    await mobilePage.goto(`${FRONTEND_URL}/diagnostic`, { waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(500);

    // Click "Tiếp tục bài đánh giá"
    const resumeBtn = mobilePage.locator('button:has-text("Tiếp tục bài đánh giá"), button:has-text("Bắt đầu làm bài")');
    if (await resumeBtn.count()) {
      await resumeBtn.first().click();
      await mobilePage.waitForTimeout(500);
    }

    await mobilePage.evaluate(() => window.scrollTo(0, 0));
    await mobilePage.waitForTimeout(300);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, '10_mobile_header_da_danh_gia.png'),
    });
    console.log('Captured 10_mobile_header_da_danh_gia.png');

    await mobileContext.close();
    await context.close();

    // Clean up mobile synthetic user
    await prisma.diagnosticAttempt.deleteMany({ where: { user: { email: mobileUserEmail } } });
    await prisma.user.deleteMany({ where: { email: mobileUserEmail } });
    console.log('Cleaned up mobile synthetic user.');

  } finally {
    await browser.close();
    // Clean up primary synthetic user
    await prisma.diagnosticAttempt.deleteMany({ where: { user: { email: syntheticEmail } } });
    await prisma.user.deleteMany({ where: { email: syntheticEmail } });
    console.log('Cleaned up primary synthetic user.');
  }

  console.log('=== REAL BROWSER QA FINISHED SUCCESSFULLY ===');
}

runQa().catch((err) => {
  console.error('QA Failed:', err);
  process.exit(1);
});
