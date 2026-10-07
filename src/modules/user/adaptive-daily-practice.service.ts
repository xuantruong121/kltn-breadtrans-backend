import { Injectable } from '@nestjs/common';
import { QuizPublicationStatus, QuizType, Role } from '@prisma/client';
import {
  getBusinessDayKey,
  getBusinessDayStart,
} from '../../common/time/business-time.util';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizContentAccessService } from '../quiz/quiz-content-access.service';
import { SpeakingContentAccessService } from '../speaking/speaking-content-access.service';
import { UserService } from './user.service';
import {
  DailyPracticeItem,
  DailyPracticeReasonCode,
  DailyPracticeResponse,
  DailyPracticeSkill,
} from './dto/daily-practice.dto';

export const DAILY_PRACTICE_SAMPLE_SIZE = 3;
export const DAILY_PRACTICE_MAX_ITEMS = 3;

export type DailyPracticeSkillProgress = Awaited<
  ReturnType<UserService['getSkillProgressSummary']>
>['skills'][number];

export type DailyPracticeCandidate = {
  skill: DailyPracticeSkill;
  exerciseId: number;
  title: string;
  route: string;
  estimatedMinutes: number;
  dimensions: string[];
  isLocked: boolean;
  isCompleted: boolean;
  practicedBeforeToday: boolean;
};

type CandidateInput = Omit<
  DailyPracticeCandidate,
  'isCompleted' | 'practicedBeforeToday'
> & {
  isCompleted?: boolean;
  practicedBeforeToday?: boolean;
};

const SKILL_ORDER: DailyPracticeSkill[] = [
  'LISTENING',
  'READING',
  'SPEAKING',
  'WRITING',
];

const SKILL_LABELS: Record<DailyPracticeSkill, string> = {
  LISTENING: 'Nghe',
  READING: 'Đọc',
  SPEAKING: 'Nói',
  WRITING: 'Viết',
};

const DIMENSION_LABELS: Record<string, string> = {
  DETAIL: 'câu hỏi chi tiết',
  PURPOSE: 'mục đích của bài đọc',
  INFERENCE: 'câu hỏi suy luận',
  MAIN_IDEA: 'ý chính',
  VOCAB_IN_CONTEXT: 'từ vựng trong ngữ cảnh',
  DICTATION: 'nghe chép chính tả',
  MULTIPLE_CHOICE: 'nghe hiểu trắc nghiệm',
  pronunciationScore: 'độ chính xác phát âm',
  fluencyScore: 'độ trôi chảy',
  completenessScore: 'độ đầy đủ',
  prosodyScore: 'ngữ điệu',
  accuracyScore: 'độ chính xác',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataText(value: unknown, key: string): string | null {
  const candidate = asRecord(value)[key];
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : null;
}

function dimensionLabel(value: string | null): string {
  if (!value) return 'kỹ năng này';
  return (
    DIMENSION_LABELS[value] ?? DIMENSION_LABELS[value.toUpperCase()] ?? value
  );
}

function scoreForSkill(skill: DailyPracticeSkillProgress): number {
  return skill.recentAverage ?? skill.normalizedScore ?? 100;
}

function skillOrderIndex(skill: DailyPracticeSkill): number {
  return SKILL_ORDER.indexOf(skill);
}

function sortProgress(
  a: DailyPracticeSkillProgress,
  b: DailyPracticeSkillProgress,
): number {
  const scoreDelta = scoreForSkill(a) - scoreForSkill(b);
  if (scoreDelta !== 0) return scoreDelta;
  if (a.trend !== b.trend) {
    if (a.trend === 'DECLINING') return -1;
    if (b.trend === 'DECLINING') return 1;
  }
  const aLast = a.lastPracticedAt ? new Date(a.lastPracticedAt).getTime() : 0;
  const bLast = b.lastPracticedAt ? new Date(b.lastPracticedAt).getTime() : 0;
  if (aLast !== bLast) return aLast - bLast;
  return skillOrderIndex(a.skill) - skillOrderIndex(b.skill);
}

function reasonForSkill(
  skill: DailyPracticeSkillProgress,
  primary: boolean,
  zeroState: boolean,
  dimension: string | null,
  isLocked: boolean,
): { code: DailyPracticeReasonCode; label: string } {
  if (isLocked) {
    return {
      code: 'ACCESS_LOCKED',
      label: 'Bài này cần quyền truy cập phù hợp',
    };
  }
  if (zeroState) {
    return {
      code: 'BALANCED_START',
      label: 'Khám phá trình độ của bạn',
    };
  }
  if (!skill.hasEnoughData) {
    return {
      code: 'NEEDS_MORE_DATA',
      label: `Cần thêm bài luyện để đánh giá kỹ năng ${SKILL_LABELS[skill.skill]}`,
    };
  }
  if (primary && dimension) {
    return {
      code: 'WEAKEST_DIMENSION',
      label: `Bạn nên luyện thêm ${dimensionLabel(dimension)}`,
    };
  }
  if (primary) {
    return {
      code: 'WEAKEST_SKILL',
      label: `Bạn đang cần củng cố kỹ năng ${SKILL_LABELS[skill.skill]}`,
    };
  }
  if (skill.trend === 'DECLINING') {
    return {
      code: 'DECLINING_TREND',
      label: `Nên luyện thêm ${SKILL_LABELS[skill.skill]} để giữ nhịp tiến bộ`,
    };
  }
  if (!skill.lastPracticedAt) {
    return {
      code: 'NOT_PRACTICED_RECENTLY',
      label: `Bạn chưa luyện ${SKILL_LABELS[skill.skill]} gần đây`,
    };
  }
  return {
    code: 'MAINTENANCE',
    label: `Duy trì kỹ năng ${SKILL_LABELS[skill.skill]}`,
  };
}

function seededOffset(seed: string, length: number): number {
  if (length <= 0) return 0;
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % length;
}

function chooseCandidate(
  candidates: CandidateInput[],
  skill: DailyPracticeSkillProgress,
  dateKey: string,
  userId: number,
  dimension: string | null,
): DailyPracticeCandidate | null {
  const matching = candidates.filter((candidate) =>
    dimension ? candidate.dimensions.includes(dimension) : true,
  );
  const pool = matching.length > 0 ? matching : candidates;
  if (pool.length === 0) return null;
  const accessible = pool.filter((candidate) => !candidate.isLocked);
  const accessibleOrPool = accessible.length > 0 ? accessible : pool;
  const fresh = accessibleOrPool.filter(
    (candidate) => !candidate.practicedBeforeToday,
  );
  const ranked = [...(fresh.length > 0 ? fresh : accessibleOrPool)].sort(
    (a, b) => {
      const oldDelta =
        Number(a.practicedBeforeToday) - Number(b.practicedBeforeToday);
      if (oldDelta !== 0) return oldDelta;
      const aDimension = dimension && a.dimensions.includes(dimension) ? 0 : 1;
      const bDimension = dimension && b.dimensions.includes(dimension) ? 0 : 1;
      if (aDimension !== bDimension) return aDimension - bDimension;
      return a.exerciseId - b.exerciseId;
    },
  );
  const offset = seededOffset(
    `${dateKey}:${userId}:${skill.skill}`,
    ranked.length,
  );
  const selected = ranked[offset];
  return selected
    ? {
        ...selected,
        isCompleted: selected.isCompleted ?? false,
        practicedBeforeToday: selected.practicedBeforeToday ?? false,
      }
    : null;
}

export function buildDailyPracticePlan(
  userId: number,
  dateKey: string,
  skills: DailyPracticeSkillProgress[],
  candidates: CandidateInput[],
): DailyPracticeResponse {
  const enough = skills
    .filter((skill) => skill.hasEnoughData)
    .sort(sortProgress);
  const underSampled = skills
    .filter((skill) => !skill.hasEnoughData)
    .sort(
      (a, b) =>
        (a.completedAttempts ?? 0) - (b.completedAttempts ?? 0) ||
        skillOrderIndex(a.skill) - skillOrderIndex(b.skill),
    );
  const zeroState = skills.every(
    (skill) => (skill.completedAttempts ?? 0) === 0,
  );
  const primary = enough[0] ?? underSampled[0] ?? skills[0];
  const selectedSkills: DailyPracticeSkillProgress[] = [];
  if (zeroState) {
    for (const key of [
      'LISTENING',
      'READING',
      'SPEAKING',
      'WRITING',
    ] as DailyPracticeSkill[]) {
      const skill = skills.find((item) => item.skill === key);
      if (skill) selectedSkills.push(skill);
      if (selectedSkills.length === DAILY_PRACTICE_MAX_ITEMS) break;
    }
  } else {
    const ordered = [
      primary,
      ...underSampled,
      ...enough.slice(1),
      ...skills,
    ].filter((skill): skill is DailyPracticeSkillProgress => Boolean(skill));
    for (const skill of ordered) {
      if (!selectedSkills.some((item) => item.skill === skill.skill)) {
        selectedSkills.push(skill);
      }
      if (selectedSkills.length === DAILY_PRACTICE_MAX_ITEMS) break;
    }
  }

  const items: DailyPracticeItem[] = [];
  for (const skill of selectedSkills) {
    const dimension =
      skill.skill === primary?.skill ? (skill.weakestDimension ?? null) : null;
    const candidate = chooseCandidate(
      candidates.filter((item) => item.skill === skill.skill),
      skill,
      dateKey,
      userId,
      dimension,
    );
    if (!candidate) continue;
    const reason = reasonForSkill(
      skill,
      skill.skill === primary?.skill,
      zeroState,
      dimension && candidate.dimensions.includes(dimension) ? dimension : null,
      candidate.isLocked,
    );
    items.push({
      skill: candidate.skill,
      exerciseId: candidate.exerciseId,
      title: candidate.title,
      route: candidate.isLocked ? '/plans?highlight=plus' : candidate.route,
      estimatedMinutes: candidate.estimatedMinutes,
      reasonCode: reason.code,
      reasonLabel: reason.label,
      isLocked: candidate.isLocked,
      isCompleted: candidate.isCompleted,
      priority: items.length + 1,
      dimension:
        dimension && candidate.dimensions.includes(dimension)
          ? dimension
          : null,
    });
  }

  const completedCount = items.filter((item) => item.isCompleted).length;
  const estimatedMinutes = items.reduce(
    (sum, item) => sum + item.estimatedMinutes,
    0,
  );
  const reasonSummary = zeroState
    ? 'Khám phá trình độ của bạn'
    : primary
      ? `Ưu tiên ${SKILL_LABELS[primary.skill]} dựa trên tiến độ gần đây`
      : 'Luyện đều các kỹ năng tiếng Anh';

  return {
    dateKey,
    generatedAt: new Date().toISOString(),
    estimatedMinutes,
    targetActivities: items.length,
    completedCount,
    reasonSummary,
    items,
  };
}

@Injectable()
export class AdaptiveDailyPracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly quizContentAccess: QuizContentAccessService,
    private readonly speakingContentAccess: SpeakingContentAccessService,
  ) {}

  async getDailyPractice(
    userId: number,
    role: Role = Role.STUDENT,
  ): Promise<DailyPracticeResponse> {
    const dateKey = getBusinessDayKey();
    const dayStart = getBusinessDayStart(dateKey);
    const tracking = await this.userService.getSkillProgressSummary(
      userId,
      role,
    );

    const quizTypes = [
      QuizType.LISTENING_PRACTICE,
      QuizType.BILINGUAL_READING,
      QuizType.WRITING_PICTURE,
      QuizType.WRITING_EMAIL,
    ];
    const quizzes = await this.prisma.quiz.findMany({
      where: {
        type: { in: quizTypes },
        publicationStatus: QuizPublicationStatus.PUBLISHED,
        questions: { some: {} },
      },
      select: {
        id: true,
        title: true,
        type: true,
        description: true,
        isPremiumContent: true,
        courseId: true,
        practiceTopicId: true,
        practiceTopic: { select: { name: true, category: true } },
        bilingualContent: true,
        questions: {
          select: {
            id: true,
            content: true,
            audioAssets: { where: { isActive: true }, select: { id: true } },
          },
          orderBy: { order: 'asc' },
        },
        listeningAudioArtifacts: {
          where: { status: 'PUBLISHED', r2Key: { not: null } },
          select: { id: true, r2Key: true, durationMs: true, timeline: true },
        },
      },
      orderBy: { id: 'asc' },
    });
    const accessByQuiz = await this.quizContentAccess.resolveMany(
      quizzes,
      userId,
      role,
    );
    const quizIds = quizzes.map((quiz) => quiz.id);
    const quizHistory = quizIds.length
      ? await this.prisma.submission.findMany({
          where: { userId, quizId: { in: quizIds } },
          select: {
            quizId: true,
            submittedAt: true,
            results: { select: { questionId: true } },
          },
          orderBy: { submittedAt: 'desc' },
        })
      : [];
    const questionIdsByQuiz = new Map(
      quizzes.map((quiz) => [
        quiz.id,
        new Set(quiz.questions.map((question) => question.id)),
      ]),
    );
    const completedQuizIds = new Set<number>();
    const practicedQuizIdsBeforeToday = new Set<number>();
    for (const submission of quizHistory) {
      if (submission.submittedAt < dayStart)
        practicedQuizIdsBeforeToday.add(submission.quizId);
      const questionIds = questionIdsByQuiz.get(submission.quizId);
      const resultIds = new Set(
        submission.results.map((result) => result.questionId),
      );
      if (
        questionIds &&
        resultIds.size === questionIds.size &&
        [...questionIds].every((id) => resultIds.has(id))
      ) {
        completedQuizIds.add(submission.quizId);
      }
    }

    const speakingExercises = await this.prisma.speakingExercise.findMany({
      select: {
        id: true,
        title: true,
        targetText: true,
        category: true,
        isPremiumContent: true,
      },
      orderBy: { id: 'asc' },
    });
    const speakingAccess = await this.speakingContentAccess.resolveMany(
      speakingExercises,
      userId,
      role,
    );
    const speakingIds = speakingExercises.map((exercise) => exercise.id);
    const speakingHistory = speakingIds.length
      ? await this.prisma.speakingSubmission.findMany({
          where: {
            userId,
            exerciseId: { in: speakingIds },
            status: 'COMPLETED',
          },
          select: { exerciseId: true, submittedAt: true },
          orderBy: { submittedAt: 'desc' },
        })
      : [];
    const completedSpeakingIds = new Set(
      speakingHistory.map((item) => item.exerciseId),
    );
    const practicedSpeakingIdsBeforeToday = new Set(
      speakingHistory
        .filter((item) => item.submittedAt < dayStart)
        .map((item) => item.exerciseId),
    );

    const candidates: CandidateInput[] = [];
    for (const quiz of quizzes) {
      const access = accessByQuiz.get(quiz.id);
      const metadata = asRecord(quiz.bilingualContent);
      const duration = Number(metadata.durationMinutes);
      const estimatedMinutes =
        Number.isFinite(duration) && duration > 0
          ? Math.min(6, Math.max(3, Math.ceil(duration / 2)))
          : quiz.type === QuizType.WRITING_EMAIL
            ? 6
            : 5;
      const dimensions = [
        ...new Set(
          quiz.questions.flatMap((question) => {
            const content = asRecord(question.content);
            return [
              metadataText(content, 'questionType'),
              metadataText(content, 'category'),
              metadataText(content, 'dimension'),
              quiz.type === QuizType.LISTENING_PRACTICE &&
              metadata.mode === 'DICTATION'
                ? 'DICTATION'
                : null,
            ]
              .filter((value): value is string => Boolean(value))
              .map((value) => value.toUpperCase());
          }),
        ),
      ];
      const isListening = quiz.type === QuizType.LISTENING_PRACTICE;
      const mode = metadataText(metadata, 'mode');
      const hasFullArtifact = quiz.listeningAudioArtifacts.some(
        (artifact) =>
          Boolean(artifact.r2Key) &&
          Boolean(artifact.timeline) &&
          (artifact.durationMs ?? 0) > 0,
      );
      const hasQuestionAudio = quiz.questions.every(
        (question) => question.audioAssets.length > 0,
      );
      const playable =
        !isListening ||
        (mode === 'DIALOGUE'
          ? hasFullArtifact
          : hasFullArtifact || hasQuestionAudio);
      if (!playable) continue;
      const skill: DailyPracticeSkill =
        quiz.type === QuizType.LISTENING_PRACTICE
          ? 'LISTENING'
          : quiz.type === QuizType.BILINGUAL_READING
            ? 'READING'
            : 'WRITING';
      const route =
        skill === 'WRITING'
          ? `/practice/writing/${quiz.practiceTopicId ?? quiz.id}`
          : `/practice/quizzes/${quiz.id}`;
      candidates.push({
        skill,
        exerciseId: quiz.id,
        title: quiz.title,
        route,
        estimatedMinutes,
        dimensions,
        isLocked: access?.isLocked ?? false,
        isCompleted: completedQuizIds.has(quiz.id),
        practicedBeforeToday: practicedQuizIdsBeforeToday.has(quiz.id),
      });
    }
    for (const exercise of speakingExercises) {
      if (!exercise.title.trim() || !exercise.targetText.trim()) continue;
      const access = speakingAccess.get(exercise.id);
      candidates.push({
        skill: 'SPEAKING',
        exerciseId: exercise.id,
        title: exercise.title,
        route: `/practice/speaking/${exercise.id}`,
        estimatedMinutes: 4,
        dimensions: [],
        isLocked: access?.isLocked ?? false,
        isCompleted: completedSpeakingIds.has(exercise.id),
        practicedBeforeToday: practicedSpeakingIdsBeforeToday.has(exercise.id),
      });
    }

    return buildDailyPracticePlan(userId, dateKey, tracking.skills, candidates);
  }
}
