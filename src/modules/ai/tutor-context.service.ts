import { Injectable, Logger } from '@nestjs/common';
import { AttemptStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  grammarItemContext,
  quizItemContext,
  toeicItemContext,
  type TutorContextRef,
} from './tutor-context.logic';
import type { TutorContext } from './tutor-prompt.logic';

/**
 * Loads the item a learner asks the tutor about. The browser sends only ids;
 * the question, the key and the explanation come from the database, and only
 * for an attempt that belongs to the learner and is already submitted, so the
 * tutor can never be used to read an answer key early.
 */
@Injectable()
export class TutorContextService {
  private readonly logger = new Logger(TutorContextService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The item, or null when it does not exist, is not the learner's, or is not submitted. */
  async load(
    userId: number,
    ref: TutorContextRef,
  ): Promise<TutorContext | null> {
    try {
      if (ref.sourceType === 'TOEIC_ATTEMPT')
        return await this.toeic(userId, ref);
      if (ref.sourceType === 'GRAMMAR_ATTEMPT')
        return await this.grammar(userId, ref);
      return await this.quiz(userId, ref);
    } catch (error) {
      this.logger.warn(
        `Tutor context ${ref.sourceType}#${ref.sourceId}: ${String(error)}`,
      );
      return null;
    }
  }

  private async toeic(userId: number, ref: TutorContextRef) {
    if (!ref.questionId) return null;
    const attempt = await this.prisma.toeicAttempt.findFirst({
      where: { id: ref.sourceId, userId, status: AttemptStatus.SUBMITTED },
      select: { examId: true },
    });
    if (!attempt) return null;
    const question = await this.prisma.toeicQuestion.findFirst({
      where: { id: ref.questionId, group: { examId: attempt.examId } },
      include: { group: true },
    });
    if (!question) return null;
    const answer = await this.prisma.toeicAttemptAnswer.findUnique({
      where: {
        attemptId_questionId: {
          attemptId: ref.sourceId,
          questionId: question.id,
        },
      },
      select: { selectedIndex: true },
    });
    return toeicItemContext({
      part: question.group.part,
      questionNumber: question.questionNumber,
      text: question.text,
      options: question.options,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      passageText: question.group.passageText,
      transcriptText: question.group.transcriptText,
      selectedIndex: answer?.selectedIndex ?? null,
    });
  }

  private async grammar(userId: number, ref: TutorContextRef) {
    if (!ref.questionId) return null;
    const attempt = await this.prisma.grammarAttempt.findFirst({
      where: { id: ref.sourceId, userId },
      include: {
        topic: {
          select: {
            title: true,
            questions: {
              orderBy: [{ order: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });
    if (!attempt) return null;
    const index = attempt.topic.questions.findIndex(
      (q) => q.id === ref.questionId,
    );
    if (index < 0) return null;
    const question = attempt.topic.questions[index];
    const answers = (attempt.answers ?? {}) as Record<string, unknown>;
    const selected = Number(answers[String(question.id)]);
    return grammarItemContext({
      topicTitle: attempt.topic.title,
      position: index + 1,
      question: question.question,
      options: question.options,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      selectedIndex: Number.isInteger(selected) ? selected : null,
    });
  }

  private async quiz(userId: number, ref: TutorContextRef) {
    const submission = await this.prisma.submission.findFirst({
      // A graded submission has a score; one still waiting for a grade does not.
      where: { id: ref.sourceId, userId, score: { not: null } },
      include: {
        results: true,
        quiz: {
          select: {
            type: true,
            title: true,
            questions: {
              select: { id: true, type: true, content: true },
              orderBy: [{ order: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });
    if (!submission) return null;
    const questionId = ref.questionId ?? submission.results[0]?.questionId;
    const index = submission.quiz.questions.findIndex(
      (q) => q.id === questionId,
    );
    if (index < 0) return null;
    const question = submission.quiz.questions[index];
    const result = submission.results.find((r) => r.questionId === question.id);
    return quizItemContext({
      quizType: submission.quiz.type,
      quizTitle: submission.quiz.title,
      position: index + 1,
      questionType: question.type,
      content: (question.content ?? null) as Record<string, unknown> | null,
      answer: result?.answer ?? null,
      isCorrect: result?.isCorrect ?? null,
      feedback: submission.aiFeedback,
    });
  }
}
