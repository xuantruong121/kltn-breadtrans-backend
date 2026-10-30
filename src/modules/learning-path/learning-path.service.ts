import { ConflictException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { FOUR_SKILL_SCORING_VERSION } from '../diagnostic/diagnostic-four-skill';
import { refreshFourSkillResult } from '../diagnostic/diagnostic-four-skill.store';
import { UpdateLearnerProfileDto } from './dto/learner-profile.dto';
import { PRACTICE_SKILLS } from './placement.logic';
import { applySelfLevel } from './placement.store';

@Injectable()
export class LearningPathService {
  constructor(private readonly prisma: PrismaService) {}

  /** The learner's profile and per-skill levels; defaults before onboarding. */
  async getProfile(userId: number) {
    await this.backfillPlacement(userId);
    const [profile, levels] = await Promise.all([
      this.prisma.learnerProfile.findUnique({ where: { userId } }),
      this.prisma.learnerSkillLevel.findMany({ where: { userId } }),
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
        return {
          skill,
          level: row?.level ?? null,
          unlockedLevel: row?.unlockedLevel ?? null,
          source: row?.source ?? 'NONE',
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
