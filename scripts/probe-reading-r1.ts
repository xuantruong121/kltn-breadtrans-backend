import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== READING R1 PROBE ===');

  // 1. Quizzes count and details
  const readingQuizzes = await prisma.quiz.findMany({
    where: { type: 'BILINGUAL_READING' },
    include: {
      practiceTopic: true,
      questions: {
        orderBy: { order: 'asc' },
      },
      submissions: {
        include: { results: true },
      },
    },
  });

  console.log(`Found ${readingQuizzes.length} BILINGUAL_READING quizzes.`);

  let totalQuestions = 0;
  for (const q of readingQuizzes) {
    totalQuestions += q.questions.length;
    console.log(`\nQuiz ${q.id}: "${q.title}"`);
    console.log(
      `  Topic: ${q.practiceTopic?.name} / ${q.practiceTopic?.vietnameseName} (ID: ${q.practiceTopicId})`,
    );
    console.log(
      `  bilingualContent type: ${typeof q.bilingualContent}, isArray: ${Array.isArray(q.bilingualContent)}`,
    );
    console.log(`  bilingualContent:`, JSON.stringify(q.bilingualContent));
    console.log(`  Questions count: ${q.questions.length}`);
    console.log(`  Submissions count: ${q.submissions.length}`);

    // Sample question content
    if (q.questions.length > 0) {
      const firstQ = q.questions[0];
      const content = firstQ.content as any;
      console.log(`  Sample Question ${firstQ.id} (type=${firstQ.type}):`);
      console.log(
        `    has passage: ${Boolean(content?.passage)}, length=${content?.passage?.length}`,
      );
      console.log(
        `    passage sample: "${String(content?.passage ?? '').slice(0, 60)}..."`,
      );
      console.log(`    options:`, content?.options);
      console.log(`    correctIndex:`, content?.correctIndex);
      console.log(`    correct:`, content?.correct);
      console.log(`    correctAnswer:`, content?.correctAnswer);
      console.log(`    questionType (micro-skill):`, content?.questionType);
      console.log(`    category:`, content?.category);
    }
  }

  console.log(`\nTotal questions across all quizzes: ${totalQuestions}`);

  console.log(`\n=== PASSAGE DEDUPLICATION INSPECTION ===`);
  for (const q of readingQuizzes) {
    const rawPassages = q.questions
      .map((qn) => String((qn.content as any)?.passage ?? ''))
      .filter(Boolean);
    const uniquePassages = Array.from(
      new Set(rawPassages.map((p) => p.trim())),
    );
    console.log(
      `Quiz ${q.id} ("${q.title}"): ${q.questions.length} questions, ${rawPassages.length} passages, ${uniquePassages.length} UNIQUE passages.`,
    );
    uniquePassages.forEach((p, idx) => {
      const ps = String(p);
      console.log(
        `  Unique Passage ${idx + 1} (${ps.length} chars): "${ps.slice(0, 50).replace(/\n/g, ' ')}..."`,
      );
    });
  }

  // Topics
  const topics = await prisma.practiceTopic.findMany({
    where: { category: 'BILINGUAL_LEVEL' },
  });
  console.log(`\nFound ${topics.length} BILINGUAL_LEVEL topics:`);
  topics.forEach((t) =>
    console.log(`  Topic ${t.id}: ${t.name} (${t.vietnameseName})`),
  );

  // Analytics probe for Submission 4
  console.log(`\n=== SUBMISSION 4 ANALYTICS TEST ===`);
  const sub4 = await prisma.submission.findUnique({
    where: { id: 4 },
    include: {
      quiz: { include: { questions: true } },
      results: true,
    },
  });
  if (sub4) {
    const q1 = sub4.quiz.questions[0];
    const c1 = q1.content as any;
    console.log(`Sub 4 Quiz: "${sub4.quiz.title}", type: ${sub4.quiz.type}`);
    console.log(`Sub 4 Question 1 content:`, {
      options: c1?.options,
      correctIndex: c1?.correctIndex,
      correct: c1?.correct,
      correctAnswer: c1?.correctAnswer,
      questionType: c1?.questionType,
      explanation: c1?.explanation,
    });
    const standardAns =
      c1?.correct ||
      c1?.correctAnswer ||
      (typeof c1?.correctIndex === 'number' && c1?.options?.[c1.correctIndex]);
    console.log(`Resolved standard answer for Q1: "${standardAns}"`);
  }

  // Sentence count test on all unique passages
  console.log(`\n=== SENTENCE COUNT TEST ON UNIQUE PASSAGES ===`);
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  for (const q of readingQuizzes) {
    const uniquePassages = new Set<string>();
    for (const question of q.questions) {
      const c = question.content as any;
      const passageStr: string =
        typeof c?.passage === 'string' ? (c.passage as string) : '';
      if (passageStr.trim().length > 0) {
        const cleaned = passageStr
          .replace(
            /^(ARTICLE|PASSAGE|EMAIL|MEMO|LETTER|NOTICE|ADVERTISEMENT|CONVERSATION|REPORT EXCERPT):\s*/i,
            '',
          )
          .trim();
        uniquePassages.add(cleaned);
      }
    }
    let totalSentences = 0;
    for (const passage of uniquePassages) {
      let count = 0;
      for (const seg of segmenter.segment(passage)) {
        if (seg.segment.trim().length > 0) count++;
      }
      totalSentences += count;
    }
    console.log(
      `Quiz ${q.id} ("${q.title}"): ${uniquePassages.size} unique passages, ${totalSentences} sentences total.`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
