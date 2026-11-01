import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  LearningContentType,
  PracticeLevel,
  PracticeSkill,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { FOUR_SKILL_SCORING_VERSION } from '../diagnostic/diagnostic-four-skill';
import { refreshFourSkillResult } from '../diagnostic/diagnostic-four-skill.store';
import { SubscriptionService } from '../subscription/subscription.service';
import { UpdateLearnerProfileDto } from './dto/learner-profile.dto';
import { foundationPlan } from './foundation.logic';
import { buildLevelRoadmap } from './level-roadmap.logic';
import { progressReport } from './progress-report.logic';
import {
  estimateNextLevels,
  itemsToNextLevel,
  nextLevelLabel,
  skillWeights,
  weekStart,
  weeklyTargets,
} from './week.logic';
import { loadCandidates, loadLearnerState } from './learning-path.catalog';
import {
  GOAL_SKILLS,
  contentKey,
  dailyPlan,
  moreChoices,
  recommend,
  weakestSkill,
  type Recommendation,
} from './recommendation.logic';
import {
  PRACTICE_LEVEL_LABEL,
  PRACTICE_SKILLS,
  levelIndex,
} from './placement.logic';
import { applySelfLevel } from './placement.store';
import {
  PROGRESS_AVERAGE,
  levelProgress,
  nextLevel,
} from './progression.logic';
import { LevelAccessService } from './level-access.service';

/** Extra open items offered beside the daily plan. */
const MORE_CHOICES = 12;
/** Vocabulary and grammar items offered beside the daily plan. */
const FOUNDATION_ITEMS = 6;

@Injectable()
export class LearningPathService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly levelAccess: LevelAccessService,
  ) {}

  private async context(userId: number) {
    const planCode = await this.subscriptions.effectivePlanCode(userId);
    const catalog = await loadCandidates(this.prisma, planCode);
    const learner = await loadLearnerState(
      this.prisma,
      userId,
      catalog.setKeyOfExercise,
    );
    // The same open level access uses (empty levels passed over).
    const unlocked = await this.levelAccess.unlockedLevels(userId);
    for (const skill of PRACTICE_SKILLS) {
      const state = learner.skills[skill];
      if (state) state.unlockedLevel = unlocked[skill];
    }
    return { catalog, learner };
  }

  private view(r: Recommendation, saved: Set<string>) {
    const c = r.candidate;
    return {
      contentType: c.type,
      contentId: c.id,
      skill: c.skill,
      level: c.level,
      levelLabel: PRACTICE_LEVEL_LABEL[c.level],
      title: c.title,
      route: c.route,
      minutes: c.minutes,
      status: r.status,
      requiredPlan: c.requiredPlan,
      planLocked: c.planLocked,
      reasons: r.reasons,
      predictedSuccess: r.predictedSuccess,
      saved: saved.has(contentKey(c)),
    };
  }

  /**
   * "Nhiệm vụ hôm nay": open items filling the learner's daily minutes, plus
   * other open items to choose from.
   */
  async today(userId: number) {
    const { catalog, learner } = await this.context(userId);
    const ranked = recommend(catalog.candidates, learner, { limit: 24 });
    const plan = dailyPlan(ranked, learner.minutesPerDay);
    return {
      minutesPerDay: learner.minutesPerDay,
      items: plan.map((r) => this.view(r, learner.saved)),
      more: moreChoices(ranked, plan, MORE_CHOICES).map((r) =>
        this.view(r, learner.saved),
      ),
      foundation: foundationPlan(
        await this.foundationInput(userId),
        FOUNDATION_ITEMS,
      ),
    };
  }

  /** The path of a learner past Mất gốc; null for a Mất gốc learner. */
  async levelRoadmap(userId: number) {
    const input = await this.foundationInput(userId);
    if (input.learner === 'STARTER') return null;
    const [{ catalog, learner }, profile] = await Promise.all([
      this.context(userId),
      this.getProfile(userId),
    ]);
    return buildLevelRoadmap({
      level: input.learner,
      grammar: input.grammar,
      decks: input.decks,
      skills: profile.skills.map((s) => ({
        skill: s.skill,
        unlockedLevel: s.unlockedLevel,
        done: s.progress.done,
        average: s.progress.average,
        nextRoute:
          recommend(catalog.candidates, learner, {
            limit: 1,
            skill: s.skill,
          })[0]?.candidate.route ?? null,
      })),
    });
  }

  /** Vocabulary and grammar progress, from the learner's own records. */
  private async foundationInput(userId: number) {
    const now = new Date();
    const [profile, topics, attempts, decks, progress, weakReading] =
      await Promise.all([
        this.prisma.learnerProfile.findUnique({ where: { userId } }),
        this.prisma.grammarTopic.findMany({
          where: { publicationStatus: 'PUBLISHED' },
          orderBy: { order: 'asc' },
          select: { id: true, title: true, level: true },
        }),
        this.prisma.grammarAttempt.findMany({
          where: { userId },
          select: { topicId: true, score: true },
        }),
        this.prisma.vocabTopic.findMany({
          where: {
            publicationStatus: 'PUBLISHED',
            categoryName: { not: 'SYSTEM_DICTIONARY' },
          },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            title: true,
            level: true,
            _count: { select: { words: true } },
          },
        }),
        this.prisma.userVocabWordProgress.findMany({
          where: { userId },
          select: {
            isMastered: true,
            nextReviewAt: true,
            word: { select: { topicId: true } },
          },
        }),
        this.prisma.learnerProgressEvent.findFirst({
          where: {
            userId,
            skill: 'READING',
            scorePercent: { lt: PROGRESS_AVERAGE },
          },
          select: { id: true },
        }),
      ]);
    const best = new Map<number, number>();
    for (const a of attempts)
      best.set(a.topicId, Math.max(best.get(a.topicId) ?? 0, a.score));
    const mastered = new Map<number, number>();
    for (const p of progress)
      if (p.isMastered)
        mastered.set(p.word.topicId, (mastered.get(p.word.topicId) ?? 0) + 1);
    return {
      learner:
        (profile?.placementSource === 'DIAGNOSTIC'
          ? profile.placementLevel
          : profile?.selfLevel) ?? 'BASIC',
      dueWords: progress.filter((p) => p.nextReviewAt && p.nextReviewAt <= now)
        .length,
      readingToReview: weakReading !== null,
      grammar: topics.map((t) => ({ ...t, best: best.get(t.id) ?? null })),
      decks: decks.map((d) => ({
        id: d.id,
        title: d.title,
        level: d.level,
        total: d._count.words,
        mastered: mastered.get(d.id) ?? 0,
      })),
    };
  }

  /** "Tuần này": weekly targets per skill and a rough date for the next levels. */
  async week(userId: number) {
    const now = new Date();
    const { learner } = await this.context(userId);
    const start = weekStart(now);
    const [profile, events] = await Promise.all([
      this.prisma.learnerProfile.findUnique({ where: { userId } }),
      this.prisma.learnerProgressEvent.findMany({
        where: { userId },
        select: {
          skill: true,
          level: true,
          contentId: true,
          scorePercent: true,
          createdAt: true,
        },
      }),
    ]);
    const unlocked = await this.levelAccess.unlockedLevels(userId);
    const targets = weeklyTargets(
      learner.minutesPerDay,
      skillWeights(GOAL_SKILLS[learner.goal], weakestSkill(learner)),
    );
    const skills = PRACTICE_SKILLS.map((skill) => {
      const own = events.filter((e) => e.skill === skill);
      const atLevel = own.filter((e) => e.level === unlocked[skill]);
      const progress = {
        skill,
        unlockedLevel: unlocked[skill],
        done: levelProgress(atLevel).done,
      };
      return {
        ...progress,
        doneThisWeek: own.filter((e) => e.createdAt >= start).length,
        target: targets[skill],
        remaining: itemsToNextLevel(progress),
        nextLevelLabel: nextLevelLabel(unlocked[skill]),
      };
    });
    return {
      minutesPerDay: learner.minutesPerDay,
      weekStart: start,
      skills,
      estimate: estimateNextLevels({
        skills,
        minutesPerDay: learner.minutesPerDay,
        targetDate: profile?.targetDate ?? null,
        now,
      }),
    };
  }

  /** "Tiến bộ của bạn": attempts, averages and levels gained per skill. */
  async progress(userId: number) {
    const [events, placed, currentLevels] = await Promise.all([
      this.prisma.learnerProgressEvent.findMany({
        where: { userId },
        select: { skill: true, scorePercent: true, createdAt: true },
      }),
      this.prisma.levelUnlock.findMany({
        where: { userId, method: { in: ['PLACEMENT', 'SELF_CHOICE'] } },
        select: { skill: true, level: true },
      }),
      this.levelAccess.unlockedLevels(userId),
    ]);
    const startLevels: Partial<Record<PracticeSkill, PracticeLevel>> = {};
    for (const row of placed) {
      const known = startLevels[row.skill];
      if (!known || levelIndex(row.level) > levelIndex(known))
        startLevels[row.skill] = row.level;
    }
    return progressReport({ events, startLevels, currentLevels });
  }

  /** "Đề xuất cho bạn" on a skill page, locked items included with reasons. */
  async recommendedForSkill(userId: number, skill: PracticeSkill) {
    const { catalog, learner } = await this.context(userId);
    return recommend(catalog.candidates, learner, {
      limit: 12,
      skill,
      includeLocked: true,
    }).map((r) => this.view(r, learner.saved));
  }

  async saved(userId: number) {
    const { catalog, learner } = await this.context(userId);
    return recommend(
      catalog.candidates.filter((c) => learner.saved.has(contentKey(c))),
      learner,
      { limit: 100, includeLocked: true },
    ).map((r) => this.view(r, learner.saved));
  }

  async saveItem(
    userId: number,
    contentType: LearningContentType,
    contentId: number,
  ) {
    const { catalog, learner } = await this.context(userId);
    const r = recommend(
      catalog.candidates.filter(
        (c) => c.type === contentType && c.id === contentId,
      ),
      { ...learner, history: new Map() },
      { limit: 1, includeLocked: true },
    )[0];
    if (!r) throw new NotFoundException('Không tìm thấy bài luyện này');
    const reason = r.reasons[0] ?? 'Bạn đã lưu bài này';
    await this.prisma.learningPlanItem.upsert({
      where: {
        userId_contentType_contentId: { userId, contentType, contentId },
      },
      create: {
        userId,
        contentType,
        contentId,
        skill: r.candidate.skill,
        level: r.candidate.level,
        reason,
        status: 'SAVED',
      },
      update: { status: 'SAVED', reason },
    });
    return { saved: true };
  }

  async unsaveItem(
    userId: number,
    contentType: LearningContentType,
    contentId: number,
  ) {
    await this.prisma.learningPlanItem.deleteMany({
      where: { userId, contentType, contentId },
    });
    return { saved: false };
  }

  /** The learner's profile and per-skill levels; defaults before onboarding. */
  async getProfile(userId: number) {
    await this.backfillPlacement(userId);
    const [profile, levels, events, unlocked] = await Promise.all([
      this.prisma.learnerProfile.findUnique({ where: { userId } }),
      this.prisma.learnerSkillLevel.findMany({ where: { userId } }),
      this.prisma.learnerProgressEvent.findMany({
        where: { userId },
        select: {
          skill: true,
          level: true,
          contentId: true,
          scorePercent: true,
        },
      }),
      this.levelAccess.unlockedLevels(userId),
    ]);
    return {
      track: profile?.track ?? 'GENERAL',
      goal: profile?.goal ?? 'GENERAL',
      minutesPerDay: profile?.minutesPerDay ?? 15,
      targetDate: profile?.targetDate ?? null,
      selfLevel: profile?.selfLevel ?? null,
      placementLevel: profile?.placementLevel ?? null,
      placementSource: profile?.placementSource ?? 'NONE',
      onboarded: Boolean(profile?.onboardedAt),
      skills: PRACTICE_SKILLS.map((skill) => {
        const row = levels.find((l) => l.skill === skill);
        const unlockedLevel = unlocked[skill];
        return {
          skill,
          level: row?.level ?? null,
          unlockedLevel,
          source: row?.source ?? 'NONE',
          nextLevel: nextLevel(unlockedLevel),
          progress: levelProgress(
            events.filter(
              (e) => e.skill === skill && e.level === unlockedLevel,
            ),
          ),
        };
      }),
    };
  }

  /**
   * A four-skill diagnostic completed before placement existed (or never
   * re-read) has no placement yet: refreshing its result applies it once.
   */
  private async backfillPlacement(userId: number) {
    const profile = await this.prisma.learnerProfile.findUnique({
      where: { userId },
      select: { placementAttemptId: true },
    });
    if (profile?.placementAttemptId) return;
    const attempt = await this.prisma.diagnosticAttempt.findFirst({
      where: {
        userId,
        status: 'COMPLETED',
        scoringVersion: FOUR_SKILL_SCORING_VERSION,
      },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    if (attempt) await refreshFourSkillResult(this.prisma, attempt.id);
  }

  async updateProfile(userId: number, dto: UpdateLearnerProfileDto) {
    const current = await this.prisma.learnerProfile.findUnique({
      where: { userId },
    });
    if (dto.selfLevel && current?.placementSource === 'DIAGNOSTIC')
      throw new ConflictException(
        'Bạn đã có mức luyện tập từ bài kiểm tra đầu vào. Mức cao hơn được mở qua bài kiểm tra mở khóa hoặc tiến độ luyện tập.',
      );
    const data = {
      ...(dto.track ? { track: dto.track } : {}),
      ...(dto.goal ? { goal: dto.goal } : {}),
      ...(dto.minutesPerDay ? { minutesPerDay: dto.minutesPerDay } : {}),
      ...(dto.targetDate !== undefined
        ? { targetDate: dto.targetDate ? new Date(dto.targetDate) : null }
        : {}),
      ...(dto.onboarded && !current?.onboardedAt
        ? { onboardedAt: new Date() }
        : {}),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.learnerProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
      if (dto.selfLevel) await applySelfLevel(tx, userId, dto.selfLevel);
    });
    return this.getProfile(userId);
  }
}
