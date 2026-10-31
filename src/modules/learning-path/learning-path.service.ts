import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LearningContentType, PracticeSkill } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { FOUR_SKILL_SCORING_VERSION } from '../diagnostic/diagnostic-four-skill';
import { refreshFourSkillResult } from '../diagnostic/diagnostic-four-skill.store';
import { SubscriptionService } from '../subscription/subscription.service';
import { UpdateLearnerProfileDto } from './dto/learner-profile.dto';
import { loadCandidates, loadLearnerState } from './learning-path.catalog';
import {
  contentKey,
  dailyPlan,
  recommend,
  type Recommendation,
} from './recommendation.logic';
import { PRACTICE_LEVEL_LABEL, PRACTICE_SKILLS } from './placement.logic';
import { applySelfLevel } from './placement.store';
import { levelProgress, nextLevel } from './progression.logic';
import { LevelAccessService } from './level-access.service';

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

  /** "Nhiệm vụ hôm nay": open items filling the learner's daily minutes. */
  async today(userId: number) {
    const { catalog, learner } = await this.context(userId);
    const ranked = recommend(catalog.candidates, learner, { limit: 12 });
    return {
      minutesPerDay: learner.minutesPerDay,
      items: dailyPlan(ranked, learner.minutesPerDay).map((r) =>
        this.view(r, learner.saved),
      ),
    };
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
