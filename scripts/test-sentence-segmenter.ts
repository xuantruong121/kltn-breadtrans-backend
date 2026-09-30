import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function countSentences(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  const cleaned = text.trim();
  if (!cleaned) return 0;

  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    const segments = Array.from(segmenter.segment(cleaned));
    // Filter segments that contain at least one letter or digit (avoid standalone whitespace/punctuation)
    const validSegments = segments.filter((s) =>
      /[a-zA-Z0-9]/.test(s.segment.trim()),
    );
    return validSegments.length;
  }

  // Fallback regex
  const matches = cleaned.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g);
  return matches
    ? matches.filter((s) => /[a-zA-Z0-9]/.test(s.trim())).length
    : 0;
}

async function main() {
  const quizzes = await prisma.quiz.findMany({
    where: { type: 'BILINGUAL_READING' },
    include: { questions: true },
  });

  for (const q of quizzes) {
    const seen = new Set<string>();
    const uniquePassages: string[] = [];
    for (const qn of q.questions) {
      const p = (qn.content as any)?.passage;
      if (typeof p === 'string') {
        const normalized = p.trim().replace(/\r\n/g, '\n');
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          uniquePassages.push(normalized);
        }
      }
    }

    let totalSentences = 0;
    console.log(`\nQuiz ${q.id}: "${q.title}"`);
    console.log(`  Unique Passages: ${uniquePassages.length}`);
    uniquePassages.forEach((p, idx) => {
      const sc = countSentences(p);
      totalSentences += sc;
      console.log(
        `    Passage ${idx + 1}: ${sc} sentences | preview: "${p.slice(0, 40).replace(/\n/g, ' ')}..."`,
      );
    });
    console.log(`  Total Sentences for Quiz: ${totalSentences}`);
  }
}

main().finally(() => prisma.$disconnect());
