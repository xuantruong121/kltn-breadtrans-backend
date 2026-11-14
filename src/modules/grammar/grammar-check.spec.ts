import { NotFoundException } from '@nestjs/common';
import { QuizPublicationStatus } from '@prisma/client';
import { GrammarService } from './grammar.service';
import { gradeGrammarQuestion } from './grammar-question.logic';

// Owner 2026-11-13: a grammar question shows its result as soon as an option
// is chosen. The check stores nothing; the attempt still does.
const question = {
  id: 7,
  topicId: 3,
  correctIndex: 3,
  explanation: 'Danh từ không đếm được không có dạng số nhiều.',
  optionExplanations: [null, 'Sai vì thêm -s.', null, null],
  topic: { publicationStatus: QuizPublicationStatus.PUBLISHED },
};

function setup(found: unknown) {
  const prisma = {
    grammarQuestion: { findFirst: jest.fn().mockResolvedValue(found) },
    grammarAttempt: { create: jest.fn() },
  };
  const service = new GrammarService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

describe('grammar per-question check', () => {
  it('a wrong pick returns the key, the explanation and why that option is wrong', async () => {
    const { service, prisma } = setup(question);
    await expect(service.checkAnswer(3, 7, 1)).resolves.toEqual({
      questionId: 7,
      selectedOption: 1,
      correctOption: 3,
      isCorrect: false,
      explanation: 'Danh từ không đếm được không có dạng số nhiều.',
      optionExplanations: [null, 'Sai vì thêm -s.', null, null],
    });
    expect(prisma.grammarQuestion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, topicId: 3 } }),
    );
    expect(prisma.grammarAttempt.create).not.toHaveBeenCalled();
  });

  it('a question outside the topic is not found', async () => {
    const { service } = setup(null);
    await expect(service.checkAnswer(3, 99, 0)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('a draft topic is not found for a learner, but is for an admin', async () => {
    const draft = {
      ...question,
      topic: { publicationStatus: QuizPublicationStatus.DRAFT },
    };
    await expect(
      setup(draft).service.checkAnswer(3, 7, 3),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup(draft).service.checkAnswer(3, 7, 3, true),
    ).resolves.toMatchObject({ isCorrect: true });
  });

  it('the check and the attempt grade a question the same way', () => {
    expect(gradeGrammarQuestion(question, 3)).toMatchObject({
      isCorrect: true,
      correctOption: 3,
    });
    expect(gradeGrammarQuestion(question, undefined)).toMatchObject({
      isCorrect: false,
      selectedOption: undefined,
    });
    expect(
      gradeGrammarQuestion({ ...question, optionExplanations: null }, 0)
        .optionExplanations,
    ).toBeNull();
  });
});
