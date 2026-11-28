import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getLearnerDayKey } from '../../common/time/business-time.util';
import {
  answerCount,
  creditedSeconds,
  daysInRange,
  skillBreakdown,
  summaryRange,
  withVocabCount,
  tileOfQuizType,
  type SkillTile,
  type StudySkill,
  type SummaryPeriod,
} from './learning-summary.logic';

/**
 * Study time reported by the practice rooms, and the dashboard's "Kết quả học
 * tập" for a period, from the learner's own rows (owner 2026-11-26).
 */
@Injectable()
export class LearningSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Adds what a room counted, within the per-report and per-day caps. */
  async addStudyTime(
    userId: number,
    skill: StudySkill,
    seconds: number,
    now = new Date(),
  ) {
    const dayKey = getLearnerDayKey(now);
    const today = await this.prisma.studyTime.aggregate({
      where: { userId, dayKey },
      _sum: { seconds: true },
    });
    const add = creditedSeconds(seconds, today._sum.seconds ?? 0);
    if (add > 0)
      await this.prisma.studyTime.upsert({
        where: { userId_dayKey_skill: { userId, dayKey, skill } },
        create: { userId, dayKey, skill, seconds: add },
        update: { seconds: { increment: add } },
      });
    return { dayKey, added: add };
  }

  async summary(
    userId: number,
    period: SummaryPeriod,
    from?: string,
    to?: string,
    now = new Date(),
  ) {
    const range = summaryRange(period, now, from, to);
    const within = {
      ...(range.start ? { gte: range.start } : {}),
      lt: range.end,
    };
    const submitted = { userId, submittedAt: within };
    const [
      time,
      quizSubs,
      speakingSubs,
      examAttempts,
      vocabEvents,
      points,
      grammar,
      content,
      results,
      examAnswers,
      mastered,
      allTimeXp,
    ] = await Promise.all([
      this.prisma.studyTime.findMany({
        where: {
          userId,
          dayKey: {
            ...(range.startKey ? { gte: range.startKey } : {}),
            lte: range.endKey,
          },
        },
        select: { dayKey: true, skill: true, seconds: true },
      }),
      this.prisma.submission.findMany({
        where: submitted,
        select: { submittedAt: true, quiz: { select: { type: true } } },
      }),
      this.prisma.speakingSubmission.findMany({
        where: submitted,
        select: { submittedAt: true },
      }),
      this.prisma.toeicAttempt.findMany({
        where: { userId, submittedAt: { not: null, ...within } },
        select: { submittedAt: true },
      }),
      this.prisma.learningActivity.findMany({
        where: { userId, type: 'VOCABULARY_MASTERED', occurredAt: within },
        select: { occurredAt: true, sourceId: true },
      }),
      this.prisma.pointHistory.aggregate({
        where: { userId, points: { gt: 0 }, createdAt: within },
        _sum: { points: true },
      }),
      this.prisma.grammarAttempt.findMany({
        where: { userId, createdAt: within },
        select: { answers: true },
      }),
      this.prisma.contentAttempt.aggregate({
        where: submitted,
        _sum: { totalCount: true },
      }),
      this.prisma.result.count({ where: { submission: submitted } }),
      this.prisma.toeicAttemptAnswer.count({
        where: {
          selectedIndex: { not: null },
          attempt: { userId, submittedAt: { not: null, ...within } },
        },
      }),
      // Words mastered now: a word mastered and then forgotten (or reset) is
      // not counted, so no period shows more words than "Tất cả".
      this.prisma.userVocabWordProgress.findMany({
        where: { userId, isMastered: true },
        select: { wordId: true },
      }),
      // "Tất cả" shows XP as the ranking page and the level do. Old seed rows
      // gave some test accounts XP with no PointHistory row behind it.
      period === 'all'
        ? this.prisma.leaderboard.findUnique({
            where: { userId },
            select: { totalPoints: true },
          })
        : Promise.resolve(null),
    ]);

    // Each word still mastered counts once, on its latest mastering in the period.
    const masteredIds = new Set(mastered.map((m) => String(m.wordId)));
    const latest = new Map<string, Date>();
    for (const e of vocabEvents) {
      if (!e.sourceId || !masteredIds.has(e.sourceId)) continue;
      const seen = latest.get(e.sourceId);
      if (!seen || e.occurredAt > seen) latest.set(e.sourceId, e.occurredAt);
    }
    const vocabDone = [...latest.values()].map((at): [SkillTile, Date] => [
      'VOCAB',
      at,
    ]);
    const masteredNow = period === 'all' ? masteredIds.size : null;
    const done: Array<[SkillTile, Date]> = [
      ...quizSubs.flatMap((s): Array<[SkillTile, Date]> => {
        const tile = tileOfQuizType(s.quiz.type);
        return tile ? [[tile, s.submittedAt]] : [];
      }),
      ...speakingSubs.map((s): [SkillTile, Date] => [
        'SPEAKING',
        s.submittedAt,
      ]),
      ...examAttempts.map((a): [SkillTile, Date] => ['EXAM', a.submittedAt!]),
      ...vocabDone,
    ];

    return {
      period,
      from: range.startKey,
      to: range.endKey,
      days: daysInRange(range.startKey, range.endKey),
      totals: {
        studySeconds: time.reduce((n, r) => n + r.seconds, 0),
        questions:
          results +
          examAnswers +
          (content._sum.totalCount ?? 0) +
          grammar.reduce((n, g) => n + answerCount(g.answers), 0),
        vocabMastered: masteredNow ?? vocabDone.length,
        xp:
          period === 'all'
            ? (allTimeXp?.totalPoints ?? 0)
            : (points._sum.points ?? 0),
      },
      skills: withVocabCount(skillBreakdown({ done, time }), masteredNow),
    };
  }
}
