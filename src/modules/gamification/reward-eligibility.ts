/**
 * Owner policy (2026-10-27): XP and Bánh mì are earned ONLY by
 *   - standalone Listening practice   (Quiz LISTENING_PRACTICE)
 *   - standalone Reading practice     (Quiz BILINGUAL_READING)
 *   - standalone Writing practice     (catalog Quiz WRITING_* with a practice topic)
 *   - standalone Speaking practice    (SpeakingExercise outside exam sets)
 *   - Vocabulary Arena                (rewarded in the arena gateway itself)
 * Everything else (Entry Diagnostic, every TOEIC product, grammar,
 * flashcards and vocabulary, other quizzes) keeps its scores and progress but earns nothing, directly or through
 * daily quests and badges.
 *
 * The decision is made from server data about what the content belongs to,
 * never from a client flag or a URL. Content that is also part of an exam is
 * not rewarded (fail closed), because the same item can then be reached from a context that must not pay.
 */
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

export type QuizRewardFacts = {
  type: string;
  practiceTopicId: number | null;
  inToeicWritingSet: boolean;
};

export type SpeakingRewardFacts = {
  practiceSetScope: string | null;
};

export function isRewardableQuiz(f: QuizRewardFacts): boolean {
  if (f.inToeicWritingSet) return false;
  if (f.type === 'LISTENING_PRACTICE' || f.type === 'BILINGUAL_READING')
    return true;
  if (f.type === 'WRITING_PICTURE' || f.type === 'WRITING_EMAIL')
    return f.practiceTopicId !== null;
  return false;
}

export function isRewardableSpeakingExercise(f: SpeakingRewardFacts): boolean {
  return f.practiceSetScope !== 'EXAM_INTERNAL';
}

@Injectable()
export class RewardEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async quiz(quizId: number | undefined): Promise<boolean> {
    if (!quizId) return false;
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        type: true,
        practiceTopicId: true,
        toeicWritingSetItems: { select: { id: true }, take: 1 },
      },
    });
    if (!quiz) return false;
    return isRewardableQuiz({
      type: quiz.type,
      practiceTopicId: quiz.practiceTopicId,
      inToeicWritingSet: quiz.toeicWritingSetItems.length > 0,
    });
  }

  async speakingExercise(exerciseId: number | undefined): Promise<boolean> {
    if (!exerciseId) return false;
    const exercise = await this.prisma.speakingExercise.findUnique({
      where: { id: exerciseId },
      select: {
        practiceSet: { select: { scope: true } },
      },
    });
    if (!exercise) return false;
    return isRewardableSpeakingExercise({
      practiceSetScope: exercise.practiceSet?.scope ?? null,
    });
  }
}
