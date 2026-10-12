const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { DiagnosticService } = require('../dist/src/modules/diagnostic/diagnostic.service');

async function main() {
  const service = new DiagnosticService(prisma);
  const questions = await prisma.diagnosticQuestion.findMany({
    where: { assessmentId: 2 },
    orderBy: { order: 'asc' },
  });

  const activeQuestions = questions.filter((q) => {
    const opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
    return opts && opts.activeInForm !== false;
  });

  const objectiveQuestions = activeQuestions.filter((q) => {
    const opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
    return opts && opts.questionType !== 'OPEN_TEXT';
  });

  console.log('Total active questions:', activeQuestions.length);
  console.log('Objective questions:', objectiveQuestions.length);

  // Let's create answers where:
  // - 5 of 11 Grammar are correct
  // - 2 of 5 Vocabulary are correct
  // - 8 of 16 Reading are correct
  // - 7 of 16 Listening are correct
  // Total correct = 5 + 2 + 8 + 7 = 22
  const answers = {};
  let gCount = 0, vCount = 0, rCount = 0, lCount = 0;

  for (const q of objectiveQuestions) {
    const opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
    const values = opts.values || opts;
    let shouldBeCorrect = false;

    if (q.skill === 'Grammar') {
      gCount++;
      if (gCount <= 5) shouldBeCorrect = true;
    } else if (q.skill === 'Vocabulary') {
      vCount++;
      if (vCount <= 2) shouldBeCorrect = true;
    } else if (q.skill === 'Reading') {
      rCount++;
      if (rCount <= 8) shouldBeCorrect = true;
    } else if (q.skill === 'Listening') {
      lCount++;
      if (lCount <= 7) shouldBeCorrect = true;
    }

    if (shouldBeCorrect) {
      // answer with correct option text
      answers[String(q.id)] = values[q.correctIndex];
    } else {
      // answer with wrong option text
      const wrongIdx = (q.correctIndex + 1) % values.length;
      answers[String(q.id)] = values[wrongIdx];
    }
  }

  // Simulate attempt object
  const mockAttempt = {
    id: 1001,
    assessmentId: 2,
    userId: 999,
    status: 'COMPLETED',
    score: null,
    level: 'A2 – Sơ trung cấp',
    answers,
    submittedAt: new Date(),
    completedAt: new Date(),
  };

  const result = await service['toResult'](mockAttempt, activeQuestions);

  console.log('\n=== RUNTIME RESULT VERIFICATION ===');
  console.log('overallCorrect:', result.correctCount);
  console.log('objectiveTotalCount:', result.objectiveTotalCount);
  console.log('totalTaskCount:', result.totalTaskCount);

  let sumSkillCorrect = 0;
  console.log('\nSkill Profiles:');
  for (const sp of result.skillProfiles) {
    console.log(`- ${sp.skill}: ${sp.correctCount} / ${sp.totalCount} (${sp.percentage}%)`);
    sumSkillCorrect += sp.correctCount;
  }

  console.log('\nArithmetic Check:');
  console.log(`sum(skillCorrect) = ${sumSkillCorrect}`);
  console.log(`overallCorrect   = ${result.correctCount}`);
  console.log(`EQUAL?            = ${sumSkillCorrect === result.correctCount}`);

  if (sumSkillCorrect !== result.correctCount) {
    console.error('ARITHMETIC INVARIANT FAILED!');
    process.exit(1);
  } else {
    console.log('ARITHMETIC INVARIANT VERIFIED!');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
