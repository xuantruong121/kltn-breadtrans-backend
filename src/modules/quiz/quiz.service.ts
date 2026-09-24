import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ListeningPracticeAttemptStatus,
  Prisma,
  QuizType,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateQuizDto,
  CreateQuestionDto,
  SubmitQuizDto,
  CheckPracticeQuestionDto,
  SaveListeningAttemptDto,
  PublishQuizDto,
} from './dto/quiz.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiService } from '../ai/ai.service';
import { SpeakingService } from '../speaking/speaking.service';
import { UploadService } from '../upload/upload.service';
import {
  ListeningAudioAuthoringService,
  PublishedListeningAudioIdentity,
} from './listening-audio-authoring.service';
import {
  normalizeDialogueSegments,
  withSpeakerTurnIds,
  type NormalizedDialogueSegment,
} from './listening-dialogue.contract';

/**
 * Compare learner dictation without penalising typography that does not change
 * what was heard (capitalisation, punctuation, curly apostrophes or spacing).
 */
export function normalizeListeningAnswer(value: unknown): string {
  return normalizeStandardListeningTokens(value).join(' ');
}

/**
 * Validate a Reading submission against the server-owned current question set.
 * The validator intentionally runs before any persistence or side effect.
 */
export function validateReadingSubmission(
  questions: Array<{ id: number; type?: string; content?: unknown }>,
  answers: Array<{ questionId: number; answer: unknown }>,
) {
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    throw new BadRequestException(
      'Hãy trả lời đầy đủ tất cả câu hỏi trước khi nộp bài',
    );
  }

  const questionsById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const seenQuestionIds = new Set<number>();

  for (const submitted of answers) {
    const question = questionsById.get(submitted.questionId);
    if (!question) {
      throw new BadRequestException(
        'Câu trả lời chứa câu hỏi không thuộc bài này',
      );
    }
    if (seenQuestionIds.has(submitted.questionId)) {
      throw new BadRequestException('Không được gửi trùng câu hỏi');
    }
    if (
      typeof submitted.answer !== 'string' ||
      submitted.answer.trim().length === 0
    ) {
      throw new BadRequestException('Mỗi câu hỏi phải có một câu trả lời');
    }

    const content = (question.content ?? {}) as Record<string, unknown>;
    const options = content.options;
    if (
      question.type === 'MULTIPLE_CHOICE' &&
      Array.isArray(options) &&
      !options.some((option) => option === submitted.answer)
    ) {
      throw new BadRequestException(
        'Câu trả lời không nằm trong các lựa chọn hiện tại',
      );
    }

    seenQuestionIds.add(submitted.questionId);
  }
}

const STANDARD_CONTRACTIONS: Record<string, string[]> = {
  "we're": ['we', 'are'],
  "you're": ['you', 'are'],
  "they're": ['they', 'are'],
  "we've": ['we', 'have'],
  "i've": ['i', 'have'],
  "they've": ['they', 'have'],
  "we'll": ['we', 'will'],
  "i'll": ['i', 'will'],
  "they'll": ['they', 'will'],
  "can't": ['cannot'],
  "won't": ['will', 'not'],
  "don't": ['do', 'not'],
  "doesn't": ['does', 'not'],
  "didn't": ['did', 'not'],
  "isn't": ['is', 'not'],
  "aren't": ['are', 'not'],
  "wasn't": ['was', 'not'],
  "weren't": ['were', 'not'],
  "hasn't": ['has', 'not'],
  "haven't": ['have', 'not'],
  "hadn't": ['had', 'not'],
  "let's": ['let', 'us'],
  // Apostrophe-free forms remain compatible with STANDARD's punctuation policy.
  lets: ['let', 'us'],
  its: ['it', 'is'],
};

const AMBIGUOUS_CONTRACTIONS: Record<string, [string[], string[]]> = {
  "i'd": [
    ['i', 'would'],
    ['i', 'had'],
  ],
  "we'd": [
    ['we', 'would'],
    ['we', 'had'],
  ],
  "they'd": [
    ['they', 'would'],
    ['they', 'had'],
  ],
  "he's": [
    ['he', 'is'],
    ['he', 'has'],
  ],
  "she's": [
    ['she', 'is'],
    ['she', 'has'],
  ],
  "it's": [
    ['it', 'is'],
    ['it', 'has'],
  ],
  "that's": [
    ['that', 'is'],
    ['that', 'has'],
  ],
  "there's": [
    ['there', 'is'],
    ['there', 'has'],
  ],
};

function tokenizeStandardListeningAnswer(value: unknown): string[] {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’‘ʼ`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/(?<![\p{L}\p{N}])'+|'+(?![\p{L}\p{N}])/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function looksLikePastParticiple(token: string | undefined): boolean {
  if (!token) return false;
  return (
    /(?:ed|en)$/.test(token) ||
    new Set([
      'gone',
      'done',
      'seen',
      'been',
      'had',
      'made',
      'left',
      'read',
    ]).has(token)
  );
}

function expandStandardContraction(
  token: string,
  nextToken?: string,
): string[] {
  const direct = STANDARD_CONTRACTIONS[token];
  if (direct) return direct;
  const ambiguous = AMBIGUOUS_CONTRACTIONS[token];
  if (!ambiguous) return [token];
  return looksLikePastParticiple(nextToken) ? ambiguous[1] : ambiguous[0];
}

/**
 * STANDARD mode compares lexical content while treating ordinary contractions
 * and their canonical full forms as equivalent. Ambiguous forms are resolved
 * from their local sentence context instead of being expanded many-to-many.
 */
export function normalizeStandardListeningTokens(value: unknown): string[] {
  const tokens = tokenizeStandardListeningAnswer(value);
  return tokens.flatMap((token, index) =>
    expandStandardContraction(token, tokens[index + 1]),
  );
}

/**
 * Keep speaker labels for the visual transcript, but never send labels such as
 * "Customer:" or "Agent:" to speech synthesis. Reading those labels aloud
 * makes a dialogue sound like metadata instead of a natural conversation.
 */
export function buildNaturalListeningAudioText(
  content: Record<string, unknown>,
): string {
  const segments = content.transcriptSegments;
  if (Array.isArray(segments)) {
    const spokenLines = segments
      .filter(
        (segment): segment is { text: string } =>
          Boolean(segment) &&
          typeof segment === 'object' &&
          typeof (segment as { text?: unknown }).text === 'string',
      )
      .map((segment) => segment.text.trim())
      .filter(Boolean);

    if (spokenLines.length > 0) return spokenLines.join(' ');
  }

  const audioText =
    typeof content.audioText === 'string' ? content.audioText : '';
  return audioText
    .replace(
      /(^|\s)(?:customer|agent|barista|assistant|employee|manager|interviewer|caller|staff|speaker\s*\d*)\s*:\s*/gi,
      '$1',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export { normalizeDialogueSegments } from './listening-dialogue.contract';

function dedupeDialogueBlocks(
  blocks: NormalizedDialogueSegment[][],
): NormalizedDialogueSegment[] {
  const seen = new Set<string>();
  return blocks.flatMap((block) => {
    const key = JSON.stringify(
      block.map(({ speaker, speakerId, text, translation }) => ({
        speaker,
        speakerId,
        text,
        translation,
      })),
    );
    if (seen.has(key)) return [];
    seen.add(key);
    return block;
  });
}

function normalizeQuestionContent(
  quizType: QuizType,
  questionType: string,
  value: unknown,
): Record<string, unknown> {
  const content =
    value && typeof value === 'object'
      ? { ...(value as Record<string, unknown>) }
      : {};

  if (
    quizType === QuizType.LISTENING_PRACTICE &&
    questionType.toUpperCase() === 'DIALOGUE'
  ) {
    const transcriptSegments = withSpeakerTurnIds(
      normalizeDialogueSegments(content.transcriptSegments),
    );
    const speakers = new Set(
      transcriptSegments.map((segment) => segment.speakerId ?? segment.speaker),
    );
    if (transcriptSegments.length < 2 || speakers.size < 2) {
      throw new BadRequestException(
        'Hội thoại cần ít nhất 2 lượt lời và 2 người nói khác nhau.',
      );
    }
    content.transcriptSegments = transcriptSegments;
    content.audioText = transcriptSegments
      .map((segment) => segment.text)
      .join(' ');
  }

  return content;
}

function normalizeStrictListeningAnswer(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateDictationWordAccuracy(
  expected: string,
  submitted: string,
  mode: 'STANDARD' | 'STRICT',
): number {
  const normalize =
    mode === 'STRICT'
      ? normalizeStrictListeningAnswer
      : normalizeListeningAnswer;
  const expectedWords =
    mode === 'STANDARD'
      ? normalizeStandardListeningTokens(expected)
      : normalize(expected).split(/\s+/).filter(Boolean);
  const submittedWords =
    mode === 'STANDARD'
      ? normalizeStandardListeningTokens(submitted)
      : normalize(submitted).split(/\s+/).filter(Boolean);
  if (expectedWords.length === 0) return 0;

  const dp = Array.from({ length: expectedWords.length + 1 }, () =>
    new Array<number>(submittedWords.length + 1).fill(0),
  );
  for (let i = 1; i <= expectedWords.length; i += 1) {
    for (let j = 1; j <= submittedWords.length; j += 1) {
      dp[i][j] =
        expectedWords[i - 1] === submittedWords[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return Math.round(
    (dp[expectedWords.length][submittedWords.length] / expectedWords.length) *
      100,
  );
}

@Injectable()
export class QuizService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private aiService: AiService,
    private speakingService: SpeakingService,
    private uploadService: UploadService,
    private listeningAudioAuthoringService: ListeningAudioAuthoringService,
  ) {}

  async createQuiz(dto: CreateQuizDto, user?: { id: number; role: Role }) {
    if (user && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền tạo bài kiểm tra',
      );
    }
    return this.prisma.quiz.create({ data: dto });
  }

  async updateQuiz(
    id: number,
    dto: Partial<CreateQuizDto>,
    user?: { id: number; role: Role },
  ) {
    const existing = await this.prisma.quiz.findUnique({
      where: { id },
      include: { course: true },
    });
    if (!existing) throw new NotFoundException('Quiz not found');

    if (user && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền chỉnh sửa bài kiểm tra',
      );
    }

    return this.prisma.quiz.update({
      where: { id },
      data: dto,
    });
  }

  async publishQuiz(id: number, status: PublishQuizDto['status']) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: { questions: { select: { type: true } } },
    });
    if (!quiz) throw new NotFoundException('Quiz not found');
    if (
      status === 'PUBLISHED' &&
      quiz.type === QuizType.LISTENING_PRACTICE &&
      quiz.questions.length > 0 &&
      quiz.questions.every((question) => question.type === 'DICTATION') &&
      quiz.questions.length < 20
    ) {
      throw new BadRequestException(
        'Bài nghe chép cần có ít nhất 20 câu trước khi xuất bản',
      );
    }
    return this.prisma.quiz.update({
      where: { id },
      data: {
        publicationStatus: status,
        publishedAt: status === 'PUBLISHED' ? new Date() : quiz.publishedAt,
      },
    });
  }

  async deleteQuiz(id: number, user?: { id: number; role: Role }) {
    const existing = await this.prisma.quiz.findUnique({
      where: { id },
      include: { course: true },
    });
    if (!existing) throw new NotFoundException('Quiz not found');

    if (user && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Chỉ Quản trị viên mới có quyền xóa bài kiểm tra',
      );
    }

    return this.prisma.quiz.delete({
      where: { id },
    });
  }

  async getAllQuizzes() {
    return this.prisma.quiz.findMany({
      include: {
        _count: {
          select: { questions: true },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
  }

  async getListeningPractices(userId?: number) {
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        type: 'LISTENING_PRACTICE',
        publicationStatus: 'PUBLISHED',
      },
      include: {
        _count: {
          select: { questions: true },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });

    const toCatalogItem = (
      quiz: (typeof quizzes)[number],
      isCompleted: boolean,
    ) => {
      const metadata = (quiz.bilingualContent ?? {}) as Record<string, unknown>;
      const stringArray = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : [];
      const durationMinutes = Number(metadata.durationMinutes);

      return {
        ...quiz,
        mode:
          metadata.mode === 'DICTATION'
            ? 'DICTATION'
            : metadata.mode === 'DIALOGUE'
              ? 'DIALOGUE'
              : 'COMPREHENSION',
        track:
          metadata.track === 'TOEIC_LISTENING'
            ? 'TOEIC_LISTENING'
            : 'GENERAL_ENGLISH',
        levels: stringArray(metadata.levels),
        topics: stringArray(metadata.topics),
        accents: stringArray(metadata.accents),
        questionCount: quiz._count.questions,
        durationMinutes: Number.isFinite(durationMinutes)
          ? durationMinutes
          : quiz.timeLimit,
        isCompleted,
      };
    };

    if (!userId) return quizzes.map((quiz) => toCatalogItem(quiz, false));

    // Check user submissions to see which ones are completed
    const userSubmissions = await this.prisma.submission.findMany({
      where: {
        userId,
        quizId: { in: quizzes.map((q) => q.id) },
      },
      select: { quizId: true },
    });

    const completedQuizIds = new Set(userSubmissions.map((s) => s.quizId));

    return quizzes.map((quiz) =>
      toCatalogItem(quiz, completedQuizIds.has(quiz.id)),
    );
  }

  private async assertListeningPracticeQuiz(quizId: number) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: { id: true, type: true },
    });
    if (!quiz) throw new NotFoundException('Không tìm thấy bài luyện nghe');
    if (quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new ForbiddenException('Phiên chỉ dành cho bài luyện nghe');
    }
    return quiz;
  }

  async getOrCreateListeningAttempt(userId: number, quizId: number) {
    await this.assertListeningPracticeQuiz(quizId);
    const existing = await this.prisma.listeningPracticeAttempt.findFirst({
      where: {
        userId,
        quizId,
        status: ListeningPracticeAttemptStatus.IN_PROGRESS,
      },
      orderBy: { updatedAt: 'desc' },
    });
    let attempt = existing;
    if (!attempt) {
      try {
        attempt = await this.prisma.listeningPracticeAttempt.create({
          data: { userId, quizId },
        });
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
        attempt = await this.prisma.listeningPracticeAttempt.findFirst({
          where: {
            userId,
            quizId,
            status: ListeningPracticeAttemptStatus.IN_PROGRESS,
          },
          orderBy: { updatedAt: 'desc' },
        });
        if (!attempt) throw error;
      }
    }
    return {
      id: attempt.id,
      quizId: attempt.quizId,
      currentQuestionId: attempt.currentQuestionId,
      answers: attempt.answers,
      questionStates: attempt.questionStates,
      status: attempt.status,
      startedAt: attempt.startedAt,
      updatedAt: attempt.updatedAt,
    };
  }

  async saveListeningAttempt(
    userId: number,
    quizId: number,
    attemptId: number,
    dto: SaveListeningAttemptDto,
  ) {
    await this.assertListeningPracticeQuiz(quizId);
    const attempt = await this.prisma.listeningPracticeAttempt.findFirst({
      where: { id: attemptId, userId, quizId },
    });
    if (!attempt)
      throw new NotFoundException('Không tìm thấy phiên luyện nghe');
    if (attempt.status !== ListeningPracticeAttemptStatus.IN_PROGRESS) {
      throw new ForbiddenException('Phiên luyện nghe đã kết thúc');
    }
    if (dto.currentQuestionId !== undefined) {
      const question = await this.prisma.question.findFirst({
        where: { id: dto.currentQuestionId, quizId },
        select: { id: true },
      });
      if (!question)
        throw new BadRequestException('Câu hỏi không thuộc bài luyện này');
    }
    const updated = await this.prisma.listeningPracticeAttempt.update({
      where: { id: attemptId },
      data: {
        ...(dto.currentQuestionId !== undefined
          ? { currentQuestionId: dto.currentQuestionId }
          : {}),
        ...(dto.answers !== undefined
          ? { answers: dto.answers as Prisma.InputJsonValue }
          : {}),
        ...(dto.questionStates !== undefined
          ? { questionStates: dto.questionStates as Prisma.InputJsonValue }
          : {}),
      },
    });
    return {
      id: updated.id,
      quizId: updated.quizId,
      currentQuestionId: updated.currentQuestionId,
      answers: updated.answers,
      questionStates: updated.questionStates,
      status: updated.status,
      startedAt: updated.startedAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Discard an unfinished listening session.  This is deliberately separate
   * from saving progress: confirming "Thoát bài luyện" must make the next
   * launch start clean instead of restoring a server checkpoint.
   */
  async cancelListeningAttempt(
    userId: number,
    quizId: number,
    attemptId: number,
  ) {
    await this.assertListeningPracticeQuiz(quizId);
    const attempt = await this.prisma.listeningPracticeAttempt.findFirst({
      where: { id: attemptId, userId, quizId },
      select: { id: true, status: true },
    });
    if (!attempt) {
      throw new NotFoundException('Không tìm thấy phiên luyện nghe');
    }
    if (attempt.status !== ListeningPracticeAttemptStatus.IN_PROGRESS) {
      return { id: attempt.id, status: attempt.status, discarded: false };
    }

    const updated = await this.prisma.listeningPracticeAttempt.update({
      where: { id: attempt.id },
      data: {
        status: ListeningPracticeAttemptStatus.ABANDONED,
        completedAt: new Date(),
      },
      select: { id: true, status: true },
    });
    return { id: updated.id, status: updated.status, discarded: true };
  }

  async getToeicPapers(userId?: number) {
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        type: { in: [QuizType.TOEIC, QuizType.TOEIC_FOUR_SKILL] },
        OR: [
          { bilingualContent: { path: ['examFormat'], equals: 'TOEIC_LR' } },
          { bilingualContent: { path: ['examFormat'], equals: 'TOEIC_SW' } },
          {
            bilingualContent: {
              path: ['examFormat'],
              equals: 'TOEIC_4_SKILLS',
            },
          },
          { bilingualContent: { path: ['examFormat'], equals: 'TWO_SKILL' } },
          {
            bilingualContent: {
              path: ['examFormat'],
              equals: 'SPEAKING_WRITING',
            },
          },
          { bilingualContent: { path: ['examFormat'], equals: 'FOUR_SKILL' } },
        ],
      },
      include: { _count: { select: { questions: true } } },
      orderBy: { id: 'asc' },
    });

    const completedQuizIds = new Set<number>();
    if (userId) {
      const userSubmissions = await this.prisma.submission.findMany({
        where: {
          userId,
          quizId: { in: quizzes.map((quiz) => quiz.id) },
        },
        select: { quizId: true },
      });
      userSubmissions.forEach((s) => completedQuizIds.add(s.quizId));
    }

    return quizzes.map((quiz) => {
      const metadata = (quiz.bilingualContent ?? {}) as Record<string, unknown>;
      const linkedCount = Number(metadata.totalQuestions);
      return {
        ...quiz,
        questionsCount:
          Number.isFinite(linkedCount) && linkedCount > 0
            ? linkedCount
            : quiz._count.questions,
        isBundle: metadata.isBundle === true,
        isCompleted: completedQuizIds.has(quiz.id),
      };
    });
  }

  async getQuizById(id: number, includeAnswers = false, userId?: number) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: {
        questions: {
          orderBy: { order: 'asc' },
          include: {
            audioAssets: {
              where: { isActive: true },
              orderBy: { version: 'desc' },
            },
            diagnosticClips: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    if (!quiz) throw new NotFoundException('Quiz not found');

    // Timeline offsets are safe learning metadata (they contain no answers),
    // so expose them with the dialogue transcript when a published artifact
    // exists. This keeps the student player authoritative instead of falling
    // back to text-length timing heuristics.
    let listeningAudioArtifact: {
      id: number;
      version: number;
      checksumSha256: string | null;
      durationMs: number | null;
    } | null = null;
    if (
      quiz.type === QuizType.LISTENING_PRACTICE &&
      userId !== undefined &&
      quiz.questions.length > 0
    ) {
      const artifact =
        await this.listeningAudioAuthoringService.getCurrentPublishedArtifact(
          quiz.id,
        );
      if (artifact) {
        listeningAudioArtifact = {
          id: artifact.id,
          version: artifact.version,
          checksumSha256: artifact.checksumSha256,
          durationMs: artifact.durationMs,
        };
      }
      const timeline = Array.isArray(artifact?.timeline)
        ? new Map(
            artifact.timeline
              .filter(
                (
                  item,
                ): item is { turnId: string; startMs: number; endMs: number } =>
                  Boolean(item) &&
                  typeof item === 'object' &&
                  typeof (item as Record<string, unknown>).turnId ===
                    'string' &&
                  Number.isInteger((item as Record<string, unknown>).startMs) &&
                  Number.isInteger((item as Record<string, unknown>).endMs),
              )
              .map((item) => [item.turnId, item]),
          )
        : new Map<string, { turnId: string; startMs: number; endMs: number }>();
      let turnIndex = 0;
      quiz.questions = quiz.questions.map((question) => {
        const content =
          question.content && typeof question.content === 'object'
            ? { ...(question.content as Record<string, unknown>) }
            : null;
        if (!content || !Array.isArray(content.transcriptSegments))
          return question;
        const transcriptSegments = content.transcriptSegments.map((segment) => {
          if (!segment || typeof segment !== 'object') return segment;
          const turn = timeline.get(
            `turn-${String(++turnIndex).padStart(3, '0')}`,
          );
          return turn
            ? {
                ...(segment as Record<string, unknown>),
                startMs: turn.startMs,
                endMs: turn.endMs,
              }
            : segment;
        });
        return { ...question, content: { ...content, transcriptSegments } };
      });
    }

    if (quiz.type === QuizType.LISTENING_PRACTICE && userId === undefined) {
      throw new UnauthorizedException('Đăng nhập để bắt đầu luyện nghe');
    }

    // Draft and archived content is visible to administrators only. Learners
    // must never deep-link around the published catalog filter.
    if (
      !includeAnswers &&
      quiz.publicationStatus !== undefined &&
      quiz.publicationStatus !== 'PUBLISHED'
    ) {
      throw new NotFoundException('Bài luyện chưa được xuất bản');
    }

    if (!includeAnswers && quiz.questions) {
      const sanitizedQuestions = quiz.questions.map((q) => {
        if (!q.content || typeof q.content !== 'object') return q;
        const content = { ...(q.content as any) };
        delete content.correct;
        delete content.correctAnswer;
        delete content.correctIndex;
        delete content.explanation;
        if (quiz.type === QuizType.LISTENING_PRACTICE) {
          delete content.audioText;
        }
        return { ...q, content };
      });
      return {
        ...quiz,
        ...(listeningAudioArtifact ? { listeningAudioArtifact } : {}),
        questions: sanitizedQuestions,
      };
    }

    return {
      ...quiz,
      ...(listeningAudioArtifact ? { listeningAudioArtifact } : {}),
    };
  }

  /**
   * Transcript is intentionally loaded on demand. The regular learner quiz
   * payload redacts answers/audio text until the learner asks to review them;
   * this endpoint is limited to published listening-practice dictation items
   * and never serves TOEIC or other assessment content.
   */
  async revealListeningTranscript(userId: number, quizId: number) {
    await this.assertListeningPracticeQuiz(quizId);
    const attempt = await this.prisma.listeningPracticeAttempt.findFirst({
      where: {
        userId,
        quizId,
        status: {
          in: [
            ListeningPracticeAttemptStatus.IN_PROGRESS,
            ListeningPracticeAttemptStatus.COMPLETED,
          ],
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (!attempt) {
      throw new ForbiddenException(
        'Hãy bắt đầu bài luyện trước khi xem toàn bộ kịch bản.',
      );
    }
    return this.prisma.listeningTranscriptReveal.upsert({
      where: { userId_quizId: { userId, quizId } },
      create: { userId, quizId, attemptId: attempt.id },
      update: { attemptId: attempt.id, revealedAt: new Date() },
      select: { revealedAt: true },
    });
  }

  async getListeningTranscript(userId: number, quizId: number) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        type: true,
        publicationStatus: true,
        questions: {
          orderBy: { order: 'asc' },
          select: { id: true, type: true, order: true, content: true },
        },
      },
    });

    if (!quiz) throw new NotFoundException('Không tìm thấy bài luyện nghe');
    if (quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new ForbiddenException(
        'Transcript chỉ khả dụng cho bài luyện nghe chép',
      );
    }
    if (quiz.publicationStatus !== 'PUBLISHED') {
      throw new NotFoundException('Bài luyện chưa được xuất bản');
    }
    const transcriptQuestions = quiz.questions.filter((question) => {
      const content = (question.content ?? {}) as Record<string, unknown>;
      return (
        question.type === 'DICTATION' ||
        question.type === 'DIALOGUE' ||
        Array.isArray(content.transcriptSegments)
      );
    });
    const containsDictation = transcriptQuestions.some(
      (question) => question.type === 'DICTATION',
    );
    if (containsDictation) {
      const reveal = await this.prisma.listeningTranscriptReveal.findUnique({
        where: { userId_quizId: { userId, quizId } },
        select: { id: true },
      });
      if (!reveal) {
        throw new ForbiddenException(
          'Hãy xác nhận xem transcript trước khi tải nội dung.',
        );
      }
    }

    const dialogueBlocks = transcriptQuestions
      .map((question) =>
        normalizeDialogueSegments(
          (question.content as Record<string, unknown> | null)
            ?.transcriptSegments,
        ),
      )
      .filter((segments) => segments.length > 0);
    const hasMultiTurnDialogue = dialogueBlocks.some(
      (segments) => segments.length > 1,
    );
    const dedupedDialogueSegments = withSpeakerTurnIds(
      hasMultiTurnDialogue
        ? dedupeDialogueBlocks(dialogueBlocks)
        : dialogueBlocks.flat(),
    );
    let turnNumber = 0;
    const items = transcriptQuestions
      .flatMap((question) => {
        const content = (question.content ?? {}) as Record<string, unknown>;
        const canonicalSegments = normalizeDialogueSegments(
          content.transcriptSegments,
        );

        if (canonicalSegments.length > 0) {
          return canonicalSegments
            .map(() => {
              const segment = dedupedDialogueSegments[turnNumber];
              if (!segment) return null;
              turnNumber += 1;
              return {
                questionId: question.id,
                turnId: `turn-${String(turnNumber).padStart(3, '0')}`,
                order: turnNumber,
                transcript: segment.text,
                speaker: segment.speaker ?? segment.speakerId ?? null,
                speakerId: segment.speakerId ?? null,
                speakerTurnId: segment.speakerTurnId ?? null,
                translation: segment.translation ?? null,
                startMs: segment.startMs ?? null,
                endMs: segment.endMs ?? null,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);
        }

        const transcript =
          typeof content.correctAnswer === 'string'
            ? content.correctAnswer.trim()
            : typeof content.audioText === 'string'
              ? content.audioText.trim()
              : '';
        if (!transcript) return [];
        turnNumber += 1;
        return [
          {
            questionId: question.id,
            turnId: `turn-${String(turnNumber).padStart(3, '0')}`,
            order: turnNumber,
            transcript,
            speaker:
              typeof content.speaker === 'string' && content.speaker.trim()
                ? content.speaker.trim()
                : null,
            speakerId:
              typeof content.speakerId === 'string' && content.speakerId.trim()
                ? content.speakerId.trim()
                : null,
            speakerTurnId: null,
            translation:
              typeof content.translation === 'string'
                ? content.translation.trim() || null
                : null,
            startMs: null,
            endMs: null,
          },
        ];
      })
      .filter((item) => item.transcript.length > 0);

    const artifact =
      await this.listeningAudioAuthoringService.getCurrentPublishedArtifact(
        quiz.id,
      );
    const timelineByTurn = new Map<
      string,
      { startMs: number; endMs: number }
    >();
    if (artifact?.timeline && Array.isArray(artifact.timeline)) {
      for (const item of artifact.timeline) {
        if (!item || typeof item !== 'object') continue;
        const timelineItem = item as Record<string, unknown>;
        if (typeof timelineItem.turnId !== 'string') continue;
        if (
          !Number.isInteger(timelineItem.startMs) ||
          !Number.isInteger(timelineItem.endMs)
        )
          continue;
        timelineByTurn.set(timelineItem.turnId, {
          startMs: timelineItem.startMs as number,
          endMs: timelineItem.endMs as number,
        });
      }
    }
    return {
      quizId: quiz.id,
      audioArtifact: artifact
        ? {
            id: artifact.id,
            version: artifact.version,
            checksumSha256: artifact.checksumSha256,
            durationMs: artifact.durationMs,
          }
        : null,
      items: items.map((item) => ({
        ...item,
        startMs: timelineByTurn.get(item.turnId)?.startMs ?? null,
        endMs: timelineByTurn.get(item.turnId)?.endMs ?? null,
      })),
    };
  }

  /**
   * Builds one continuous audio track for a dictation exercise. The transcript
   * playlist may still move between individual lines, but playback must not
   * tear down and reload a new audio element for every line.
   */
  async streamListeningTranscriptAudio(
    quizId: number,
    requestedIdentity: PublishedListeningAudioIdentity = {},
  ) {
    const result = await this.listeningAudioAuthoringService.getPublishedAudio(
      quizId,
      requestedIdentity,
    );
    return result;
  }

  async createQuestion(quizId: number, dto: CreateQuestionDto) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: { id: true, type: true },
    });
    if (!quiz) throw new NotFoundException('Không tìm thấy đề thi');

    const content = normalizeQuestionContent(quiz.type, dto.type, dto.content);
    return this.prisma.question.create({
      data: {
        type: dto.type,
        content: content as Prisma.InputJsonValue,
        order: dto.order ?? 0,
        quizId,
      },
    });
  }

  async createAudioAsset(questionId: number, file: Express.Multer.File) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: {
        quiz: { select: { id: true, type: true } },
        audioAssets: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!question || question.quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new NotFoundException('Không tìm thấy câu luyện nghe');
    }
    const next = await this.prisma.quizAudioAsset.aggregate({
      where: { questionId },
      _max: { version: true },
    });
    const version = (next._max.version ?? 0) + 1;
    const isDialogue =
      question.type.toUpperCase() === 'DIALOGUE' &&
      Array.isArray(
        (question.content as Record<string, unknown>).transcriptSegments,
      );
    const folder = isDialogue
      ? `catalog/listening/practice/dialogue/quiz-${question.quiz.id}/question-${questionId}/v${version}`
      : `listening/quiz-${question.quiz.id}/question-${questionId}/v${version}`;
    const upload = await this.uploadService.uploadRawBuffer(
      file.buffer,
      file.mimetype,
      folder,
      file.originalname,
    );
    return this.prisma.$transaction(async (tx) => {
      await tx.quizAudioAsset.updateMany({
        where: { questionId },
        data: { isActive: false },
      });
      return tx.quizAudioAsset.create({
        data: {
          questionId,
          version,
          key: upload.key,
          url: upload.url,
          mimeType: upload.contentType,
          isActive: true,
        },
      });
    });
  }

  async generateDialogueAudioAsset(questionId: number) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { quiz: { select: { id: true, type: true } } },
    });
    if (
      !question ||
      question.quiz.type !== QuizType.LISTENING_PRACTICE ||
      question.type.toUpperCase() !== 'DIALOGUE'
    ) {
      throw new NotFoundException('Không tìm thấy câu hội thoại luyện nghe');
    }

    const content = question.content as Record<string, unknown>;
    const normalizedContent = normalizeQuestionContent(
      question.quiz.type,
      question.type,
      content,
    );
    const segments =
      normalizedContent.transcriptSegments as NormalizedDialogueSegment[];
    const accent = normalizedContent.accent === 'UK' ? 'UK' : 'US';
    const audioBuffer = await this.speakingService.generateDialogueTts(
      segments,
      accent,
      1,
    );
    const next = await this.prisma.quizAudioAsset.aggregate({
      where: { questionId },
      _max: { version: true },
    });
    const version = (next._max.version ?? 0) + 1;
    const upload = await this.uploadService.uploadRawBuffer(
      audioBuffer,
      'audio/mpeg',
      `catalog/listening/practice/dialogue/quiz-${question.quiz.id}/question-${questionId}/v${version}`,
      'dialogue.mp3',
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.quizAudioAsset.updateMany({
          where: { questionId },
          data: { isActive: false },
        });
        await tx.question.update({
          where: { id: questionId },
          data: { content: normalizedContent as Prisma.InputJsonValue },
        });
        return tx.quizAudioAsset.create({
          data: {
            questionId,
            version,
            key: upload.key,
            url: upload.url,
            mimeType: upload.contentType,
            isActive: true,
          },
        });
      });
    } catch (error) {
      await this.uploadService.deleteFile(upload.key).catch(() => undefined);
      throw error;
    }
  }

  async createDiagnosticClip(
    questionId: number,
    dto: {
      label: string;
      key: string;
      url: string;
      startMs?: number;
      endMs?: number;
    },
  ) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, quiz: { select: { type: true } } },
    });
    if (!question || question.quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new NotFoundException('Không tìm thấy câu luyện nghe');
    }
    return this.prisma.listeningDiagnosticClip.create({
      data: { questionId, ...dto },
    });
  }

  async updateQuestion(questionId: number, dto: Partial<CreateQuestionDto>) {
    const existing = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { quiz: { select: { type: true } } },
    });
    if (!existing) throw new NotFoundException('Question not found');

    const data = { ...dto };
    if (dto.content !== undefined) {
      data.content = normalizeQuestionContent(
        existing.quiz.type,
        dto.type ?? existing.type,
        dto.content,
      ) as any;
    }
    return this.prisma.question.update({
      where: { id: questionId },
      data,
    });
  }

  async deleteQuestion(questionId: number) {
    const existing = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!existing) throw new NotFoundException('Question not found');
    return this.prisma.question.delete({
      where: { id: questionId },
    });
  }

  async submitQuiz(quizId: number, userId: number, dto: SubmitQuizDto) {
    const quiz = await this.getQuizById(quizId, true, userId);

    if (quiz.type === QuizType.LISTENING_PRACTICE) {
      this.assertCompleteListeningSubmission(quiz.questions, dto.answers);
    } else if (quiz.type === QuizType.BILINGUAL_READING) {
      validateReadingSubmission(quiz.questions, dto.answers);
    }

    if (
      dto.attemptId !== undefined &&
      quiz.type === QuizType.LISTENING_PRACTICE
    ) {
      const attempt = await this.prisma.listeningPracticeAttempt.findFirst({
        where: {
          id: dto.attemptId,
          userId,
          quizId,
          status: ListeningPracticeAttemptStatus.IN_PROGRESS,
        },
        select: { id: true },
      });
      if (!attempt)
        throw new ForbiddenException('Phiên luyện nghe không còn hiệu lực');
    }

    let totalScore = 0;
    const answersByQuestionId = new Map(
      dto.answers.map((answer) => [answer.questionId, answer.answer]),
    );
    const answersForScoring =
      quiz.type === QuizType.BILINGUAL_READING
        ? quiz.questions.map((question) => ({
            questionId: question.id,
            answer: answersByQuestionId.get(question.id),
          }))
        : dto.answers;

    const resultsData = answersForScoring.map((ans) => {
      const question = quiz.questions.find((q: any) => q.id === ans.questionId);
      let isCorrect = false;
      let score = 0;

      if (question) {
        if (question.type === 'MULTIPLE_CHOICE') {
          const content = question.content;
          if (
            content.correctIndex !== undefined &&
            Array.isArray(content.options)
          ) {
            // Reading-style: options array + correctIndex
            const correctOption = content.options[content.correctIndex];
            if (correctOption === ans.answer) {
              isCorrect = true;
              score = 1;
              totalScore += score;
            }
          } else if (content.correct === ans.answer) {
            isCorrect = true;
            score = 1;
            totalScore += score;
          }
        } else if (
          question.type === 'DICTATION' ||
          question.type === 'FILL_IN_BLANK'
        ) {
          const content = question.content;
          const cleanCorrect = normalizeListeningAnswer(
            content.correctAnswer || content.correct || '',
          );
          const cleanAns = normalizeListeningAnswer(ans.answer);
          if (cleanCorrect === cleanAns) {
            isCorrect = true;
            score = 1;
            totalScore += score;
          }
        } else if (question.type === 'WRITING') {
          // Sẽ gọi AI chấm bài và gom overallAiFeedback ở vòng lặp bên dưới
        }
      }

      return {
        questionId: ans.questionId,
        answer: ans.answer,
        isCorrect,
        score,
        // (Optional: You could save this feedback into the Result JSON if you want.
        // We will just accumulate it into the Submission aiFeedback for now)
      };
    });

    // Accumulate all AI feedback to store in the Submission
    let overallAiFeedback = '';
    // We run the map again just to combine (or we could have done it inside)
    for (const ans of dto.answers) {
      const question = quiz.questions.find((q: any) => q.id === ans.questionId);
      if (question && question.type === 'WRITING') {
        const content = question.content;
        const feedback = await this.aiService.generateFeedback(
          content.text,
          ans.answer,
        );
        overallAiFeedback += `Question: ${content.text}\nFeedback: ${feedback}\n\n`;
      }
    }

    // Persist the submission and close the listening attempt atomically. This
    // prevents a successful submission from being left behind while its
    // server checkpoint remains IN_PROGRESS (or vice versa).
    const submission = await this.prisma.$transaction(async (tx) => {
      const created = await tx.submission.create({
        data: {
          quizId,
          userId,
          score: totalScore,
          aiFeedback: overallAiFeedback ? overallAiFeedback : null,
          results: {
            create: resultsData,
          },
        },
        include: {
          results: true,
        },
      });

      if (
        dto.attemptId !== undefined &&
        quiz.type === QuizType.LISTENING_PRACTICE
      ) {
        const completed = await tx.listeningPracticeAttempt.updateMany({
          where: {
            id: dto.attemptId,
            userId,
            quizId,
            status: ListeningPracticeAttemptStatus.IN_PROGRESS,
          },
          data: {
            status: ListeningPracticeAttemptStatus.COMPLETED,
            completedAt: new Date(),
          },
        });
        if (completed.count !== 1) {
          throw new ForbiddenException('Phiên luyện nghe không còn hiệu lực');
        }
      }

      return created;
    });

    if (
      quiz.type === QuizType.LISTENING_PRACTICE &&
      this.prisma.learningActivity?.create
    ) {
      await this.prisma.learningActivity.create({
        data: {
          userId,
          type: 'LISTENING_PRACTICE_COMPLETED',
          title: quiz.title,
          detail: `${totalScore}/${quiz.questions.length} câu đúng`,
          score:
            quiz.questions.length > 0
              ? Math.round((totalScore / quiz.questions.length) * 100)
              : 0,
          sourceType: 'QUIZ',
          sourceId: String(quizId),
        },
      });
    }

    // Chống farm điểm thưởng Quiz bằng một insert idempotent.
    // createMany + skipDuplicates tránh ném/log P2002 trong lần nộp lại,
    // đồng thời vẫn giữ được tính nguyên tử của @@unique([userId, quizId]).
    const rewardInsert = await this.prisma.userQuizReward.createMany({
      data: { userId, quizId },
      skipDuplicates: true,
    });
    const isFirstSubmission = rewardInsert.count === 1;

    // Phát ra sự kiện cho Gamification kèm cờ isFirstSubmission
    this.eventEmitter.emit('quiz.submitted', {
      userId,
      quizId,
      score: totalScore,
      submissionId: submission.id,
      isFirstSubmission,
    });

    return {
      ...submission,
      isFirstSubmission,
    };
  }

  async checkPracticeQuestion(
    quizId: number,
    questionId: number,
    dto: CheckPracticeQuestionDto,
  ) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: {
        quiz: { select: { id: true, type: true } },
        audioAssets: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!question || question.quizId !== quizId) {
      throw new NotFoundException('Câu hỏi không thuộc bài luyện này');
    }
    if (question.quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new ForbiddenException(
        'Chỉ hỗ trợ kiểm tra tức thời cho bài luyện nghe',
      );
    }

    const content = question.content as Record<string, unknown>;
    if (question.type === 'DICTATION') {
      const expectedAnswer =
        typeof content.correctAnswer === 'string'
          ? content.correctAnswer
          : typeof content.correct === 'string'
            ? content.correct
            : null;
      if (!expectedAnswer) {
        throw new BadRequestException('Câu nghe chép chưa có đáp án hợp lệ');
      }

      const evaluationMode =
        content.dictationMode === 'STRICT' ? 'STRICT' : 'STANDARD';
      const normalizedSubmitted =
        evaluationMode === 'STRICT'
          ? normalizeStrictListeningAnswer(dto.answer)
          : normalizeListeningAnswer(dto.answer);
      const normalizedExpected =
        evaluationMode === 'STRICT'
          ? normalizeStrictListeningAnswer(expectedAnswer)
          : normalizeListeningAnswer(expectedAnswer);

      return {
        questionId,
        isCorrect: normalizedSubmitted === normalizedExpected,
        submittedAnswer: dto.answer,
        correctAnswer: expectedAnswer,
        evaluationMode,
        wordAccuracy: calculateDictationWordAccuracy(
          expectedAnswer,
          dto.answer,
          evaluationMode,
        ),
        explanation:
          typeof content.explanation === 'string' ||
          (content.explanation && typeof content.explanation === 'object')
            ? content.explanation
            : null,
        translation:
          typeof content.translation === 'string' ? content.translation : null,
      };
    }

    if (
      question.type !== 'MULTIPLE_CHOICE' ||
      !Array.isArray(content.options)
    ) {
      return {
        questionId,
        isCorrect: false,
        submittedAnswer: dto.answer,
        feedback: 'Loại câu hỏi này chưa được hỗ trợ kiểm tra tức thời.',
      };
    }

    const correctIndex = Number(content.correctIndex);
    const expectedAnswer = Number.isInteger(correctIndex)
      ? content.options[correctIndex]
      : content.correct;
    if (typeof expectedAnswer !== 'string') {
      throw new BadRequestException('Câu hỏi chưa có đáp án hợp lệ');
    }

    return {
      questionId,
      isCorrect: dto.answer.trim() === expectedAnswer.trim(),
      submittedAnswer: dto.answer,
      correctAnswer: expectedAnswer,
      explanation:
        typeof content.explanation === 'string' ||
        (content.explanation && typeof content.explanation === 'object')
          ? content.explanation
          : null,
      translation:
        typeof content.translation === 'string' ? content.translation : null,
    };
  }

  async streamQuestionAudio(
    quizId: number,
    questionId: number,
    requestedIdentity: PublishedListeningAudioIdentity = {},
  ) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: {
        quiz: { select: { id: true, type: true } },
        audioAssets: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!question || question.quizId !== quizId) {
      throw new NotFoundException('Câu hỏi không thuộc bài luyện này');
    }
    if (question.quiz.type !== QuizType.LISTENING_PRACTICE) {
      throw new ForbiddenException('Chỉ hỗ trợ audio cho bài luyện nghe');
    }

    const content =
      question.content && typeof question.content === 'object'
        ? (question.content as Record<string, unknown>)
        : {};
    const isArtifactBackedQuestion =
      question.type === 'DICTATION' ||
      question.type === 'DIALOGUE' ||
      typeof content.targetTurnId === 'string';
    if (isArtifactBackedQuestion) {
      const artifact =
        await this.listeningAudioAuthoringService.getCurrentPublishedArtifact(
          quizId,
        );
      if (artifact) {
        const result =
          await this.listeningAudioAuthoringService.getPublishedAudio(
            quizId,
            requestedIdentity,
          );
        return result;
      }

      // A caller that supplies an artifact identity is explicitly asking for
      // the quiz-level production track. Never silently downgrade that request
      // to a legacy question asset when the published artifact is unavailable.
      if (Object.keys(requestedIdentity).length > 0) {
        throw new ServiceUnavailableException(
          'Audio phiên bản hiện tại chưa được quản trị viên tạo và duyệt; vui lòng thử lại sau.',
        );
      }
    }

    const activeAsset = question.audioAssets[0];
    // Published student playback is R2-only. Never call Azure from this
    // request path; content must be synthesized and approved by an author.
    if (activeAsset && activeAsset.key.startsWith('catalog/listening/'))
      return this.uploadService.downloadFileBuffer(activeAsset.key);
    throw new ServiceUnavailableException(
      'Audio bài luyện chưa được quản trị viên tạo và duyệt; vui lòng thử lại sau.',
    );
  }

  private assertCompleteListeningSubmission(
    questions: Array<{ id: number }>,
    answers: Array<{ questionId: number; answer: unknown }>,
  ) {
    const questionIds = new Set(questions.map((question) => question.id));
    if (answers.length !== questionIds.size) {
      throw new BadRequestException(
        'Hãy trả lời đầy đủ tất cả câu hỏi trước khi nộp bài',
      );
    }

    const seenQuestionIds = new Set<number>();
    for (const answer of answers) {
      if (
        !questionIds.has(answer.questionId) ||
        seenQuestionIds.has(answer.questionId) ||
        typeof answer.answer !== 'string' ||
        answer.answer.trim().length === 0
      ) {
        throw new BadRequestException('Dữ liệu câu trả lời không hợp lệ');
      }
      seenQuestionIds.add(answer.questionId);
    }
  }

  /**
   * Quy đổi số câu đúng ra điểm TOEIC (10 - 990)
   */
  calculateToeicScore(listeningCorrect: number, readingCorrect: number) {
    const lCorrect = Math.min(100, Math.max(0, listeningCorrect));
    const rCorrect = Math.min(100, Math.max(0, readingCorrect));

    // Thang quy đổi chuẩn ETS TOEIC
    const convertListening = (c: number) => {
      if (c <= 5) return 5;
      if (c >= 96) return 495;
      return Math.round(5 + (c - 5) * (490 / 91));
    };

    const convertReading = (c: number) => {
      if (c <= 5) return 5;
      if (c >= 96) return 495;
      return Math.round(5 + (c - 5) * (490 / 91));
    };

    const listeningScore = convertListening(lCorrect);
    const readingScore = convertReading(rCorrect);
    const totalScore = listeningScore + readingScore;

    return {
      listening: { correct: lCorrect, total: 100, score: listeningScore },
      reading: { correct: rCorrect, total: 100, score: readingScore },
      totalScore,
    };
  }

  /**
   * Phân tích điểm mạnh / điểm yếu theo Tag & Category sau khi nộp bài (Analytics)
   */
  async getSubmissionAnalytics(
    submissionId: number,
    userId?: number,
    role?: Role,
  ) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        quiz: {
          include: {
            questions: true,
          },
        },
        results: true,
      },
    });

    if (!submission) throw new NotFoundException('Submission not found');

    if (role === Role.STUDENT && submission.userId !== userId) {
      throw new ForbiddenException(
        'Bạn không có quyền xem kết quả bài thi này',
      );
    }

    const tagStats: Record<string, { correct: number; total: number }> = {};
    let totalCorrect = 0;
    // Reading submissions are complete by contract, but the denominator must
    // remain owned by the current server question set for historical safety.
    const totalQuestions =
      submission.quiz.type === QuizType.BILINGUAL_READING
        ? submission.quiz.questions.length
        : submission.results.length;

    submission.results.forEach((res) => {
      if (res.isCorrect) totalCorrect++;
      const question = submission.quiz.questions.find(
        (q) => q.id === res.questionId,
      );
      const content = question?.content as any;
      const category = content?.category || question?.type || 'General';

      if (!tagStats[category]) {
        tagStats[category] = { correct: 0, total: 0 };
      }
      tagStats[category].total += 1;
      if (res.isCorrect) {
        tagStats[category].correct += 1;
      }
    });

    const categoriesBreakdown = Object.entries(tagStats).map(
      ([category, stat]) => {
        const accuracy =
          stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
        return {
          category,
          correct: stat.correct,
          total: stat.total,
          accuracyPercent: accuracy,
        };
      },
    );

    const strengths = categoriesBreakdown
      .filter((c) => c.accuracyPercent >= 75)
      .map((c) => c.category);
    const weaknesses = categoriesBreakdown
      .filter((c) => c.accuracyPercent < 50)
      .map((c) => c.category);

    const overallAccuracy =
      totalQuestions > 0
        ? Math.round((totalCorrect / totalQuestions) * 100)
        : 0;

    return {
      submissionId,
      quizId: submission.quizId,
      quizTitle: submission.quiz.title,
      overallScore: submission.score,
      totalQuestions,
      totalCorrect,
      overallAccuracyPercent: overallAccuracy,
      categoriesBreakdown,
      results: submission.results,
      questions: submission.quiz.questions,
      strengths:
        strengths.length > 0
          ? strengths
          : ['Cần luyện tập thêm để xác định điểm mạnh'],
      weaknesses:
        weaknesses.length > 0 ? weaknesses : ['Không có điểm yếu nghiêm trọng'],
      recommendation:
        weaknesses.length > 0
          ? `Bạn nên tập trung ôn luyện lại các mảng kiến thức: ${weaknesses.join(', ')}.`
          : 'Thành tích rất tốt! Hãy tiếp tục duy trì và thử sức ở đề thi khó hơn.',
    };
  }
}
