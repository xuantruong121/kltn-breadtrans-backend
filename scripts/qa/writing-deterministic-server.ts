import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { AI_EVALUATOR_TOKEN } from '../../src/modules/ai/strategies/ai-evaluator.interface';
import type { IAIEvaluator } from '../../src/modules/ai/strategies/ai-evaluator.interface';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer } from 'node:http';
import { AnswerReviewService } from '../../src/modules/ai/review/answer-review.service';
import type { AnswerReviewer } from '../../src/modules/ai/review/answer-reviewer';
import { CLOUDFLARE_UNAVAILABLE } from '../../src/modules/ai/cloudflare-workers-ai.client';

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

/** Deterministic grammar candidates; the answer is always option A. */
function deterministicGrammarQuestions(count: number) {
  return Array.from(
    { length: Math.min(Math.max(count || 3, 1), 5) },
    (_, i) => ({
      question: `Câu kiểm thử ${i + 1}: She ____ to work yesterday.`,
      options: ['went', 'goes', 'go', 'going'],
      correctIndex: 0,
      explanation: 'yesterday là mốc quá khứ nên dùng quá khứ đơn.',
      optionExplanations: [
        '',
        'Hiện tại đơn, không hợp với yesterday.',
        'Động từ nguyên mẫu, thiếu chia thì.',
        'Dạng V-ing cần trợ động từ.',
      ],
    }),
  );
}

// ---- deterministic TOEIC exam author, for the exam AI browser run
let examSerial = 0;
const words = (count: number, seed: number) =>
  Array.from({ length: count }, (_, i) => `word${seed}x${i}`).join(' ');

function examBatch(input: {
  part: number;
  groups: Array<{
    questionCount: number;
    kind?: string;
    documents?: number;
    threeSpeakers?: boolean;
    graphic?: boolean;
  }>;
}) {
  const { part } = input;
  return {
    groups: input.groups.map((plan) => {
      const id = ++examSerial;
      const script =
        part === 3
          ? `M: ${words(60, id)}\nW1: ${words(50, id + 1000)}${plan.threeSpeakers ? `\nW2: ${words(10, id + 2000)}` : ''}`
          : part === 4
            ? `Speaker: ${words(130, id)}`
            : `Speaker: Prompt number ${id}.`;
      const passage = plan.documents
        ? Array.from(
            { length: plan.documents },
            (_, i) => `DOCUMENT ${i + 1}\nDocument body ${id}-${i}.`,
          ).join('\n\n')
        : part === 6
          ? `Passage ${id} _____ then _____ next _____ last _____ end.`
          : `Passage number ${id}.`;
      return {
        ...(part >= 2 && part <= 4 ? { transcript: script } : {}),
        ...(part === 1
          ? { imageBrief: `Two people at a desk, scene ${id}.` }
          : {}),
        ...(part >= 6 ? { passageText: passage } : {}),
        ...(plan.graphic
          ? {
              passageText: `GRAPHIC: Schedule ${id}\nTime | Room\n9:00 | A1\n10:00 | B2\n11:00 | C3`,
            }
          : {}),
        questions: Array.from({ length: plan.questionCount }, (_, q) => ({
          text:
            part === 5
              ? `Sentence ${id} needs a word _____ here.`
              : plan.graphic && q === plan.questionCount - 1
                ? `Look at the graphic. Which room is used ${id}?`
                : `What is asked in item ${id}-${q}?`,
          options: Array.from({ length: part === 2 ? 3 : 4 }, (_, o) =>
            part === 6 && q === 0
              ? `This is a whole sentence choice ${id}${o}.`
              : `Choice ${id}-${q}-${o}`,
          ),
          correctIndex: 0,
          explanation: `Giải thích tiếng Việt có dấu cho câu ${id}-${q}.`,
        })),
      };
    }),
  };
}

function examSpeakingWriting() {
  const speakingTypes = [
    'READ_ALOUD',
    'READ_ALOUD',
    'DESCRIBE_PICTURE',
    'DESCRIBE_PICTURE',
    'RESPOND_TO_QUESTION',
    'RESPOND_TO_QUESTION',
    'RESPOND_TO_QUESTION',
    'RESPOND_USING_INFORMATION',
    'RESPOND_USING_INFORMATION',
    'RESPOND_USING_INFORMATION',
    'EXPRESS_OPINION',
  ];
  const kinds = [
    'PICTURE_SENTENCE',
    'PICTURE_SENTENCE',
    'PICTURE_SENTENCE',
    'PICTURE_SENTENCE',
    'PICTURE_SENTENCE',
    'WRITTEN_REQUEST',
    'WRITTEN_REQUEST',
    'OPINION_ESSAY',
  ];
  return {
    speaking: speakingTypes.map((taskType, index) => ({
      taskType,
      title: `Speaking ${index + 1}`,
      targetText: `Speaking prompt number ${index + 1}.`,
      ...(index === 2 || index === 3
        ? { imageBrief: `A busy shop, view ${index}.` }
        : {}),
      ...(index >= 7 && index <= 9
        ? { informationStimulus: '9:00 Opening | 10:00 Workshop' }
        : {}),
    })),
    writing: kinds.map((taskKind, index) => ({
      taskKind,
      title: `Writing ${index + 1}`,
      prompt: `Writing task number ${index + 1}.`,
      ...(taskKind === 'PICTURE_SENTENCE'
        ? {
            imageBrief: `A man carrying boxes, view ${index}.`,
            keywords: ['carry', 'box'],
          }
        : {}),
      ...(taskKind === 'WRITTEN_REQUEST'
        ? {
            email:
              'From: Linh Tran\nSubject: Meeting\nCould you confirm Friday at ten for the review?',
          }
        : {}),
      ...(taskKind === 'OPINION_ESSAY' ? { wordRange: [300, 500] } : {}),
    })),
  };
}

const examModeFile = process.env.QA_EXAM_MODE_FILE;
const examMode = () => {
  try {
    return examModeFile ? readFileSync(examModeFile, 'utf8').trim() : '';
  } catch {
    return '';
  }
};
/** Writes the same content when Gemini is "out of quota", as Cloudflare would. */
function startFakeCloudflare() {
  const port = Number(process.env.QA_FAKE_CLOUDFLARE_PORT ?? 0);
  if (!port) return;
  createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const prompt: string =
        JSON.parse(body || '{}').messages?.[1]?.content ?? '';
      const part = Number(/TOEIC-style Part (\d)/.exec(prompt)?.[1] ?? 0);
      const groups = [
        ...prompt.matchAll(/Group \d+: (\d+) questions(?: \(([^)]*)\))?/g),
      ].map((m) => ({
        questionCount: Number(m[1]),
        documents:
          Number(/exactly (\d) documents/.exec(m[2] ?? '')?.[1] ?? 0) ||
          undefined,
        threeSpeakers: /three speakers/.test(m[2] ?? ''),
        graphic: /with a graphic/.test(m[2] ?? ''),
      }));
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          success: true,
          result: {
            response: JSON.stringify(
              part ? examBatch({ part, groups }) : examSpeakingWriting(),
            ),
          },
        }),
      );
    });
  }).listen(port, '127.0.0.1');
}

const provider = {
  generateFeedback: async () => 'Deterministic generic feedback.',
  generateToeicExamBatch: async (input: any) => {
    const mode = examMode();
    if (mode === 'quota')
      throw Object.assign(new Error('quota exhausted'), { status: 429 });
    if (mode === 'broken-part-5' && input.part === 5)
      return { groups: [{ questions: [] }] };
    return examBatch(input);
  },
  generateToeicSpeakingWritingDraft: async () => examSpeakingWriting(),
  suggestVocabFullDraft: async (input: { count: number; topic: string }) => ({
    title: input.topic,
    description: 'Bộ từ soạn cho kiểm thử.',
    categoryName: 'QA',
    words: Array.from({ length: input.count }, (_, i) => ({
      word: `qaword${i}`,
      pos: 'noun',
      meaning: `nghĩa ${i}`,
      exampleEn: `Example ${i}.`,
      exampleVi: `Ví dụ ${i}.`,
    })),
  }),
  chat: async () => 'Deterministic chat response.',
  // The tutor: the same fixed text, plus what item reached the prompt, so a
  // QA script can tell whether the server attached the item (and its key).
  tutorChat: async (prompt: string) => {
    const item = /Bài đang hỏi \((.+?)\):/.exec(prompt)?.[1];
    if (!item) return 'Deterministic chat response.';
    const key = /- Đáp án đúng: (.+)/.exec(prompt)?.[1] ?? 'none';
    return `Deterministic chat response. [item: ${item}] [key: ${key}]`;
  },
  assessPronunciation: async () => ({
    overallScore: 0,
    clarity: 'Poor',
    feedback: 'Not available in Writing acceptance provider.',
    problematicWords: [],
    suggestions: [],
  }),
  explainToeicError: async () => 'Deterministic explanation.',
  generateToeicQuestions: async () => [],
  // CMS drafts from a document: two decks that repeat a word, so review tests
  // see the de-duplication; dictation lines are fixed sentences.
  suggestVocabDecksFromDocument: async () => ({
    decks: [
      {
        title: 'Hoá đơn',
        description: 'Từ về hoá đơn',
        level: 'B1',
        words: [
          {
            word: 'invoice',
            pos: 'noun',
            meaning: 'hoá đơn',
            exampleEn: 'Send the invoice.',
            exampleVi: 'Gửi hoá đơn.',
          },
          {
            word: 'budget',
            pos: 'noun',
            meaning: 'ngân sách',
            exampleEn: 'Check the budget.',
            exampleVi: 'Xem ngân sách.',
          },
        ],
      },
      {
        title: 'Vận chuyển',
        description: 'Từ về vận chuyển',
        level: 'B1',
        words: [
          {
            word: 'Budget',
            pos: 'noun',
            meaning: 'ngân sách',
            exampleEn: 'A small budget.',
            exampleVi: 'Ngân sách nhỏ.',
          },
          {
            word: 'shipment',
            pos: 'noun',
            meaning: 'lô hàng',
            exampleEn: 'The shipment arrived.',
            exampleVi: 'Lô hàng đã đến.',
          },
        ],
      },
    ],
  }),
  suggestDictationLines: async (input: { count: number }) => ({
    title: 'Chép chính tả kiểm thử',
    description: 'Bản nháp kiểm thử.',
    sentences: Array.from(
      { length: input.count },
      (_, i) => `This is test sentence number ${i + 1} for dictation.`,
    ),
  }),
  // Dictionary lookups: a fixed Vietnamese meaning, so an external result is
  // complete and the store keeps it for review (F13).
  enrichDictionaryEntry: async (input: { word: string }) => ({
    meaningVi: `nghĩa kiểm thử của ${input.word}`,
  }),
  // Grammar authoring: fixed candidates with why-wrong notes (F14).
  suggestGrammarQuestions: async (input: { count: number }) => ({
    candidates: deterministicGrammarQuestions(input.count),
  }),
  suggestGrammarFullDraft: async (input: {
    topicTitle?: string;
    level?: string;
    count: number;
  }) => ({
    title: input.topicTitle ?? 'Chủ đề kiểm thử',
    description: 'Lý thuyết kiểm thử.\nMỗi ý một dòng.',
    level: input.level ?? 'BEGINNER',
    keyFormula: 'S + V2/V-ed',
    questions: deterministicGrammarQuestions(input.count),
  }),
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
    // Other practice tasks ask for task relevance: "[[offtopic]]" or
    // "[[partial]]" set it; ON_TASK otherwise. "[[delay:NNNN]]" waits NNNN ms
    // before answering (refresh / in-flight checks).
    const wantsRelevance =
      input.responseSchema?.required?.includes('taskRelevance');
    const relevance = /\[\[offtopic\]\]/.test(data.learnerResponse)
      ? 'OFF_TOPIC'
      : /\[\[partial\]\]/.test(data.learnerResponse)
        ? 'PARTIAL'
        : 'ON_TASK';
    const delay = /\[\[delay:(\d{1,5})\]\]/.exec(data.learnerResponse);
    if (delay) await new Promise((r) => setTimeout(r, Number(delay[1])));
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
        ...(wantsRelevance
          ? {
              taskRelevance: relevance,
              relevanceEvidence:
                relevance === 'OFF_TOPIC'
                  ? 'Bài viết nói về chủ đề khác, không làm đúng yêu cầu của đề.'
                  : 'Bài viết làm đúng tình huống và yêu cầu của đề.',
            }
          : {}),
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

/**
 * Deterministic answer reviewer. examBatch marks its key as the option whose
 * last character (before a final ".") is "0", so the solver can find it after
 * the options were shuffled. QA modes in QA_EXAM_MODE_FILE:
 *   review-disagree-part-5  the solver picks another option for Part 5
 *   review-cloudflare-down  Cloudflare is unreachable, Gemini answers
 *   review-outage           every reviewer is unreachable
 */
function deterministicReviewer(name: 'cloudflare' | 'gemini'): AnswerReviewer {
  const isKey = (option: string) => /0$/.test(option.trim().replace(/\.$/, ''));
  return {
    name,
    supportsImages: name === 'gemini',
    configured: () => true,
    model: () =>
      name === 'cloudflare' ? '@cf/openai/gpt-oss-120b' : 'gemini-qa',
    vendor: () => (name === 'cloudflare' ? 'openai' : 'google'),
    reviewJson: async (prompt) => {
      const qaMode = examMode();
      if (
        qaMode === 'review-outage' ||
        (qaMode === 'review-cloudflare-down' && name === 'cloudflare')
      )
        throw Object.assign(new Error('reviewer unreachable'), {
          code: CLOUDFLARE_UNAVAILABLE,
        });
      const data = JSON.parse(prompt.prompt.split('DATA:\n')[1] ?? '{}');
      const model =
        name === 'cloudflare' ? '@cf/openai/gpt-oss-120b' : 'gemini-qa';
      if (Array.isArray(data.statements)) {
        const key = data.statements.findIndex(isKey);
        return {
          model,
          data: {
            choice: key >= 0 ? key : 0,
            alsoCorrect: [],
            answerable: true,
            reasoning: 'deterministic vision',
          },
        };
      }
      const explaining = 'checks' in ((prompt.schema as any).properties ?? {});
      const rows = (data.groups ?? []).flatMap((group: any) =>
        group.questions.map((question: any) => ({ group, question })),
      );
      const disagree =
        qaMode === 'review-disagree-part-5' && data.part === 5 && !explaining;
      const pick = (options: string[]) => {
        const key = Math.max(0, options.findIndex(isKey));
        return disagree ? (key + 1) % options.length : key;
      };
      return {
        model,
        data: explaining
          ? {
              checks: rows.map(({ question }: any) => ({
                id: question.id,
                claimedChoice: pick(question.options),
                supportsClaim: true,
                containsContradiction: false,
                reasoning: 'deterministic explanation check',
              })),
            }
          : {
              answers: rows.map(({ group, question }: any) => ({
                id: question.id,
                choice: pick(question.options),
                alsoCorrect: [],
                answerable: true,
                evidence: group.stimulus
                  ? [String(group.stimulus).trim().slice(0, 24)]
                  : [],
                reasoning: 'deterministic solve',
                evidenceSupportsAnswer: true,
              })),
            },
      };
    },
  };
}

async function bootstrap() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AI_EVALUATOR_TOKEN)
    .useValue(provider)
    .compile();
  moduleRef
    .get(AnswerReviewService)
    .useReviewers([
      deterministicReviewer('cloudflare'),
      deterministicReviewer('gemini'),
    ]);
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

startFakeCloudflare();
bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
