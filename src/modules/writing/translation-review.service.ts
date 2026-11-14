import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuizType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  matchTranslation,
  normalizeEnglishSentence,
  SENTENCE_TRANSLATION_MAX_CHARS,
  translationTaskIssues,
  translationTaskOf,
} from './sentence-translation.logic';

/** Learner answers older than this are not offered for review. */
const LOOKBACK_DAYS = 90;
/** At most this many recent checks are read per listing. */
const SCAN_LIMIT = 3000;
/** The CMS accepts this many answers on one sentence. */
export const MAX_ACCEPTED_ANSWERS = 20;

const keyOf = (answer: string) => normalizeEnglishSentence(answer).join(' ');

type Row = {
  questionId: number;
  quizId: number;
  quizTitle: string;
  prompt: string;
  /** The spelling learners used most. */
  answer: string;
  key: string;
  count: number;
  learners: number;
  lastAt: Date;
  explanation: string | null;
  acceptedAnswers: string[];
};

/**
 * "Duyệt câu dịch" (owner 2026-11-14): learner translations the AI judged
 * right that are not accepted answers yet. An admin adds one to the
 * sentence's accepted answers (later learners who write it are checked
 * without the AI) or dismisses it. Both decisions live in Question.content:
 * acceptedAnswers, and dismissedAnswers (normalised), which learners never
 * receive. No table, so no record of which admin decided.
 */
@Injectable()
export class TranslationReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: { page?: number; limit?: number }) {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const limit = Math.min(
      100,
      Math.max(1, Math.floor(Number(query.limit) || 20)),
    );
    const submissions = await this.prisma.submission.findMany({
      where: {
        submittedAt: { gte: new Date(Date.now() - LOOKBACK_DAYS * 86_400_000) },
        aiFeedback: { contains: 'SENTENCE_TRANSLATION_V1' },
        quiz: { type: QuizType.WRITING_PICTURE },
      },
      select: {
        userId: true,
        submittedAt: true,
        aiFeedback: true,
        quizId: true,
        results: { select: { questionId: true }, take: 1 },
      },
      orderBy: { submittedAt: 'desc' },
      take: SCAN_LIMIT,
    });

    const groups = new Map<
      string,
      {
        questionId: number;
        quizId: number;
        key: string;
        spellings: Map<string, number>;
        learners: Set<number>;
        count: number;
        lastAt: Date;
        explanation: string | null;
      }
    >();
    for (const s of submissions) {
      const questionId = s.results[0]?.questionId;
      if (typeof questionId !== 'number' || !s.aiFeedback) continue;
      let t: Record<string, unknown> | undefined;
      try {
        const parsed = JSON.parse(s.aiFeedback) as Record<string, unknown>;
        if (parsed.rubricVersion !== 'SENTENCE_TRANSLATION_V1') continue;
        t = parsed.translation as Record<string, unknown> | undefined;
      } catch {
        continue;
      }
      if (!t || t.source !== 'AI' || t.verdict !== 'CORRECT') continue;
      const answer = typeof t.answer === 'string' ? t.answer.trim() : '';
      const key = keyOf(answer);
      if (!key) continue;
      const id = `${questionId}|${key}`;
      const g = groups.get(id) ?? {
        questionId,
        quizId: s.quizId,
        key,
        spellings: new Map<string, number>(),
        learners: new Set<number>(),
        count: 0,
        lastAt: s.submittedAt,
        explanation: typeof t.explanation === 'string' ? t.explanation : null,
      };
      g.spellings.set(answer, (g.spellings.get(answer) ?? 0) + 1);
      g.learners.add(s.userId);
      g.count += 1;
      if (s.submittedAt > g.lastAt) g.lastAt = s.submittedAt;
      groups.set(id, g);
    }

    const questionIds = [
      ...new Set([...groups.values()].map((g) => g.questionId)),
    ];
    const questions = questionIds.length
      ? await this.prisma.question.findMany({
          where: { id: { in: questionIds } },
          select: {
            id: true,
            content: true,
            quiz: { select: { title: true } },
          },
        })
      : [];
    const byId = new Map(questions.map((q) => [q.id, q]));

    const rows: Row[] = [];
    for (const g of groups.values()) {
      const question = byId.get(g.questionId);
      const task = question ? translationTaskOf(question.content) : null;
      if (!question || !task) continue;
      const answer = [...g.spellings].sort((a, b) => b[1] - a[1])[0][0];
      // Accepted since, or dismissed: nothing left to decide.
      if (matchTranslation(answer, task.acceptedAnswers).kind !== 'NONE')
        continue;
      if (dismissedOf(question.content).includes(g.key)) continue;
      rows.push({
        questionId: g.questionId,
        quizId: g.quizId,
        quizTitle: question.quiz.title,
        prompt: task.prompt,
        answer,
        key: g.key,
        count: g.count,
        learners: g.learners.size,
        lastAt: g.lastAt,
        explanation: g.explanation,
        acceptedAnswers: task.acceptedAnswers,
      });
    }
    rows.sort(
      (a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime(),
    );
    const total = rows.length;
    return {
      data: rows.slice((page - 1) * limit, page * limit),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** Adds the learner's translation to the sentence's accepted answers. */
  async approve(questionId: number, raw: string) {
    const answer = cleanAnswer(raw);
    return this.prisma.$transaction(async (tx) => {
      const { content, task } = await this.load(tx, questionId);
      if (matchTranslation(answer, task.acceptedAnswers).kind !== 'NONE')
        throw new ConflictException('Câu này đã nằm trong đáp án.');
      if (task.acceptedAnswers.length >= MAX_ACCEPTED_ANSWERS)
        throw new ConflictException(
          `Câu này đã có ${MAX_ACCEPTED_ANSWERS} đáp án; hãy bớt bớt trong CMS trước.`,
        );
      const key = keyOf(answer);
      const next = {
        ...content,
        acceptedAnswers: [...task.acceptedAnswers, answer],
        dismissedAnswers: dismissedOf(content).filter((k) => k !== key),
      };
      const issues = translationTaskIssues(next);
      if (issues.length) throw new BadRequestException(issues.join('; '));
      await tx.question.update({
        where: { id: questionId },
        data: { content: next },
      });
      return { questionId, acceptedAnswers: next.acceptedAnswers };
    });
  }

  /** Hides the learner's translation from the queue for good. */
  async dismiss(questionId: number, raw: string) {
    const key = keyOf(cleanAnswer(raw));
    return this.prisma.$transaction(async (tx) => {
      const { content } = await this.load(tx, questionId);
      const dismissed = dismissedOf(content);
      if (!dismissed.includes(key)) {
        await tx.question.update({
          where: { id: questionId },
          data: {
            content: {
              ...content,
              dismissedAnswers: [...dismissed, key],
            },
          },
        });
      }
      return { questionId, dismissed: true };
    });
  }

  private async load(tx: Prisma.TransactionClient, questionId: number) {
    const question = await tx.question.findUnique({
      where: { id: questionId },
      select: { content: true },
    });
    const task = question ? translationTaskOf(question.content) : null;
    if (!question || !task)
      throw new NotFoundException('Không tìm thấy câu dịch này.');
    return { content: question.content as Record<string, unknown>, task };
  }
}

function cleanAnswer(raw: string) {
  const answer = typeof raw === 'string' ? raw.trim() : '';
  if (!keyOf(answer) || answer.length > SENTENCE_TRANSLATION_MAX_CHARS)
    throw new BadRequestException('Câu dịch không hợp lệ.');
  return answer;
}

function dismissedOf(content: unknown): string[] {
  const list = (content as { dismissedAnswers?: unknown } | null)
    ?.dismissedAnswers;
  return Array.isArray(list)
    ? list.filter((x): x is string => typeof x === 'string')
    : [];
}
