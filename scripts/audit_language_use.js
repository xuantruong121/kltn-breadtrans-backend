const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Get active assessment
  const assessment = await p.diagnosticAssessment.findFirst({
    where: { isActive: true },
    orderBy: { id: 'desc' },
  });

  if (!assessment) {
    console.log('No active assessment found');
    return;
  }

  console.log('Active assessment ID:', assessment.id, assessment.name);

  // Get all Language Use questions (orders 1–16 in standard layout)
  const allQuestions = await p.diagnosticQuestion.findMany({
    where: { assessmentId: assessment.id },
    orderBy: { order: 'asc' },
    select: { id: true, skill: true, question: true, options: true, correctIndex: true, order: true },
  });

  const luQuestions = allQuestions.filter(q => {
    const opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
    return opts && opts.section === 'LANGUAGE_USE';
  });

  console.log('\n=== LANGUAGE USE QUESTIONS ===');
  console.log('Count:', luQuestions.length);
  console.log('\n');

  for (const q of luQuestions) {
    const opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
    console.log({
      id: q.id,
      order: q.order,
      skill: q.skill,
      stem: q.question.substring(0, 80),
      construct: opts.construct || '(none)',
      intendedLevel: opts.intendedLevel || '(none)',
      activeInForm: opts.activeInForm !== false,
      questionType: opts.questionType || 'MCQ',
      section: opts.section,
      values: opts.values || opts,
    });
    console.log('---');
  }

  // Also show all questions for reference
  console.log('\n=== ALL QUESTIONS IN DB ===');
  for (const q of allQuestions) {
    const opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
    const active = opts && opts.activeInForm !== false;
    console.log(`ID: ${q.id}, Order: ${q.order}, Skill: ${q.skill}, Active: ${active}, Key: ${opts.stableKey || 'none'}`);
  }
  console.log('Total questions in DB:', allQuestions.length);

  const speakingResponses = await p.diagnosticSpeakingResponse.findMany({
    select: { id: true, questionId: true, attemptId: true },
  });
  console.log('\n=== SPEAKING RESPONSES ===');
  console.log('Count:', speakingResponses.length, speakingResponses);

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
