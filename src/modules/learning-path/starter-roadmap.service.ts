import { Injectable } from '@nestjs/common';
import type { PracticeSkill, QuizType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { parseCefrRange } from '../subscription/practice-level';
import { itemLevel } from './ability.logic';
import { LevelAccessService } from './level-access.service';
import { isLevelLocked } from './progression.logic';
import {
  buildRoadmap,
  deckDone,
  STARTER_ROADMAP,
  type RoadmapRef,
  type StepFacts,
} from './starter-roadmap.logic';

const QUIZ_SKILL: Partial<Record<QuizType, PracticeSkill>> = {
  LISTENING_PRACTICE: 'LISTENING',
  BILINGUAL_READING: 'READING',
  WRITING_PICTURE: 'WRITING',
  WRITING_EMAIL: 'WRITING',
};

const titlesOf = (kind: RoadmapRef['kind']) =>
  STARTER_ROADMAP.flatMap(({ ref }) =>
    ref.kind === kind && 'title' in ref ? [ref.title] : [],
  );

/** The learner's place on the starter path, from what they have really done. */
@Injectable()
export class StarterRoadmapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly levelAccess: LevelAccessService,
  ) {}

  async forUser(userId: number) {
    const setIds = STARTER_ROADMAP.flatMap(({ ref }) =>
      ref.kind === 'SPEAKING_SET' ? [ref.id] : [],
    );
    const [grammar, decks, quizzes, sets, unlocked] = await Promise.all([
      this.prisma.grammarTopic.findMany({
        where: {
          title: { in: titlesOf('GRAMMAR') },
          publicationStatus: 'PUBLISHED',
        },
        select: {
          id: true,
          title: true,
          attempts: { where: { userId }, take: 1, select: { id: true } },
        },
      }),
      this.prisma.vocabTopic.findMany({
        where: {
          title: { in: titlesOf('VOCAB') },
          publicationStatus: 'PUBLISHED',
        },
        select: { id: true, title: true, totalWords: true },
      }),
      this.prisma.quiz.findMany({
        where: {
          title: { in: titlesOf('QUIZ') },
          publicationStatus: 'PUBLISHED',
          courseId: null,
        },
        select: {
          id: true,
          title: true,
          type: true,
          submissions: { where: { userId }, take: 1, select: { id: true } },
        },
      }),
      this.prisma.speakingPracticeSet.findMany({
        where: { id: { in: setIds }, publicationStatus: 'PUBLISHED' },
        select: {
          id: true,
          level: true,
          exercises: {
            where: { publicationStatus: 'PUBLISHED' },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              submissions: {
                where: { userId, status: 'COMPLETED' },
                take: 1,
                select: { id: true },
              },
            },
          },
        },
      }),
      this.levelAccess.unlockedLevels(userId),
    ]);
    const studied = await this.prisma.userVocabWordProgress.groupBy({
      by: ['wordId'],
      where: {
        userId,
        word: { topicId: { in: decks.map((deck) => deck.id) } },
        OR: [{ reviewCount: { gt: 0 } }, { isMastered: true }],
      },
    });
    const wordTopics = await this.prisma.vocabWord.findMany({
      where: { id: { in: studied.map((row) => row.wordId) } },
      select: { topicId: true },
    });

    const locked = (skill: PracticeSkill, tag?: string | null) => {
      const range = parseCefrRange(tag);
      return range ? isLevelLocked(itemLevel(range), unlocked[skill]) : false;
    };
    const facts = (ref: RoadmapRef): StepFacts | undefined => {
      if (ref.kind === 'GRAMMAR') {
        const topic = grammar.find((t) => t.title === ref.title);
        return topic
          ? {
              route: `/reading?category=grammar&topicId=${topic.id}`,
              done: topic.attempts.length > 0,
              locked: false,
            }
          : undefined;
      }
      if (ref.kind === 'VOCAB') {
        const deck = decks.find((d) => d.title === ref.title);
        return deck
          ? {
              route: `/flashcard/${deck.id}`,
              done: deckDone(
                wordTopics.filter((w) => w.topicId === deck.id).length,
                deck.totalWords,
              ),
              locked: false,
            }
          : undefined;
      }
      if (ref.kind === 'QUIZ') {
        const quiz = quizzes.find((q) => q.title === ref.title);
        const skill = quiz && QUIZ_SKILL[quiz.type];
        return quiz && skill
          ? {
              route: `/${skill.toLowerCase()}/${quiz.id}`,
              done: quiz.submissions.length > 0,
              locked: locked(skill, quiz.title),
            }
          : undefined;
      }
      const set = sets.find((s) => s.id === ref.id);
      const first = set?.exercises[0];
      return set && first
        ? {
            route: `/speaking/${first.id}?set=${encodeURIComponent(set.id)}`,
            done: set.exercises.some((e) => e.submissions.length > 0),
            locked: locked('SPEAKING', set.level),
          }
        : undefined;
    };
    return buildRoadmap(STARTER_ROADMAP, (step) => facts(step.ref));
  }
}
