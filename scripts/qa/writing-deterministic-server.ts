import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { AI_EVALUATOR_TOKEN } from '../../src/modules/ai/strategies/ai-evaluator.interface';
import type { IAIEvaluator } from '../../src/modules/ai/strategies/ai-evaluator.interface';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const mode =
  process.env.WRITING_QA_PROVIDER_MODE === 'failure' ? 'failure' : 'success';
const counterFile = process.env.WRITING_QA_COUNTER_FILE;
let calls = 0;

function persistCounter() {
  if (!counterFile) return;
  mkdirSync(dirname(counterFile), { recursive: true });
  writeFileSync(counterFile, JSON.stringify({ mode, calls }), 'utf8');
}

function evaluate(score: number) {
  calls += 1;
  persistCounter();
  if (mode === 'failure')
    throw new Error('deterministic writing provider unavailable');
  return {
    score,
    feedback: 'Nhận xét tất định cho bài kiểm thử.',
    suggestions: ['Gợi ý cải thiện tất định.'],
  };
}

const provider = {
  generateFeedback: async () => 'Deterministic generic feedback.',
  chat: async () => 'Deterministic chat response.',
  assessPronunciation: async () => ({
    overallScore: 0,
    clarity: 'Poor',
    feedback: 'Not available in Writing acceptance provider.',
    problematicWords: [],
    suggestions: [],
  }),
  explainToeicError: async () => 'Deterministic explanation.',
  generateToeicQuestions: async () => [],
  generateDictation: async () => [],
  evaluateWritingPart1: async () => evaluate(3),
  evaluateWritingPart2: async () => evaluate(4),
  evaluateWritingPart3: async () => evaluate(5),
  evaluateSpeakingPart3To5: async () => evaluate(5),
  // Practice Writing (PRACTICE_WRITING_V1): one point below full marks on the
  // first criterion, and a correction only when the learner wrote "ask" after
  // a singular subject, quoted from the learner text.
  generateStructuredJson: async (input: {
    prompt: string;
    responseSchema?: { required?: string[] };
  }) => {
    calls += 1;
    persistCounter();
    if (mode === 'failure')
      throw new Error('deterministic writing provider unavailable');
    const data = JSON.parse(input.prompt) as {
      rubric: Array<{ key: string; max: number }>;
      learnerResponse: string;
    };
    // QA markers in the learner text: "[[fail]]" makes this grading call
    // fail; "[[percent:NN]]" scores every criterion at NN % of its maximum.
    if (/\[\[fail\]\]/.test(data.learnerResponse))
      throw new Error('deterministic writing provider unavailable');
    const pct = /\[\[percent:(\d{1,3})\]\]/.exec(data.learnerResponse);
    const slip = /\b(\w+) ask\b/.exec(data.learnerResponse);
    // Picture tasks ask for a relevance verdict: "[[scene:MISMATCH]]" (or
    // PARTIAL / UNCERTAIN) sets it; MATCH otherwise.
    const wantsScene = input.responseSchema?.required?.includes('sceneMatch');
    const scene = /\[\[scene:(MATCH|PARTIAL|MISMATCH|UNCERTAIN)\]\]/.exec(
      data.learnerResponse,
    );
    return {
      model: 'deterministic',
      text: JSON.stringify({
        criteria: data.rubric.map((c, i) => ({
          key: c.key,
          score: pct
            ? Math.round((c.max * Number(pct[1])) / 100)
            : i === 0
              ? c.max - 1
              : c.max,
          comment: 'Nhận xét tất định cho tiêu chí này.',
        })),
        strengths: ['Bài viết đúng chủ đề.'],
        corrections: slip
          ? [
              {
                original: slip[0],
                corrected: `${slip[1]} asks`,
                explanation: 'Chủ ngữ số ít nên động từ thêm "s".',
              },
            ]
          : [],
        feedback: 'Nhận xét tất định: bài viết đáp ứng yêu cầu chính của đề.',
        suggestions: ['Kiểm tra lại cách chia động từ.'],
        ...(wantsScene
          ? {
              sceneMatch: scene?.[1] ?? 'MATCH',
              sceneEvidence:
                'Nhận định tất định về mức độ khớp với nội dung bức tranh.',
            }
          : {}),
      }),
    };
  },
  importEtsPdf: async () => [],
  generateSmartContentFromDocument: async () => ({
    quizQuestions: [],
    flashcards: [],
    assignment: { title: 'QA', description: 'QA', instructions: 'QA' },
  }),
} as unknown as IAIEvaluator;

async function bootstrap() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AI_EVALUATOR_TOKEN)
    .useValue(provider)
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableCors({ origin: true, credentials: true });
  persistCounter();
  await app.listen(Number(process.env.PORT ?? 3101), '127.0.0.1');
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
