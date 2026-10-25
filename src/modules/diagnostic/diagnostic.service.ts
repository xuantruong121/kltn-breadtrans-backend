import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildPracticeRecommendations,
  buildSkillProfiles,
  buildStrengthsAndWeaknesses,
  CANONICAL_DIAGNOSTIC_BLUEPRINT,
  resolvePersistedScoringVersion,
  assertSectionBandV2Scorable,
  describeAdministeredForm,
  DiagnosticSkillProfile,
  DiagnosticQuestionForScoring,
  getAttemptQuestionPermutation,
  getQuestionMeta,
  getQuestionOptions,
  isDiagnosticAnswerCorrect,
  isOpenDiagnosticQuestion,
  rankCourseRecommendations,
  resolvePlacementLevel,
  resolveEstimatedLevel,
  validateQuestionBank,
} from './diagnostic.logic';
import { buildCourseCurriculum } from '../course/course-curriculum';
import { GamificationService } from '../gamification/gamification.service';
import {
  DiagnosticWritingFeedback,
  DiagnosticWritingService,
} from './diagnostic-writing.service';

type AnswerMap = Record<string, unknown>;

const SPEAKING_FINALIZATION_TIMEOUT_MS = 10_000;
const SPEAKING_FINALIZATION_POLL_MS = 250;

@Injectable()
export class DiagnosticService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamificationService: GamificationService,
    @Optional() private readonly writingService?: DiagnosticWritingService,
  ) {}

  private assertQuestionBank(questions: DiagnosticQuestionForScoring[]) {
    const defects = validateQuestionBank(questions);
    if (defects.length > 0) {
      throw new InternalServerErrorException(
        'Bài kiểm tra đầu vào chưa sẵn sàng để chấm điểm',
      );
    }
  }

  private formQuestions(questions: DiagnosticQuestionForScoring[]) {
    return questions.filter(
      (question) => getQuestionMeta(question).activeInForm !== false,
    );
  }

  private sanitizeQuestion(
    question: DiagnosticQuestionForScoring,
    attemptId?: number,
  ) {
    const meta = getQuestionMeta(question);
    const originalOptions = getQuestionOptions(question);
    let options = originalOptions;
    if (
      attemptId &&
      meta.questionType === 'MCQ' &&
      originalOptions.length > 1
    ) {
      const permutation = getAttemptQuestionPermutation(
        attemptId,
        question.id,
        originalOptions.length,
      );
      options = permutation.map((idx) => originalOptions[idx]);
    }
    const passageLines = meta.passageText ? meta.passageText.split('\n') : [];
    const passageTitle =
      meta.section === 'READING' && passageLines.length > 1
        ? passageLines[0].trim()
        : meta.section === 'READING' && meta.passageText
          ? 'Đoạn đọc'
          : null;
    const passageBody =
      meta.section === 'READING' && passageLines.length > 1
        ? passageLines.slice(1).join('\n').trim()
        : meta.section === 'READING'
          ? (meta.passageText ?? null)
          : null;

    return {
      id: question.id,
      skill: question.skill,
      section: meta.section ?? question.skill,
      construct: meta.construct ?? null,
      questionType: meta.questionType ?? 'MCQ',
      question: question.question,
      options,
      passageTitle,
      passageBody,
      passageText:
        meta.section === 'READING' ? (meta.passageText ?? null) : null,
      audioUrl: meta.section === 'LISTENING' ? (meta.audioUrl ?? null) : null,
      order: question.order,
    };
  }

  private async recommendations(level: string, weaknesses: string[]) {
    const courses = await this.prisma.course.findMany({
      where: { status: 'PUBLISHED', lessons: { some: {} } },
      select: {
        id: true,
        title: true,
        description: true,
        level: true,
        status: true,
        curriculumType: true,
        // Lessons live in `Lesson` for GENERAL_ENGLISH courses but in
        // `CourseLesson` for authored curricula such as
        // PRONUNCIATION_FOUNDATION, so both relations must be counted.
        // Counting only `lessons` reported lessonCount = 0 for the IPA course
        // and, because rankCourseRecommendations requires lessonCount > 0,
        // silently dropped it from every recommendation.
        _count: { select: { lessons: true, courseLessons: true } },
        lessons: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            title: true,
            description: true,
            order: true,
            materials: {
              select: {
                id: true,
                title: true,
                fileUrl: true,
                fileType: true,
                objective: true,
                contentText: true,
              },
            },
          },
        },
        quizzes: {
          where: { publicationStatus: 'PUBLISHED' },
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            publicationStatus: true,
            isPremiumContent: true,
            _count: { select: { questions: true } },
          },
        },
        activities: {
          include: {
            quiz: {
              include: { _count: { select: { questions: true } } },
            },
            speakingPracticeSet: {
              include: { exercises: { select: { id: true } } },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    const ranked = rankCourseRecommendations(
      courses.map((course) => ({
        id: course.id,
        title: course.title,
        description: course.description,
        level: course.level,
        status: course.status,
        lessonCount: course._count.lessons + course._count.courseLessons,
        curriculumReady:
          buildCourseCurriculum(
            course.lessons ?? [],
            course.quizzes ?? [],
            course.activities ?? [],
            course.curriculumType,
          ).readiness === 'READY',
      })),
      level,
      weaknesses,
    );
    return ranked.map((recommendation) => {
      const course = courses.find(
        (candidate) => candidate.id === recommendation.courseId,
      );
      const lesson =
        course?.lessons.find((candidate) => {
          const text =
            `${candidate.title} ${candidate.description ?? ''} ${candidate.materials.map((material) => `${material.title} ${material.objective ?? ''}`).join(' ')}`.toLowerCase();
          return (
            weaknesses.some((weakness) =>
              text.includes(weakness.toLowerCase()),
            ) ||
            weaknesses.some(
              (weakness) =>
                weakness === 'Grammar' && /grammar|ngữ pháp/.test(text),
            ) ||
            weaknesses.some(
              (weakness) =>
                weakness === 'Vocabulary' && /vocabulary|từ vựng/.test(text),
            )
          );
        }) ?? course?.lessons[0];
      return {
        ...recommendation,
        recommendedLesson: lesson
          ? { id: lesson.id, title: lesson.title }
          : null,
        advisoryOnly: true,
      };
    });
  }

  private async toResult(
    attempt: {
      id: number;
      answers: unknown;
      correctCount: number;
      totalCount: number;
      percentage: number;
      level: string;
      submittedAt: Date;
    },
    questions: DiagnosticQuestionForScoring[],
  ) {
    const answers = this.readAnswerMap(attempt.answers);
    const objectiveQuestions = questions.filter(
      (question) => !isOpenDiagnosticQuestion(question),
    );
    const productiveTaskCount = questions.length - objectiveQuestions.length;

    const permAttemptId =
      typeof (answers as any).__permAttemptId === 'number'
        ? (answers as any).__permAttemptId
        : attempt.id >= 50
          ? attempt.id
          : undefined;

    const permutations: Record<number, number[]> = {};
    if (permAttemptId) {
      for (const question of objectiveQuestions) {
        const options = getQuestionOptions(question);
        if (options.length > 1) {
          permutations[question.id] = getAttemptQuestionPermutation(
            permAttemptId,
            question.id,
            options.length,
          );
        }
      }
    }

    const profiles = buildSkillProfiles(
      objectiveQuestions,
      answers,
      permutations,
    );
    // Every objective item counts, whatever skill it is labelled with. The
    // objective/productive split is already made by `objectiveQuestions` via
    // the item's questionType, so filtering again by skill name here dropped
    // the Speaking-labelled MCQs from the numerator while the denominator
    // (objectiveQuestions.length) still counted them - a learner who answered
    // all 20 correctly was shown 18/20 and 90%.
    const totalObjectiveCorrect = profiles.reduce(
      (sum, p) => sum + p.correctCount,
      0,
    );

    const speakingRows = this.prisma.diagnosticSpeakingResponse
      ? await this.prisma.diagnosticSpeakingResponse.findMany({
          where: { attemptId: attempt.id },
          orderBy: { questionId: 'asc' },
        })
      : [];
    const gradedSpeaking = speakingRows.filter(
      (row) => row.status === 'GRADED' && typeof row.score === 'number',
    );
    const speakingScore = gradedSpeaking.length
      ? Math.round(
          (gradedSpeaking.reduce((sum, row) => sum + Number(row.score), 0) /
            gradedSpeaking.length) *
            10,
        ) / 10
      : null;
    const objectiveCoreScore = this.weightedCore(
      questions,
      answers,
      attempt.id,
    );
    // Speaking/Writing are formative feedback only. The reference band is
    // calculated from the reviewed 48-item objective core and never controls
    // access to learning content.
    const referenceLevel = attempt.level;
    const profileWithSpeaking: DiagnosticSkillProfile[] =
      speakingScore === null
        ? profiles
        : [
            ...profiles,
            {
              skill: 'Speaking',
              correctCount: Math.round(speakingScore),
              totalCount: 100,
              percentage: Math.round(speakingScore),
              evidence:
                gradedSpeaking.length >= 2 ? 'SUFFICIENT' : 'INSUFFICIENT',
            },
          ];
    const base = buildStrengthsAndWeaknesses(profileWithSpeaking);
    const strengths = Array.from(
      new Set(
        speakingScore !== null && speakingScore >= 75
          ? [...base.strengths, 'Speaking']
          : base.strengths,
      ),
    );
    const weaknesses = Array.from(
      new Set(
        speakingScore !== null && speakingScore < 60
          ? [...base.weaknesses, 'Speaking']
          : base.weaknesses,
      ),
    );

    const questionsResult = questions.map((question) => {
      const rawAnswer = answers[String(question.id)];
      const open = isOpenDiagnosticQuestion(question);
      const options = getQuestionOptions(question);
      const perm = permutations[question.id];
      const isCorrect = open
        ? null
        : isDiagnosticAnswerCorrect(question, rawAnswer, perm);
      let selectedText: string | undefined;
      if (open) {
        selectedText =
          speakingRows.find((row) => row.questionId === question.id)?.status ??
          (typeof rawAnswer === 'string' ? rawAnswer : undefined);
      } else if (typeof rawAnswer === 'string') {
        selectedText = rawAnswer;
      } else if (typeof rawAnswer === 'number') {
        if (perm && perm[rawAnswer] !== undefined) {
          selectedText = options[perm[rawAnswer]];
        } else if (options[rawAnswer] !== undefined) {
          selectedText = options[rawAnswer];
        }
      }
      return {
        questionId: question.id,
        selectedOption: typeof rawAnswer === 'number' ? rawAnswer : undefined,
        selectedText,
        correctOption: open ? null : question.correctIndex,
        correctText: open ? null : (options[question.correctIndex] ?? null),
        isCorrect,
        explanation: open ? null : question.explanation,
      };
    });

    const wrongQuestions = questions.filter((q) => {
      if (isOpenDiagnosticQuestion(q)) return false;
      const qr = questionsResult.find((item) => item.questionId === q.id);
      return qr ? qr.isCorrect === false : false;
    });

    const writingFeedback = this.readWritingFeedback(answers);
    const practiceRecommendations = buildPracticeRecommendations(
      referenceLevel,
      weaknesses,
      wrongQuestions,
    );
    return {
      attemptId: attempt.id,
      // The form actually administered, derived from its own items. The
      // 52-item CANONICAL_DIAGNOSTIC_BLUEPRINT exists in no backup and in no
      // live database, so it is no longer returned as `canonicalBlueprint`
      // next to a 20-item result; it is offered as an explicitly unauthored
      // plan instead.
      administeredForm: describeAdministeredForm(questions),
      plannedBlueprint: {
        ...CANONICAL_DIAGNOSTIC_BLUEPRINT,
        status: 'NOT_AUTHORED',
        note: 'Planned structure only. It is not what this attempt administered; see administeredForm.',
      },
      correctCount: totalObjectiveCorrect,
      totalCount: objectiveQuestions.length,
      totalTaskCount: questions.length,
      objectiveTotalCount: objectiveQuestions.length,
      productiveTaskCount,
      productiveUnavailable: productiveTaskCount > 0 && speakingScore === null,
      productivePending:
        speakingRows.some((row) =>
          ['QUEUED', 'GRADING'].includes(row.status),
        ) ||
        writingFeedback.some((item) =>
          ['QUEUED', 'GRADING'].includes(item.status),
        ),
      percentage:
        objectiveQuestions.length === 0
          ? 0
          : Math.round(
              (totalObjectiveCorrect / objectiveQuestions.length) * 100,
            ),
      // Keep `level` for legacy consumers while presenting it as a reference.
      level: referenceLevel,
      referenceLevel,
      objectiveCoreScore,
      speakingEvidenceCount: gradedSpeaking.length,
      speakingScore,
      speakingEvidenceConfidence:
        gradedSpeaking.length >= 2
          ? 'FULL_DIAGNOSTIC_SAMPLE'
          : gradedSpeaking.length === 1
            ? 'PARTIAL'
            : 'UNAVAILABLE',
      writingFeedback,
      speakingResponses: speakingRows.map((row) => ({
        id: row.id,
        questionId: row.questionId,
        status: row.status,
        score: row.score,
        durationMs: row.durationMs,
        failureReason: row.failureReason,
      })),
      submittedAt: attempt.submittedAt,
      completedAt:
        (attempt as { completedAt?: Date }).completedAt ?? attempt.submittedAt,
      skillProfiles: profiles,
      strengths,
      weaknesses,
      practiceRecommendations,
      recommendations: await this.recommendations(referenceLevel, weaknesses),
      questionsResult,
    };
  }

  private boundedLevel(level: string, score: number) {
    const bands = ['A1', 'A2', 'B1', 'B2'];
    const current = Math.max(0, bands.indexOf(level));
    const target = score >= 75 ? 3 : score >= 50 ? 2 : score >= 25 ? 1 : 0;
    return bands[
      Math.max(
        0,
        Math.min(3, Math.min(current + 1, Math.max(current - 1, target))),
      )
    ];
  }

  private readAnswerMap(value: unknown): AnswerMap {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as AnswerMap;
  }

  private readWritingFeedback(answers: AnswerMap): DiagnosticWritingFeedback[] {
    const value = answers.__writingFeedback;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.values(value as Record<string, DiagnosticWritingFeedback>)
      .filter((item) => item && typeof item.questionId === 'number')
      .sort((left, right) => left.questionId - right.questionId);
  }

  private async awaitSpeakingFinalization(
    attemptId: number,
    questionIds: number[],
  ) {
    const configuredTimeout = Number.parseInt(
      process.env.DIAGNOSTIC_SPEAKING_FINALIZATION_TIMEOUT_MS || '',
      10,
    );
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : SPEAKING_FINALIZATION_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const terminal = new Set(['GRADED', 'SKIPPED', 'GRADING_FAILED']);
    let rows = await this.prisma.diagnosticSpeakingResponse.findMany({
      where: { attemptId },
    });
    while (
      questionIds.some(
        (questionId) =>
          !terminal.has(
            rows.find((row) => row.questionId === questionId)?.status ?? '',
          ),
      ) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, SPEAKING_FINALIZATION_POLL_MS),
      );
      rows = await this.prisma.diagnosticSpeakingResponse.findMany({
        where: { attemptId },
      });
    }
    const pendingIds = questionIds.filter(
      (questionId) =>
        !terminal.has(
          rows.find((row) => row.questionId === questionId)?.status ?? '',
        ),
    );
    if (pendingIds.length) {
      await this.prisma.diagnosticSpeakingResponse.updateMany({
        where: { attemptId, questionId: { in: pendingIds } },
        data: {
          status: 'GRADING_FAILED',
          failureReason: 'Chấm Speaking quá thời hạn hoàn tất bài kiểm tra',
        },
      });
      rows = await this.prisma.diagnosticSpeakingResponse.findMany({
        where: { attemptId },
      });
    }
    return rows;
  }

  async getCurrentAssessment(userId: number) {
    const assessment = await this.prisma.diagnosticAssessment.findFirst({
      where: { isActive: true },
      orderBy: { id: 'desc' },
      include: { questions: { orderBy: { order: 'asc' } } },
    });

    if (!assessment)
      throw new NotFoundException('Chưa có bài kiểm tra đầu vào');
    this.assertQuestionBank(assessment.questions);
    const formQuestions = this.formQuestions(assessment.questions);

    const latestAttempt = await this.prisma.diagnosticAttempt.findFirst({
      where: { userId, assessmentId: assessment.id, status: 'COMPLETED' },
      orderBy: { submittedAt: 'desc' },
    });
    const inProgressAttempt = await this.prisma.diagnosticAttempt.findFirst({
      where: { userId, assessmentId: assessment.id, status: 'IN_PROGRESS' },
      include: { speakingResponses: true },
      orderBy: { submittedAt: 'desc' },
    });
    const activeAttemptId =
      inProgressAttempt?.id ?? (latestAttempt ? latestAttempt.id : undefined);

    return {
      id: assessment.id,
      title: assessment.title,
      description: assessment.description,
      // The form actually being served, derived from its own items. The
      // 52-item CANONICAL_DIAGNOSTIC_BLUEPRINT exists in no backup and in no
      // live database, so it is no longer returned as `canonicalBlueprint`
      // beside a 20-item form; it is offered as an explicitly unauthored plan.
      administeredForm: describeAdministeredForm(formQuestions),
      plannedBlueprint: {
        ...CANONICAL_DIAGNOSTIC_BLUEPRINT,
        status: 'NOT_AUTHORED',
        note: 'Planned structure only. It is not the form being administered; see administeredForm.',
      },
      hasCompleted: !!latestAttempt,
      questions: formQuestions.map((question) =>
        this.sanitizeQuestion(question, activeAttemptId),
      ),
      latestAttempt: latestAttempt
        ? {
            id: latestAttempt.id,
            correctCount: latestAttempt.correctCount,
            totalCount: latestAttempt.totalCount,
            percentage: latestAttempt.percentage,
            level: latestAttempt.level,
            submittedAt: latestAttempt.submittedAt,
            completedAt: latestAttempt.completedAt ?? latestAttempt.submittedAt,
          }
        : null,
      inProgressAttempt: inProgressAttempt
        ? {
            id: inProgressAttempt.id,
            answers: inProgressAttempt.answers,
            speakingResponses: inProgressAttempt.speakingResponses.map(
              (response) => ({
                id: response.id,
                questionId: response.questionId,
                status: response.status,
                score: response.score,
                durationMs: response.durationMs,
                failureReason: response.failureReason,
              }),
            ),
          }
        : null,
    };
  }

  async getLatestResult(userId: number) {
    const assessment = await this.prisma.diagnosticAssessment.findFirst({
      where: { isActive: true },
      orderBy: { id: 'desc' },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!assessment)
      throw new NotFoundException('Chưa có bài kiểm tra đầu vào');
    this.assertQuestionBank(assessment.questions);
    const formQuestions = this.formQuestions(assessment.questions);
    const attempt = await this.prisma.diagnosticAttempt.findFirst({
      where: { userId, assessmentId: assessment.id, status: 'COMPLETED' },
      orderBy: { submittedAt: 'desc' },
    });
    return attempt ? this.toResult(attempt, formQuestions) : null;
  }

  async startAttempt(userId: number, assessmentId: number) {
    const assessment = await this.prisma.diagnosticAssessment.findFirst({
      where: { id: assessmentId, isActive: true },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!assessment)
      throw new NotFoundException(
        'Bài kiểm tra không tồn tại hoặc đã ngừng hoạt động',
      );
    this.assertQuestionBank(assessment.questions);

    // 1. If COMPLETED attempt exists, learner cannot retake official test
    const completed = await this.prisma.diagnosticAttempt.findFirst({
      where: { userId, assessmentId, status: 'COMPLETED' },
      orderBy: { submittedAt: 'desc' },
    });
    if (completed) {
      return {
        attemptId: completed.id,
        submissionToken: completed.submissionToken,
        status: 'COMPLETED',
        hasCompleted: true,
      };
    }

    // 2. If IN_PROGRESS attempt exists, resume same attempt
    const existing = await this.prisma.diagnosticAttempt.findFirst({
      where: { userId, assessmentId, status: 'IN_PROGRESS' },
      orderBy: { submittedAt: 'desc' },
    });
    if (existing) {
      return {
        attemptId: existing.id,
        submissionToken: existing.submissionToken,
        status: 'IN_PROGRESS',
        hasCompleted: false,
      };
    }

    // 3. Serialize creation with advisory transaction lock to guard against concurrent start requests
    const submissionToken = `diagnostic-${userId}-${assessmentId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const objectiveCount = this.formQuestions(assessment.questions).filter(
      (q) => !isOpenDiagnosticQuestion(q),
    ).length;

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`diagnostic:start:${userId}:${assessmentId}`}, 0))`;
      const doubleCheckCompleted = await tx.diagnosticAttempt.findFirst({
        where: { userId, assessmentId, status: 'COMPLETED' },
        orderBy: { submittedAt: 'desc' },
      });
      if (doubleCheckCompleted) {
        return doubleCheckCompleted;
      }
      const doubleCheckInProgress = await tx.diagnosticAttempt.findFirst({
        where: { userId, assessmentId, status: 'IN_PROGRESS' },
        orderBy: { submittedAt: 'desc' },
      });
      if (doubleCheckInProgress) {
        return doubleCheckInProgress;
      }
      return tx.diagnosticAttempt.create({
        data: {
          userId,
          assessmentId,
          answers: {},
          correctCount: 0,
          totalCount: objectiveCount,
          percentage: 0,
          level: 'IN_PROGRESS',
          status: 'IN_PROGRESS',
          submissionToken,
        },
      });
    });

    return {
      attemptId: created.id,
      submissionToken: created.submissionToken,
      status: created.status,
      hasCompleted: created.status === 'COMPLETED',
    };
  }

  async submitAssessment(
    userId: number,
    assessmentId: number,
    answers: unknown,
    submissionToken?: string,
    attemptId?: number,
  ) {
    const assessment = await this.prisma.diagnosticAssessment.findFirst({
      where: { id: assessmentId, isActive: true },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!assessment) {
      throw new NotFoundException(
        'Bài kiểm tra không tồn tại hoặc đã ngừng hoạt động',
      );
    }
    this.assertQuestionBank(assessment.questions);
    const formQuestions = this.formQuestions(assessment.questions);
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new BadRequestException('Câu trả lời không hợp lệ');
    }

    const answerMap = answers as AnswerMap;
    const speakingQuestions = formQuestions.filter(
      (question) => getQuestionMeta(question).section === 'SPEAKING',
    );
    if (speakingQuestions.length > 0 && !attemptId) {
      throw new BadRequestException('Phiên kiểm tra Speaking không hợp lệ');
    }
    const expectedIds = new Set(
      formQuestions
        .filter((question) => getQuestionMeta(question).section !== 'SPEAKING')
        .map((question) => String(question.id)),
    );
    const formIds = new Set(
      formQuestions.map((question) => String(question.id)),
    );
    const submittedIds = Object.keys(answerMap);
    const unknownIds = submittedIds.filter((id) => !formIds.has(id));
    const missingIds = [...expectedIds].filter((id) => !(id in answerMap));
    if (unknownIds.length || missingIds.length) {
      throw new BadRequestException(
        `Cần trả lời đúng ${formQuestions.length} câu hỏi hiện tại`,
      );
    }
    let speakingResponses: Array<{
      questionId: number;
      status: string;
      score: number | null;
    }> = [];
    if (attemptId) {
      const attempt = await this.prisma.diagnosticAttempt.findUnique({
        where: { id: attemptId },
        include: { speakingResponses: true },
      });
      if (
        !attempt ||
        attempt.userId !== userId ||
        attempt.assessmentId !== assessmentId
      ) {
        throw new BadRequestException('Phiên kiểm tra không hợp lệ');
      }
      speakingResponses = await this.prisma.diagnosticSpeakingResponse.findMany(
        {
          where: { attemptId },
        },
      );
      if (
        speakingQuestions.some(
          (question) =>
            !speakingResponses.some((row) => row.questionId === question.id),
        )
      ) {
        throw new BadRequestException(
          'Cần hoàn tất hoặc bỏ qua toàn bộ nhiệm vụ Speaking',
        );
      }
    }
    for (const question of formQuestions) {
      const selectedOption = answerMap[String(question.id)];
      if (isOpenDiagnosticQuestion(question)) {
        if (getQuestionMeta(question).section === 'SPEAKING' && attemptId)
          continue;
        if (
          typeof selectedOption !== 'string' ||
          selectedOption.trim().length < 2 ||
          selectedOption.length > 2000
        )
          throw new BadRequestException('Câu trả lời tự luận không hợp lệ');
      } else {
        const options = getQuestionOptions(question);
        const isStringValid =
          typeof selectedOption === 'string' &&
          options.some((opt) => opt.trim() === selectedOption.trim());
        const isIndexValid =
          Number.isInteger(selectedOption) &&
          (selectedOption as number) >= 0 &&
          (selectedOption as number) < options.length;
        const isObjectValid =
          typeof selectedOption === 'object' && selectedOption !== null;
        if (!isStringValid && !isIndexValid && !isObjectValid) {
          throw new BadRequestException(
            'Có câu trả lời không thuộc lựa chọn hiện tại',
          );
        }
      }
    }

    const questionsResult = formQuestions.map((question) => {
      const open = isOpenDiagnosticQuestion(question);
      const rawAnswer = answerMap[String(question.id)];
      const speakingResponse = speakingResponses.find(
        (row) => row.questionId === question.id,
      );
      const options = getQuestionOptions(question);
      const perm =
        attemptId && !open && options.length > 1
          ? getAttemptQuestionPermutation(
              attemptId,
              question.id,
              options.length,
            )
          : undefined;
      const isCorrect = open
        ? null
        : isDiagnosticAnswerCorrect(question, rawAnswer, perm);
      let selectedText: string | undefined;
      if (open) {
        selectedText =
          getQuestionMeta(question).section === 'SPEAKING' && attemptId
            ? (speakingResponse?.status ?? 'SKIPPED')
            : String(rawAnswer ?? '');
      } else if (typeof rawAnswer === 'string') {
        selectedText = rawAnswer;
      } else if (typeof rawAnswer === 'number') {
        if (perm && perm[rawAnswer] !== undefined) {
          selectedText = options[perm[rawAnswer]];
        } else if (options[rawAnswer] !== undefined) {
          selectedText = options[rawAnswer];
        }
      }
      return {
        questionId: question.id,
        selectedOption: typeof rawAnswer === 'number' ? rawAnswer : undefined,
        selectedText,
        correctOption: open ? null : question.correctIndex,
        correctText: open ? null : (options[question.correctIndex] ?? null),
        isCorrect,
        explanation: open ? null : question.explanation,
      };
    });
    const objectiveQuestions = formQuestions.filter(
      (question) => !isOpenDiagnosticQuestion(question),
    );
    const correctCount = questionsResult.filter(
      (item) => item.isCorrect === true,
    ).length;
    const totalCount = objectiveQuestions.length;
    const percentage =
      totalCount === 0 ? 0 : Math.round((correctCount / totalCount) * 100);
    // The algorithm is chosen from the items' own structure, never from the
    // assessment's id or title: renaming an assessment must not change any
    // learner's score, and the section/band scorer must not run against items
    // that carry no section metadata (it would score every learner Pre-A1).
    // The scorer comes from the assessment's PERSISTED scoringVersion.
    // Nothing else about the assessment - id, title, question count, skills,
    // order, or section/intendedLevel metadata on its items - is in scope, so
    // none of them can change which algorithm runs (DIAG-002, DIAG-008). An
    // unknown or not-yet-implemented version throws rather than falling back.
    const scoringVersion = resolvePersistedScoringVersion(
      assessment.scoringVersion,
    );
    const useSectionBandV2 = scoringVersion === 'SECTION_BAND_V2';
    if (useSectionBandV2) {
      // Fails closed rather than quietly computing zeros for a missing section.
      assertSectionBandV2Scorable(formQuestions);
    }
    const level = useSectionBandV2
      ? resolvePlacementLevel(
          {
            LANGUAGE_USE: this.sectionPercentage(
              formQuestions,
              answerMap,
              'LANGUAGE_USE',
              attemptId,
            ),
            READING: this.sectionPercentage(
              formQuestions,
              answerMap,
              'READING',
              attemptId,
            ),
            LISTENING: this.sectionPercentage(
              formQuestions,
              answerMap,
              'LISTENING',
              attemptId,
            ),
            CORE: this.weightedCore(formQuestions, answerMap, attemptId),
          },
          this.bandPercentages(formQuestions, answerMap, attemptId),
        )
      : resolveEstimatedLevel(percentage);
    const attempt = await this.prisma.$transaction(async (tx) => {
      if (submissionToken) {
        // Serialize retries for the same learner/assessment/token without a
        // schema migration. The lock lives only for this transaction.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`diagnostic:${userId}:${assessmentId}:${submissionToken}`}, 0))`;
        const recent = await tx.diagnosticAttempt.findFirst({
          where: { userId, assessmentId, status: 'COMPLETED' },
          orderBy: { submittedAt: 'desc' },
        });
        const recentAnswers = this.readAnswerMap(recent?.answers);
        if (recent && recentAnswers.__submissionToken === submissionToken)
          return recent;
      }
      if (attemptId) {
        const currentAttempt = await tx.diagnosticAttempt.findUnique({
          where: { id: attemptId },
        });
        if (currentAttempt?.status === 'COMPLETED') return currentAttempt;
      }
      // The first-completion reward is a read-then-write decision. Serialize
      // it per learner/assessment so concurrent submissions cannot both earn it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`diagnostic:reward:${userId}:${assessmentId}`}, 0))`;
      const previousAttempts = await tx.diagnosticAttempt.count({
        where: { userId, status: 'COMPLETED' },
      });
      const storedAnswers = {
        ...answerMap,
        ...(submissionToken ? { __submissionToken: submissionToken } : {}),
        ...(attemptId ? { __permAttemptId: attemptId } : {}),
      };
      const created = attemptId
        ? await tx.diagnosticAttempt.update({
            where: { id: attemptId },
            data: {
              answers: storedAnswers,
              correctCount,
              totalCount,
              percentage,
              level,
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          })
        : await tx.diagnosticAttempt.create({
            data: {
              userId,
              assessmentId,
              answers: storedAnswers,
              correctCount,
              totalCount,
              percentage,
              level,
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          });
      await tx.learningActivity.create({
        data: {
          userId,
          type: 'DIAGNOSTIC',
          title: assessment.title,
          detail: `${correctCount}/${totalCount} câu đúng • ${level}`,
          score: percentage,
          sourceType: 'DiagnosticAttempt',
          sourceId: String(created.id),
        },
      });
      if (previousAttempts === 0) {
        await this.gamificationService.awardBanh(
          userId,
          50,
          'DIAGNOSTIC_COMPLETION',
          `diagnostic:assessment:${assessmentId}:first`,
          {
            isCapped: true,
            metadata: {
              assessmentId,
              attemptId: created.id,
              rewardType: 'DIAGNOSTIC_FIRST_COMPLETION',
            },
          },
          tx,
        );
      }
      return created;
    });

    const completedAnswers = this.readAnswerMap(attempt.answers);
    const existingWritingFeedback = new Set(
      this.readWritingFeedback(completedAnswers).map((item) => item.questionId),
    );
    const writingTasks = formQuestions
      .filter(
        (question) =>
          isOpenDiagnosticQuestion(question) &&
          getQuestionMeta(question).section === 'WRITING' &&
          !existingWritingFeedback.has(question.id),
      )
      .map((question) => ({
        questionId: question.id,
        prompt: question.question,
        answer: String(completedAnswers[String(question.id)] ?? '').trim(),
      }))
      .filter((task) => task.answer.length >= 2);
    let resultAttempt = attempt;
    if (writingTasks.length && this.writingService) {
      await this.writingService.enqueueMany(attempt.id, writingTasks);
      resultAttempt =
        (await this.prisma.diagnosticAttempt.findUnique({
          where: { id: attempt.id },
        })) ?? attempt;
    }

    return this.toResult(resultAttempt, formQuestions);
  }

  private getVietnamDateKey() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private sectionPercentage(
    questions: DiagnosticQuestionForScoring[],
    answers: AnswerMap,
    section: string,
    attemptId?: number,
  ) {
    const items = questions.filter(
      (question) =>
        getQuestionMeta(question).section === section &&
        !isOpenDiagnosticQuestion(question),
    );
    if (!items.length) return 0;
    return Math.round(
      (items.filter((question) => {
        const perm =
          attemptId && !isOpenDiagnosticQuestion(question)
            ? getAttemptQuestionPermutation(
                attemptId,
                question.id,
                getQuestionOptions(question).length,
              )
            : undefined;
        return isDiagnosticAnswerCorrect(
          question,
          answers[String(question.id)],
          perm,
        );
      }).length /
        items.length) *
        100,
    );
  }

  private weightedCore(
    questions: DiagnosticQuestionForScoring[],
    answers: AnswerMap,
    attemptId?: number,
  ) {
    return Math.round(
      this.sectionPercentage(questions, answers, 'LANGUAGE_USE', attemptId) *
        0.4 +
        this.sectionPercentage(questions, answers, 'READING', attemptId) * 0.3 +
        this.sectionPercentage(questions, answers, 'LISTENING', attemptId) *
          0.3,
    );
  }

  private bandPercentages(
    questions: DiagnosticQuestionForScoring[],
    answers: AnswerMap,
    attemptId?: number,
  ) {
    const result: Record<string, number> = {};
    for (const band of ['A1', 'A2', 'B1', 'B2']) {
      const items = questions.filter(
        (question) =>
          getQuestionMeta(question).intendedLevel === band &&
          !isOpenDiagnosticQuestion(question),
      );
      result[band] = items.length
        ? Math.round(
            (items.filter((question) => {
              const perm =
                attemptId && !isOpenDiagnosticQuestion(question)
                  ? getAttemptQuestionPermutation(
                      attemptId,
                      question.id,
                      getQuestionOptions(question).length,
                    )
                  : undefined;
              return isDiagnosticAnswerCorrect(
                question,
                answers[String(question.id)],
                perm,
              );
            }).length /
              items.length) *
              100,
          )
        : 0;
    }
    return result;
  }
}
