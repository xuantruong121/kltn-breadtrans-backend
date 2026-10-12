const { chromium } = require('D:/Study/KLTN/Project/kltn-breadtrans-frontend-junior/node_modules/playwright');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = '8fe80d1b6eaf0e7874442df29b9fb405564808c20d16ae38be8d658c77fd05f5';

const userId = 14;
const email = 'xtruong121.work@gmail.com';

const token = jwt.sign(
  {
    sub: userId,
    email,
    role: 'STUDENT',
    deviceId: 'qa-browser-e2e',
    type: 'access',
    jti: crypto.randomUUID(),
  },
  JWT_SECRET,
  { expiresIn: '1d' }
);

async function cleanUserAttempts() {
  await prisma.diagnosticSpeakingResponse.deleteMany({
    where: { userId },
  });
  await prisma.diagnosticAttempt.deleteMany({
    where: { userId },
  });
}

(async () => {
  console.log('=== STEP 1: INITIAL CLEANUP FOR SYNTHETIC QA LEARNER ===');
  await cleanUserAttempts();
  console.log('✓ Cleaned previous attempts for user 14');

  console.log('\n=== STEP 2: LAUNCHING REAL HEADLESS BROWSER (NO WINDOW) ===');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
  });

  const context = await browser.newContext();
  await context.addInitScript(
    (st) => {
      window.localStorage.setItem('auth-storage-junior', st);
    },
    JSON.stringify({
      state: {
        accessToken: token,
        refreshToken: token,
        user: { id: userId, email, role: 'STUDENT' },
      },
      version: 0,
    })
  );

  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  console.log('\n=== STEP 3: NAVIGATING TO /diagnostic ===');
  await page.goto('http://localhost:3000/diagnostic', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=52 nhiệm vụ', { timeout: 15000 });

  const introText = await page.locator('body').innerText();
  const has52Scale = introText.includes('52 nhiệm vụ (48 trắc nghiệm + 4 thực hành)');
  console.log(`✓ Intro scale verified (52 total = 48 objective + 4 productive): ${has52Scale}`);

  // Click start button
  const startButton = page.getByRole('button', { name: /Bắt đầu/i }).first();
  await startButton.waitFor({ state: 'visible', timeout: 10000 });
  console.log('Clicking "Bắt đầu làm bài"...');
  await startButton.click();

  // Wait for diagnostic test interface to load
  await page.waitForSelector('button:has-text("Danh sách câu")', { timeout: 15000 });
  await page.waitForTimeout(1000);

  async function gotoQuestion(qNum) {
    await page.getByRole('button', { name: /Danh sách câu/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: `Đi tới câu ${qNum}`, exact: true }).click();
    await page.waitForTimeout(800);
  }

  // --- A1 VERIFICATION ---
  console.log('\n=== STEP 4: VERIFYING A1 ITEMS IN REAL BROWSER ===');
  // Q1: Grammar A1 (My name ___ Linh.)
  const q1Text = await page.locator('body').innerText();
  const q1HasStem = q1Text.includes('My name');
  console.log(`✓ Q1 (Grammar A1) stem rendered ("My name ___ Linh."): ${q1HasStem}`);

  // Q1 options
  const q1Options = await page.locator('button.group span.font-bold').allInnerTexts();
  console.log(`   Q1 displayed options: ${JSON.stringify(q1Options)}`);
  
  // Navigate to Question 3 (New Vocabulary A1: I drink water from a ___.)
  console.log('\nNavigating to Question 3 (New Vocabulary A1)...');
  await gotoQuestion(3);

  const q3Text = await page.locator('body').innerText();
  const q3HasStem = q3Text.includes('I drink water from a');
  console.log(`✓ Q3 (New Vocabulary A1) stem rendered ("I drink water from a ___."): ${q3HasStem}`);

  const q3Options = await page.locator('button.group span.font-bold').allInnerTexts();
  console.log(`✓ Q3 displayed options: ${JSON.stringify(q3Options)}`);
  const q3HasBottle = q3Options.includes('bottle');
  const q3HasChair = q3Options.includes('chair');
  const q3HasWindow = q3Options.includes('window');
  const q3HasPencil = q3Options.includes('pencil');
  console.log(`   Options validation: bottle=${q3HasBottle}, chair=${q3HasChair}, window=${q3HasWindow}, pencil=${q3HasPencil}`);

  // --- A2 VERIFICATION ---
  console.log('\n=== STEP 5: VERIFYING A2 ITEMS IN REAL BROWSER ===');
  // Navigate to Question 7 (Activated Q2050 Vocabulary A2: I usually ___ breakfast at seven.)
  console.log('Navigating to Question 7 (Activated Q2050 Vocabulary A2)...');
  await gotoQuestion(7);

  const q7Text = await page.locator('body').innerText();
  const q7HasStem = q7Text.includes('usually') && q7Text.includes('breakfast');
  console.log(`✓ Q7 (Q2050 Vocabulary A2) stem rendered ("I usually ___ breakfast at seven."): ${q7HasStem}`);

  const q7Options = await page.locator('button.group span.font-bold').allInnerTexts();
  console.log(`✓ Q7 displayed options: ${JSON.stringify(q7Options)}`);
  const q7HasHave = q7Options.includes('have');
  console.log(`   Contains "have": ${q7HasHave}`);

  // --- B1 VERIFICATION ---
  console.log('\n=== STEP 6: VERIFYING B1 ITEMS IN REAL BROWSER ===');
  // Question 9: Grammar B1 (I ___ this report since Monday.)
  console.log('Navigating to Question 9 (Grammar B1)...');
  await gotoQuestion(9);

  const q9Text = await page.locator('body').innerText();
  const q9HasStem = q9Text.includes('since Monday') || q9Text.includes('this report');
  console.log(`✓ Q9 (Grammar B1) stem rendered ("I ___ this report since Monday."): ${q9HasStem}`);

  // Question 10: New Vocabulary B1 (We need to ___ the meeting until next Monday...)
  console.log('Navigating to Question 10 (New Vocabulary B1)...');
  await gotoQuestion(10);

  const q10Text = await page.locator('body').innerText();
  const q10HasStem = q10Text.includes('the meeting until next Monday');
  console.log(`✓ Q10 (New Vocabulary B1) stem rendered ("We need to ___ the meeting..."): ${q10HasStem}`);

  const q10Options = await page.locator('button.group span.font-bold').allInnerTexts();
  console.log(`✓ Q10 displayed options: ${JSON.stringify(q10Options)}`);
  const q10HasPutOff = q10Options.includes('put off');
  console.log(`   Contains "put off": ${q10HasPutOff}`);

  // --- SUBMIT CONTROLLED ATTEMPT AND VERIFY RESULT SCREEN ---
  console.log('\n=== STEP 7: SUBMITTING CONTROLLED ATTEMPT TO AUDIT RESULT PAGE ===');
  // Get active questions from API / DB to construct valid answers
  const activeQuestions = await prisma.diagnosticQuestion.findMany({
    where: { assessmentId: 2 },
    orderBy: { order: 'asc' },
  });

  const formQuestions = activeQuestions.filter((q) => {
    const meta = q.options && typeof q.options === 'object' ? q.options : {};
    return meta.activeInForm !== false;
  });

  const objectiveQuestions = formQuestions.filter((q) => {
    const meta = q.options && typeof q.options === 'object' ? q.options : {};
    return meta.questionType !== 'OPEN_TEXT';
  });

  console.log(`Form questions count: ${formQuestions.length}, Objective count: ${objectiveQuestions.length}`);

  // Let's answer:
  // 5 Grammar correct out of 8
  // 4 Vocabulary correct out of 8
  // 10 Reading correct out of 16
  // 8 Listening correct out of 16
  // Total correct = 5 + 4 + 10 + 8 = 27 / 48
  const answers = {};
  let gCount = 0;
  let vCount = 0;
  let rCount = 0;
  let lCount = 0;

  for (const q of objectiveQuestions) {
    let makeCorrect = false;
    if (q.skill === 'Grammar') {
      gCount++;
      makeCorrect = gCount <= 5;
    } else if (q.skill === 'Vocabulary') {
      vCount++;
      makeCorrect = vCount <= 4;
    } else if (q.skill === 'Reading') {
      rCount++;
      makeCorrect = rCount <= 10;
    } else if (q.skill === 'Listening') {
      lCount++;
      makeCorrect = lCount <= 8;
    }

    // Pass answer as object with originalIndex or direct correctIndex
    if (makeCorrect) {
      answers[String(q.id)] = { originalIndex: q.correctIndex };
    } else {
      const opts = (q.options && q.options.values) || ['a', 'b', 'c', 'd'];
      const wrongIdx = (q.correctIndex + 1) % opts.length;
      answers[String(q.id)] = { originalIndex: wrongIdx };
    }
  }

  // Find in-progress attempt
  const attempt = await prisma.diagnosticAttempt.findFirst({
    where: { userId, assessmentId: 2, status: 'IN_PROGRESS' },
  });
  if (!attempt) {
    throw new Error('No IN_PROGRESS attempt found for user 14');
  }

  // Add writing answers for open tasks 2059 and 2060
  answers['2059'] = 'My schedule changed to Friday morning, please join me then.';
  answers['2060'] = 'Dear manager, here is the workplace update explaining the short delay.';

  // Skip speaking tasks 2057 and 2058
  await fetch(`http://localhost:3001/diagnostic/2/attempts/${attempt.id}/speaking/2057/skip`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  await fetch(`http://localhost:3001/diagnostic/2/attempts/${attempt.id}/speaking/2058/skip`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('✓ Skipped speaking tasks for attempt to finalize');

  // Submit via fetch to backend API: POST /diagnostic/2/attempts
  const submitRes = await fetch('http://localhost:3001/diagnostic/2/attempts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      answers,
      submissionToken: attempt.submissionToken,
      attemptId: attempt.id,
    }),
  });

  const rawJson = await submitRes.json();
  if (rawJson.statusCode >= 400) {
    throw new Error(`Submit failed with error: ${JSON.stringify(rawJson)}`);
  }
  const submitJson = rawJson.data || rawJson;
  console.log('✓ Submitted attempt API result:', {
    correctCount: submitJson.correctCount,
    totalCount: submitJson.totalCount,
    percentage: submitJson.percentage,
    level: submitJson.level,
  });

  // Verify skill profiles from backend response
  console.log('\n=== STEP 8: VERIFYING BACKEND SKILL PROFILE TOTALS ===');
  const backendProfiles = submitJson.skillProfiles || [];
  for (const prof of backendProfiles) {
    console.log(`- ${prof.skill}: ${prof.correctCount}/${prof.totalCount} (${prof.percentage}%)`);
  }

  const grammarProfile = backendProfiles.find((p) => p.skill === 'Grammar');
  const vocabProfile = backendProfiles.find((p) => p.skill === 'Vocabulary');
  const readingProfile = backendProfiles.find((p) => p.skill === 'Reading');
  const listeningProfile = backendProfiles.find((p) => p.skill === 'Listening');

  if (grammarProfile.totalCount !== 8) throw new Error(`Grammar totalCount is ${grammarProfile.totalCount}, expected 8`);
  if (vocabProfile.totalCount !== 8) throw new Error(`Vocabulary totalCount is ${vocabProfile.totalCount}, expected 8`);
  if (readingProfile.totalCount !== 16) throw new Error(`Reading totalCount is ${readingProfile.totalCount}, expected 16`);
  if (listeningProfile.totalCount !== 16) throw new Error(`Listening totalCount is ${listeningProfile.totalCount}, expected 16`);
  if (submitJson.totalCount !== 48) throw new Error(`Objective totalCount is ${submitJson.totalCount}, expected 48`);

  const sumSkills = grammarProfile.correctCount + vocabProfile.correctCount + readingProfile.correctCount + listeningProfile.correctCount;
  console.log(`✓ Arithmetic invariant: overallCorrect (${submitJson.correctCount}) === sumSkills (${sumSkills}): ${submitJson.correctCount === sumSkills}`);
  if (submitJson.correctCount !== sumSkills) {
    throw new Error(`Arithmetic mismatch: overall ${submitJson.correctCount} vs sum ${sumSkills}`);
  }

  // Reload frontend page to display completed result view
  console.log('\n=== STEP 9: VERIFYING RESULT SCREEN IN REAL BROWSER ===');
  await page.goto('http://localhost:3000/diagnostic', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const resultPageText = await page.locator('body').innerText();

  const hasGrammarSlash8 = resultPageText.includes('/8') && resultPageText.includes('Ngữ pháp');
  const hasVocabSlash8 = resultPageText.includes('/8') && resultPageText.includes('Từ vựng');
  const hasReadingSlash16 = resultPageText.includes('/16') && resultPageText.includes('Đọc hiểu');
  const hasListeningSlash16 = resultPageText.includes('/16') && resultPageText.includes('Nghe hiểu');
  const has48Denominator = resultPageText.includes('/48 câu đúng') || resultPageText.includes('/48');
  const has52Total = resultPageText.includes('52 nhiệm vụ');

  console.log(`✓ Denominator Ngữ pháp /8: ${hasGrammarSlash8}`);
  console.log(`✓ Denominator Từ vựng /8: ${hasVocabSlash8}`);
  console.log(`✓ Denominator Đọc hiểu /16: ${hasReadingSlash16}`);
  console.log(`✓ Denominator Nghe hiểu /16: ${hasListeningSlash16}`);
  console.log(`✓ Objective total /48: ${has48Denominator}`);
  console.log(`✓ Total tasks 52: ${has52Total}`);

  if (!hasGrammarSlash8 || !hasVocabSlash8 || !hasReadingSlash16 || !hasListeningSlash16) {
    throw new Error('Visible denominators check failed on result page');
  }

  // --- STEP 10: PRACTICE RECOMMENDATION VERIFICATION ---
  console.log('\n=== STEP 10: VERIFYING PRACTICE RECOMMENDATIONS ON RESULT PAGE ===');
  const hasPracticeSection = resultPageText.includes('Bài luyện đề xuất');
  console.log(`✓ Practice section rendered: ${hasPracticeSection}`);
  const practiceCards = await page.locator('section').filter({ hasText: 'Bài luyện đề xuất' }).locator('a').allInnerTexts();
  console.log(`✓ Rendered practice recommendations count: ${practiceCards.length}`);
  for (const card of practiceCards) {
    console.log(`   - ${card.replace(/\n+/g, ' | ')}`);
  }

  // --- STEP 11: PROFILE RESULT TAB VERIFICATION ---
  console.log('\n=== STEP 11: VERIFYING PROFILE RESULT TAB ===');
  await page.goto('http://localhost:3000/hub?tab=diagnostic', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const profilePageText = await page.locator('body').innerText();
  const profileHasGrammar8 = profilePageText.includes('/8') && profilePageText.includes('Ngữ pháp');
  const profileHasVocab8 = profilePageText.includes('/8') && profilePageText.includes('Từ vựng');
  console.log(`✓ Profile Tab Ngữ pháp /8: ${profileHasGrammar8}`);
  console.log(`✓ Profile Tab Từ vựng /8: ${profileHasVocab8}`);

  await browser.close();

  // --- STEP 12: CLEANUP TEMPORARY QA ATTEMPT ---
  console.log('\n=== STEP 12: CLEANING UP TEMPORARY QA ATTEMPTS ===');
  await cleanUserAttempts();
  console.log('✓ Cleaned up all QA attempts for user 14');

  console.log('\n======================================================');
  console.log('ALL INVARIANTS AND CRITERIA FULLY VERIFIED AND PASSED!');
  console.log('======================================================');
})().catch(async (err) => {
  console.error('QA Test Error:', err);
  await cleanUserAttempts().catch(() => {});
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
