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
  classifyDiagnosticTask,
  getAttemptQuestionPermutation,
  getLearnerQuestionPermutation,
  getQuestionMeta,
  getQuestionOptions,
  isDiagnosticAnswerCorrect,
  isOpenDiagnosticQuestion,
  LEARNER_PERMUTATION_SCHEME,
  resolveAuthoredOptionIndex,
  rankCourseRecommendations,
  resolvePlacementLevel,
  resolveEstimatedLevel,
  validateQuestionBank,
} from './diagnostic.logic';
import { buildCourseCurriculum } from '../course/course-curriculum';
import {
  FOUR_SKILL_SCORING_VERSION,
  scoreFourSkillPlacementV2,
} from './diagnostic-four-skill';
import { DiagnosticAdviceCatalogService } from './diagnostic-advice-catalog.service';
import { buildDiagnosticAdvice } from './diagnostic-v2-advice';
import {
  isSkippedWritingAnswer,
  refreshFourSkillResult,
  writeObjectiveSkillRows,
} from './diagnostic-four-skill.store';
import {
  WRITING_MAX_CHARACTERS,
  summarizeProductiveSkill,
  WRITING_MIN_CHARACTERS,
} from './diagnostic-productive';
import { GamificationService } from '../gamification/gamification.service';
import {
  DiagnosticWritingFeedback,
  DiagnosticWritingService,
} from './diagnostic-writing.service';

type AnswerMap = Record<string, unknown>;

const SPEAKING_FINALIZATION_TIMEOUT_MS = 10_000;
const SPEAKING_FINALIZATION_POLL_MS = 250;

/**
 * `DiagnosticAttempt.level` for FOUR_SKILL_PLACEMENT_V2. Not a band: V2 bands
 * are withheld until DEF-004 is decided, and the column is non-nullable.
 */
export const FOUR_SKILL_PROFILE_LEVEL = 'FOUR_SKILL_PROFILE';

/** Label lines that precede a passage but are not its title. */
const GENERIC_PASSAGE_LABELS = new Set([
  'đoạn đọc',
  'passage',
  'reading passage',
]);

@Injectable()
export class DiagnosticService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamificationService: GamificationService,
    @Optional() private readonly writingService?: DiagnosticWritingService,
    @Optional() private readonly adviceCatalog?: DiagnosticAdviceCatalogService,
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

  /**
   * The one display permutation for this learner, assessment and question.
   * Used to serve options AND to grade them, so the two cannot disagree.
   */
  private displayPermutation(
    userId: number,
    assessmentId: number,
    question: DiagnosticQuestionForScoring,
  ): number[] | undefined {
    if (isOpenDiagnosticQuestion(question)) return undefined;
    const count = getQuestionOptions(question).length;
    return count > 0
      ? getLearnerQuestionPermutation(userId, assessmentId, question.id, count)
      : undefined;
  }

  private permutationsFor(
    userId: number,
    assessmentId: number,
    questions: DiagnosticQuestionForScoring[],
  ): Record<number, number[]> {
    const permutations: Record<number, number[]> = {};
    for (const question of questions) {
      const permutation = this.displayPermutation(
        userId,
        assessmentId,
        question,
      );
      if (permutation) permutations[question.id] = permutation;
    }
    return permutations;
  }

  private sanitizeQuestion(
    question: DiagnosticQuestionForScoring,
    permutation?: number[],
  ) {
    const meta = getQuestionMeta(question);
    const originalOptions = getQuestionOptions(question);
    const options =
      permutation && permutation.length === originalOptions.length
        ? permutation.map((idx) => originalOptions[idx])
        : originalOptions;
    const taskKind = classifyDiagnosticTask(question);
    const productive = taskKind === 'SPEAKING' || taskKind === 'WRITING';
    const passageLines = meta.passageText ? meta.passageText.split('\n') : [];
    // The imported V2 passages start with the generic label line
    // "Đoạn đọc". It is not a title: the page already labels the passage,
    // so showing it again only repeated the label. Authored titles stay.
    const firstLine = passageLines[0]?.trim() ?? '';
    const passageTitle =
      meta.section === 'READING' &&
      passageLines.length > 1 &&
      !GENERIC_PASSAGE_LABELS.has(firstLine.toLowerCase())
        ? firstLine
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
      // A null audioUrl is an explicit NOT_READY state, never playable audio.
      mediaStatus:
        meta.section === 'LISTENING'
          ? meta.audioUrl?.trim()
            ? ('READY' as const)
            : ('NOT_READY' as const)
          : null,
      taskType: question.taskType ?? 'MCQ',
      instructions: question.instructions ?? null,
      // Learner-facing task constraints. None of these is answer-bearing.
      prepSeconds:
        taskKind === 'SPEAKING' ? (question.prepSeconds ?? null) : null,
      responseSeconds:
        taskKind === 'SPEAKING' ? (question.responseSeconds ?? null) : null,
      wordMin: taskKind === 'WRITING' ? (question.wordMin ?? null) : null,
      wordMax: taskKind === 'WRITING' ? (question.wordMax ?? null) : null,
      productive,
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
      userId: number;
      assessmentId: number;
      answers: unknown;
      correctCount: number;
      totalCount: number;
      percentage: number;
      level: string;
      submittedAt: Date;
      scoringVersion?: string | null;
    },
    questions: DiagnosticQuestionForScoring[],
  ) {
    const fourSkill =
      attempt.scoringVersion === FOUR_SKILL_SCORING_VERSION
        ? await refreshFourSkillResult(this.prisma, attempt.id)
        : null;
    const answers = this.readAnswerMap(attempt.answers);
    const objectiveQuestions = questions.filter(
      (question) => !isOpenDiagnosticQuestion(question),
    );
    const productiveTaskCount = questions.length - objectiveQuestions.length;

    // Re-derive the display permutation from the scheme recorded at
    // submission. The former fallback - "attempt id >= 50 means permuted" -
    // guessed, and disagreed with how the same attempt had been graded when it
    // was created without an attempt id. An attempt whose scheme is unknown
    // gets no permutation, so its index answers resolve to "unresolvable"
    // rather than to a comparison of incompatible indexes.
    const permutations: Record<number, number[]> = {};
    if (answers.__permScheme === LEARNER_PERMUTATION_SCHEME) {
      Object.assign(
        permutations,
        this.permutationsFor(
          attempt.userId,
          attempt.assessmentId,
          objectiveQuestions,
        ),
      );
    } else if (typeof answers.__permAttemptId === 'number') {
      for (const question of objectiveQuestions) {
        const options = getQuestionOptions(question);
        if (options.length > 0)
          permutations[question.id] = getAttemptQuestionPermutation(
            answers.__permAttemptId,
            question.id,
            options.length,
          );
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
    // A skill is scored only when every one of its tasks is GRADED; one
    // graded task out of two is reported as pending or failed, not averaged.
    const speakingSkill = summarizeProductiveSkill(
      questions
        .filter((question) => classifyDiagnosticTask(question) === 'SPEAKING')
        .map((question) => question.id),
      speakingRows,
    );
    const speakingScore = speakingSkill.score;
    const objectiveCoreScore = this.weightedCore(
      questions,
      answers,
      permutations,
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
      } else {
        // Shown as what the learner actually picked, resolved through the
        // same permutation that graded it - never re-read at the raw index.
        const authored = resolveAuthoredOptionIndex(question, rawAnswer, perm);
        selectedText = authored === null ? undefined : options[authored];
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

    const writingRows = this.writingService
      ? await this.writingService.listFeedback(attempt.id)
      : [];
    const writingFeedback = writingRows.length
      ? writingRows
      : this.readWritingFeedback(answers);
    const writingSkill = summarizeProductiveSkill(
      questions
        .filter((question) => classifyDiagnosticTask(question) === 'WRITING')
        .map((question) => question.id),
      writingFeedback,
    );
    const practiceRecommendations = buildPracticeRecommendations(
      referenceLevel,
      weaknesses,
      wrongQuestions,
    );
    // D1 advice (V2 only): findings from this attempt's own evidence and
    // links to content that is published now, with the learner's access.
    const advice =
      fourSkill && this.adviceCatalog
        ? buildDiagnosticAdvice({
            fourSkill,
            objective: objectiveQuestions.map((question) => ({
              section: getQuestionMeta(question).section,
              construct: getQuestionMeta(question).construct,
              isCorrect:
                questionsResult.find((r) => r.questionId === question.id)
                  ?.isCorrect === true,
            })),
            productive: [
              ...speakingRows.map((row) => {
                const meta =
                  row.scoreMetadata && typeof row.scoreMetadata === 'object'
                    ? (row.scoreMetadata as Record<string, unknown>)
                    : {};
                return {
                  skill: 'SPEAKING' as const,
                  questionId: row.questionId,
                  status: row.status,
                  criteria: meta.criteria as Record<string, number> | null,
                  criterionFeedback: meta.criterionFeedback as Record<
                    string,
                    string
                  > | null,
                  provider: row.provider,
                };
              }),
              ...writingRows.map((row) => ({
                skill: 'WRITING' as const,
                questionId: row.questionId,
                status: row.status,
                criteria: row.criteria,
                criterionFeedback: row.criterionFeedback,
                provider: row.provider,
              })),
            ],
            resolve: await this.adviceCatalog.resolverFor(attempt.userId),
          })
        : null;
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
      productiveSkills: { speaking: speakingSkill, writing: writingSkill },
      // FOUR_SKILL_PLACEMENT_V2 attempts only: the per-skill profile (primary
      // result) and the secondary overall, null until all four are complete.
      fourSkill,
      speakingResponses: speakingRows.map((row) => {
        const graded = row.status === 'GRADED';
        const meta =
          graded && row.scoreMetadata && typeof row.scoreMetadata === 'object'
            ? (row.scoreMetadata as Record<string, unknown>)
            : {};
        return {
          id: row.id,
          questionId: row.questionId,
          status: row.status,
          // Task rubric percentage (0-100); null unless GRADED.
          score: graded ? row.score : null,
          scoreScale: 'PERCENT_0_100' as const,
          durationMs: row.durationMs,
          failureReason: row.failureReason,
          rubricVersion: graded ? (row.rubricVersion ?? null) : null,
          criteria: graded ? (meta.criteria ?? null) : null,
          criterionFeedback: graded ? (meta.criterionFeedback ?? null) : null,
          feedback: graded ? (meta.feedback ?? null) : null,
          suggestions:
            graded && Array.isArray(meta.suggestions) ? meta.suggestions : [],
          transcript: graded ? (row.transcript ?? null) : null,
        };
      }),
      submittedAt: attempt.submittedAt,
      completedAt:
        (attempt as { completedAt?: Date }).completedAt ?? attempt.submittedAt,
      skillProfiles: profiles,
      // V2 uses the D1 advice below. The V1 lists are not returned for it:
      // their thresholds are V1 rules and their practice routes point at
      // fixed Grammar topics that may not be published.
      strengths: advice ? [] : strengths,
      weaknesses: advice ? [] : weaknesses,
      practiceRecommendations: advice ? [] : practiceRecommendations,
      recommendations: advice
        ? []
        : await this.recommendations(referenceLevel, weaknesses),
      advice,
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
      // Same order before "start", after it, on resume and on review.
      questions: formQuestions.map((question) =>
        this.sanitizeQuestion(
          question,
          this.displayPermutation(userId, assessment.id, question),
        ),
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

  /**
   * Leave an unfinished attempt so the next start creates a fresh one. Only
   * the owner's IN_PROGRESS attempt changes; nothing is deleted, and speaking
   * jobs still queued for it stop at their IN_PROGRESS check.
   */
  async abandonAttempt(
    userId: number,
    assessmentId: number,
    attemptId: number,
  ) {
    const result = await this.prisma.diagnosticAttempt.updateMany({
      where: { id: attemptId, userId, assessmentId, status: 'IN_PROGRESS' },
      data: { status: 'ABANDONED', level: 'ABANDONED' },
    });
    if (result.count !== 1)
      throw new NotFoundException('Không có lượt làm bài đang dở để làm lại.');
    return { attemptId, status: 'ABANDONED' };
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
          // Pinned so the attempt is always scored by the version it was
          // taken under, whatever later happens to the assessment.
          scoringVersion: assessment.scoringVersion,
          blueprintVersion: assessment.blueprintVersion,
          contentVersion: assessment.contentVersion,
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

    // Grading needs an authoritative attempt: the learner's own, on this
    // assessment. Submitting without one used to create a fresh COMPLETED
    // attempt graded with no display permutation - wrong answers marked right
    // and vice versa - and it also bypassed the no-retake rule.
    if (!Number.isInteger(attemptId) || (attemptId as number) <= 0) {
      throw new BadRequestException('Phiên kiểm tra không hợp lệ');
    }
    const ownedAttempt = await this.prisma.diagnosticAttempt.findUnique({
      where: { id: attemptId },
    });
    if (
      !ownedAttempt ||
      ownedAttempt.userId !== userId ||
      ownedAttempt.assessmentId !== assessmentId
    ) {
      throw new BadRequestException('Phiên kiểm tra không hợp lệ');
    }
    // A replay of a finished attempt returns the result already recorded. It
    // is never graded again, so a second submission cannot change the score.
    if (ownedAttempt.status === 'COMPLETED') {
      return this.toResult(ownedAttempt, formQuestions);
    }
    if (ownedAttempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Phiên kiểm tra không hợp lệ');
    }
    const permutations = this.permutationsFor(
      userId,
      assessmentId,
      formQuestions,
    );

    const answerMap = answers as AnswerMap;
    const speakingQuestions = formQuestions.filter(
      (question) => getQuestionMeta(question).section === 'SPEAKING',
    );
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
    if (speakingQuestions.length > 0) {
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
        if (getQuestionMeta(question).section === 'SPEAKING') continue;
        // An empty string is the learner's explicit skip of this Writing
        // task: it is stored as such, never graded, and Writing then has no
        // score (refreshFourSkillResult). It is not scored as 0.
        if (isSkippedWritingAnswer(selectedOption)) continue;
        if (
          typeof selectedOption !== 'string' ||
          selectedOption.trim().length < WRITING_MIN_CHARACTERS ||
          selectedOption.length > WRITING_MAX_CHARACTERS
        )
          throw new BadRequestException('Câu trả lời tự luận không hợp lệ');
      } else if (
        // Every objective answer must resolve to exactly one authored option
        // through the server's own permutation, before anything is written.
        resolveAuthoredOptionIndex(
          question,
          selectedOption,
          permutations[question.id],
        ) === null
      ) {
        throw new BadRequestException(
          'Có câu trả lời không thuộc lựa chọn hiện tại',
        );
      }
    }

    const questionsResult = formQuestions.map((question) => {
      const open = isOpenDiagnosticQuestion(question);
      const rawAnswer = answerMap[String(question.id)];
      const speakingResponse = speakingResponses.find(
        (row) => row.questionId === question.id,
      );
      const options = getQuestionOptions(question);
      const perm = permutations[question.id];
      const isCorrect = open
        ? null
        : isDiagnosticAnswerCorrect(question, rawAnswer, perm);
      let selectedText: string | undefined;
      if (open) {
        selectedText =
          getQuestionMeta(question).section === 'SPEAKING'
            ? (speakingResponse?.status ?? 'SKIPPED')
            : String(rawAnswer ?? '');
      } else {
        const authored = resolveAuthoredOptionIndex(question, rawAnswer, perm);
        selectedText = authored === null ? undefined : options[authored];
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
    const useFourSkillV2 = scoringVersion === 'FOUR_SKILL_PLACEMENT_V2';
    // V2: Listening/Reading/Language Use are final now; Speaking/Writing are
    // filled in as grading completes (refreshFourSkillResult).
    const objectiveFourSkill = useFourSkillV2
      ? scoreFourSkillPlacementV2({
          objective: formQuestions
            .filter((question) => !isOpenDiagnosticQuestion(question))
            .map((question) => ({
              section: getQuestionMeta(question).section,
              isCorrect:
                questionsResult.find((r) => r.questionId === question.id)
                  ?.isCorrect === true,
            })),
          speakingQuestionIds: [],
          speaking: [],
          writingQuestionIds: [],
          writing: [],
        })
      : null;
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
              permutations,
            ),
            READING: this.sectionPercentage(
              formQuestions,
              answerMap,
              'READING',
              permutations,
            ),
            LISTENING: this.sectionPercentage(
              formQuestions,
              answerMap,
              'LISTENING',
              permutations,
            ),
            CORE: this.weightedCore(formQuestions, answerMap, permutations),
          },
          this.bandPercentages(formQuestions, answerMap, permutations),
        )
      : useFourSkillV2
        ? // No band: the V2 band model is undecided (DEF-004).
          FOUR_SKILL_PROFILE_LEVEL
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
      // Two submissions for the same attempt are serialized here, and the
      // status is re-read under the lock: the second one returns the attempt
      // the first completed instead of grading and rewarding it again.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`diagnostic:submit:${attemptId}`}, 0))`;
      const currentAttempt = await tx.diagnosticAttempt.findUnique({
        where: { id: attemptId },
      });
      if (currentAttempt?.status === 'COMPLETED') return currentAttempt;
      if (currentAttempt?.status !== 'IN_PROGRESS')
        throw new BadRequestException('Phiên kiểm tra không hợp lệ');
      // The first-completion reward is a read-then-write decision. Serialize
      // it per learner/assessment so concurrent submissions cannot both earn it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`diagnostic:reward:${userId}:${assessmentId}`}, 0))`;
      const previousAttempts = await tx.diagnosticAttempt.count({
        where: { userId, status: 'COMPLETED' },
      });
      const storedAnswers = {
        ...answerMap,
        ...(submissionToken ? { __submissionToken: submissionToken } : {}),
        // Names how the options were displayed, so the result screen
        // re-derives exactly the permutation this grade was computed with.
        __permScheme: LEARNER_PERMUTATION_SCHEME,
      };
      const created = await tx.diagnosticAttempt.update({
        where: { id: attemptId },
        data: {
          answers: storedAnswers,
          correctCount,
          totalCount,
          percentage,
          level,
          status: 'COMPLETED',
          completedAt: new Date(),
          ...(useFourSkillV2
            ? { resultState: 'PENDING_GRADING' as const }
            : {}),
        },
      });
      if (objectiveFourSkill)
        await writeObjectiveSkillRows(tx, created.id, objectiveFourSkill);
      await tx.learningActivity.create({
        data: {
          userId,
          type: 'DIAGNOSTIC',
          title: assessment.title,
          detail: useFourSkillV2
            ? `${correctCount}/${totalCount} câu trắc nghiệm đúng • Nói/Viết đang được chấm`
            : `${correctCount}/${totalCount} câu đúng • ${level}`,
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

    // Writing grading starts only once the attempt is complete, because the
    // text is final from that point. Each task is queued at most once.
    if (this.writingService) {
      await this.writingService.enqueueForAttempt(attempt, formQuestions);
    }
    if (useFourSkillV2) await refreshFourSkillResult(this.prisma, attempt.id);

    return this.toResult(attempt, formQuestions);
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
    permutations: Record<number, number[]>,
  ) {
    const items = questions.filter(
      (question) =>
        getQuestionMeta(question).section === section &&
        !isOpenDiagnosticQuestion(question),
    );
    if (!items.length) return 0;
    return Math.round(
      (items.filter((question) =>
        isDiagnosticAnswerCorrect(
          question,
          answers[String(question.id)],
          permutations[question.id],
        ),
      ).length /
        items.length) *
        100,
    );
  }

  private weightedCore(
    questions: DiagnosticQuestionForScoring[],
    answers: AnswerMap,
    permutations: Record<number, number[]>,
  ) {
    return Math.round(
      this.sectionPercentage(questions, answers, 'LANGUAGE_USE', permutations) *
        0.4 +
        this.sectionPercentage(questions, answers, 'READING', permutations) *
          0.3 +
        this.sectionPercentage(questions, answers, 'LISTENING', permutations) *
          0.3,
    );
  }

  private bandPercentages(
    questions: DiagnosticQuestionForScoring[],
    answers: AnswerMap,
    permutations: Record<number, number[]>,
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
            (items.filter((question) =>
              isDiagnosticAnswerCorrect(
                question,
                answers[String(question.id)],
                permutations[question.id],
              ),
            ).length /
              items.length) *
              100,
          )
        : 0;
    }
    return result;
  }
}
