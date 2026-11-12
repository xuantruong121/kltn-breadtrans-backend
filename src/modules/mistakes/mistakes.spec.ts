import { BadRequestException, NotFoundException } from '@nestjs/common';

import {
  RESOLVE_AFTER_CORRECT,
  applyObservation,
  grammarObservations,
  quizObservations,
  reviewQuestion,
  speakingObservations,
  topMistakeTags,
  writingObservations,
  type MistakeDetail,
  type MistakeObservation,
} from './mistake-extract.logic';
import { MistakesService } from './mistakes.service';

const at = new Date('2026-11-11T02:00:00Z');

describe('mistake-extract.logic', () => {
  it('reads a reading submission: wrong answers with a snapshot, right answers as such', () => {
    const obs = quizObservations({
      id: 9,
      submittedAt: at,
      quiz: { id: 3, type: 'BILINGUAL_READING', title: 'Notices' },
      questions: [
        {
          id: 31,
          type: 'MULTIPLE_CHOICE',
          content: {
            text: 'Why will the library close early?',
            passage: 'NOTICE: The library will close at 5 P.M.',
            options: ['For a holiday', 'For maintenance'],
            correctIndex: 1,
            explanation: 'The notice says maintenance.',
            questionType: 'detail',
          },
        },
        { id: 32, type: 'MULTIPLE_CHOICE', content: { options: ['a', 'b'] } },
        { id: 33, type: 'MULTIPLE_CHOICE', content: {} },
      ],
      results: [
        { questionId: 31, answer: 'For a holiday', isCorrect: false },
        { questionId: 32, answer: 'a', isCorrect: true },
        // Not graded: says nothing.
        { questionId: 33, answer: 'x', isCorrect: null },
      ],
    });
    expect(obs).toHaveLength(2);
    expect(obs[0]).toMatchObject({
      sourceType: 'QUIZ_QUESTION',
      itemKey: '31',
      skill: 'READING',
      tag: 'DETAIL',
      outcome: 'WRONG',
      detail: {
        kind: 'CHOICE',
        title: 'Notices',
        selectedIndex: 0,
        correctIndex: 1,
        passageKind: 'PASSAGE',
        answerable: true,
        ref: { quizId: 3, submissionId: 9, questionId: 31 },
      },
    });
    expect(obs[1]).toMatchObject({ itemKey: '32', outcome: 'CORRECT' });
  });

  it('keeps a listening item out of the in-notebook review, and a dictation line too', () => {
    const obs = quizObservations({
      id: 9,
      submittedAt: at,
      quiz: { id: 4, type: 'LISTENING_PRACTICE', title: 'At the store' },
      questions: [
        {
          id: 41,
          type: 'MULTIPLE_CHOICE',
          content: {
            text: 'Where is the milk?',
            audioText: 'The milk is in aisle 4.',
            options: ['Aisle 3', 'Aisle 4'],
            correctIndex: 1,
          },
        },
        {
          id: 42,
          type: 'DICTATION',
          content: { correctAnswer: 'I usually get up at six.' },
        },
      ],
      results: [
        { questionId: 41, answer: { selectedIndex: 0 }, isCorrect: false },
        { questionId: 42, answer: 'I usualy get up', isCorrect: false },
      ],
    });
    expect(obs[0].detail).toMatchObject({
      passageKind: 'TRANSCRIPT',
      selectedIndex: 0,
      answerable: false,
    });
    expect(obs[1].detail).toMatchObject({
      kind: 'DICTATION',
      yourAnswer: 'I usualy get up',
      correctAnswer: 'I usually get up at six.',
      answerable: false,
    });
    expect(
      quizObservations({
        id: 1,
        submittedAt: at,
        quiz: { id: 5, type: 'WRITING_EMAIL', title: 'x' },
        questions: [],
        results: [],
      }),
    ).toEqual([]);
  });

  it('reads a grammar attempt with its topic as the tag', () => {
    const obs = grammarObservations({
      id: 4,
      createdAt: at,
      topic: { id: 2, title: 'Giới từ' },
      answers: { '31': 0, '32': 1 },
      questions: [
        {
          id: 31,
          question: 'q1',
          options: ['a', 'b'],
          correctIndex: 1,
          explanation: 'e',
        },
        {
          id: 32,
          question: 'q2',
          options: ['a', 'b'],
          correctIndex: 1,
          explanation: null,
        },
        // Not answered.
        {
          id: 33,
          question: 'q3',
          options: ['a', 'b'],
          correctIndex: 0,
          explanation: null,
        },
      ],
    });
    expect(obs.map((o) => [o.itemKey, o.outcome])).toEqual([
      ['31', 'WRONG'],
      ['32', 'CORRECT'],
    ]);
    expect(obs[0]).toMatchObject({ skill: 'GRAMMAR', tag: 'Giới từ' });
  });

  it('reads writing corrections, one item per distinct slip', () => {
    const feedback = JSON.stringify({
      rubricVersion: 'PRACTICE_WRITING_V1',
      corrections: [
        { original: 'She ask', corrected: 'She asks', explanation: 'Số ít.' },
        { original: 'she  ASK', corrected: 'she asks', explanation: 'x' },
        { original: '', corrected: 'x' },
      ],
    });
    const base = { id: 12, submittedAt: at, aiFeedback: feedback };
    const obs = writingObservations({
      ...base,
      quiz: { id: 17, type: 'WRITING_EMAIL', title: 'Email' },
    });
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      sourceType: 'WRITING_CORRECTION',
      itemKey: 'she ask→she asks',
      skill: 'WRITING',
      detail: {
        kind: 'CORRECTION',
        yourAnswer: 'She ask',
        correctAnswer: 'She asks',
        answerable: false,
        ref: { submissionId: 12 },
      },
    });
    // An exam-style grade has no corrections list; a reading quiz is not writing.
    expect(
      writingObservations({
        ...base,
        aiFeedback: JSON.stringify({ score: 3, feedback: 'x' }),
        quiz: { id: 17, type: 'WRITING_EMAIL', title: 'Email' },
      }),
    ).toEqual([]);
    expect(
      writingObservations({
        ...base,
        quiz: { id: 3, type: 'BILINGUAL_READING', title: 'R' },
      }),
    ).toEqual([]);
  });

  it('reads weak and well-said words of a recording', () => {
    const obs = speakingObservations({
      id: 5,
      exerciseId: 8,
      exerciseTitle: 'Giờ mở cửa',
      submittedAt: at,
      aiFeedback: {
        words: [
          { word: 'The', accuracyScore: 85 },
          { word: 'library', accuracyScore: 53 },
          { word: 'Library,', accuracyScore: 40 },
          { word: 'opens', accuracyScore: 70 },
          { word: 'a', accuracyScore: 10 },
        ],
      },
    });
    expect(obs).toHaveLength(2);
    expect(obs[0]).toMatchObject({
      sourceType: 'SPEAKING_WORD',
      itemKey: 'library',
      outcome: 'WRONG',
      detail: { kind: 'WORD', score: 40, ref: { exerciseId: 8 } },
    });
    expect(obs[1]).toMatchObject({ itemKey: 'the', outcome: 'CORRECT' });
    expect(
      speakingObservations({
        id: 5,
        exerciseId: 8,
        exerciseTitle: 'x',
        submittedAt: at,
        aiFeedback: null,
      }),
    ).toEqual([]);
  });

  const detail: MistakeDetail = {
    kind: 'CHOICE',
    title: 't',
    question: 'q',
    passage: 'p',
    passageKind: 'PASSAGE',
    options: ['a', 'b'],
    selectedIndex: 0,
    correctIndex: 1,
    explanation: 'because',
    answerable: true,
    ref: { questionId: 1 },
  };
  const wrong: MistakeObservation = {
    sourceType: 'GRAMMAR_QUESTION',
    itemKey: '1',
    skill: 'GRAMMAR',
    tag: 'Giới từ',
    outcome: 'WRONG',
    at,
    detail,
  };
  const right: MistakeObservation = {
    ...wrong,
    outcome: 'CORRECT',
    detail: undefined,
  };

  it(`opens a mistake on a wrong answer and closes it after ${RESOLVE_AFTER_CORRECT} right answers in a row`, () => {
    expect(applyObservation(null, right)).toBeNull();
    let state = applyObservation(null, wrong)!;
    expect(state).toMatchObject({
      wrongCount: 1,
      correctStreak: 0,
      resolvedAt: null,
    });
    state = applyObservation(state, right)!;
    expect(state).toMatchObject({ correctStreak: 1, resolvedAt: null });
    // A wrong answer in between starts the count again.
    state = applyObservation(state, wrong)!;
    expect(state).toMatchObject({ wrongCount: 2, correctStreak: 0 });
    state = applyObservation(applyObservation(state, right), right)!;
    expect(state.resolvedAt).toEqual(at);
    // Wrong again later: the mistake is open again.
    state = applyObservation(state, wrong)!;
    expect(state).toMatchObject({ wrongCount: 3, resolvedAt: null });
  });

  it('shows a review question without the key, the explanation or the earlier choice', () => {
    const q = reviewQuestion(5, 'GRAMMAR', detail);
    expect(q).toEqual({
      id: 5,
      skill: 'GRAMMAR',
      title: 't',
      quizId: null,
      topicId: null,
      question: 'q',
      passage: 'p',
      options: ['a', 'b'],
    });
    expect(
      reviewQuestion(5, 'LISTENING', { ...detail, passageKind: 'TRANSCRIPT' })
        .passage,
    ).toBeNull();
    // The ids of the source travel, for its Vietnamese title.
    expect(
      reviewQuestion(5, 'READING', {
        ...detail,
        ref: { quizId: 2, questionId: 7 },
      }),
    ).toMatchObject({ quizId: 2, topicId: null });
  });

  it('names the tags a learner gets wrong most', () => {
    expect(
      topMistakeTags([
        { skill: 'GRAMMAR', tag: 'Giới từ', wrongCount: 1 },
        { skill: 'LISTENING', tag: 'Hội thoại ngắn', wrongCount: 4 },
        { skill: 'GRAMMAR', tag: 'Giới từ', wrongCount: 2 },
        { skill: 'READING', tag: 'DETAIL', wrongCount: 1 },
        { skill: 'READING', tag: 'INFERENCE', wrongCount: 1 },
        { skill: 'WRITING', tag: null, wrongCount: 9 },
      ]),
    ).toEqual(['Nghe: Hội thoại ngắn', 'Ngữ pháp: Giới từ', 'Đọc: chi tiết']);
  });
});

describe('MistakesService', () => {
  const detail = {
    kind: 'CHOICE',
    title: 't',
    options: ['a', 'b'],
    correctIndex: 1,
    explanation: 'because',
    answerable: true,
    ref: {},
  };
  function setup(row: Record<string, unknown> | null) {
    const prisma = {
      learnerMistake: {
        findFirst: jest.fn().mockResolvedValue(row),
        update: jest.fn(),
      },
    };
    return { prisma, service: new MistakesService(prisma as any) };
  }
  const open = {
    id: 5,
    userId: 10,
    wrongCount: 1,
    correctStreak: 0,
    resolvedAt: null,
    detail,
  };

  it('answers "not found" for a mistake of another learner', async () => {
    const { service, prisma } = setup(null);
    await expect(service.answer(10, 5, 1)).rejects.toThrow(NotFoundException);
    // A row of a skill the notebook no longer has (TOEIC) is not found either.
    expect(prisma.learnerMistake.findFirst).toHaveBeenCalledWith({
      where: {
        id: 5,
        userId: 10,
        skill: {
          in: ['LISTENING', 'SPEAKING', 'READING', 'WRITING', 'GRAMMAR'],
        },
      },
    });
  });

  it('a right answer counts toward closing, and the second one closes', async () => {
    const first = setup(open);
    expect(await first.service.answer(10, 5, 1)).toMatchObject({
      correct: true,
      correctIndex: 1,
      explanation: 'because',
      correctStreak: 1,
      resolved: false,
    });
    const second = setup({ ...open, correctStreak: 1 });
    expect(await second.service.answer(10, 5, 1)).toMatchObject({
      correctStreak: 2,
      resolved: true,
    });
    expect(second.prisma.learnerMistake.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          correctStreak: 2,
          resolvedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('a wrong answer starts the count again', async () => {
    const { service, prisma } = setup({ ...open, correctStreak: 1 });
    expect(await service.answer(10, 5, 0)).toMatchObject({
      correct: false,
      correctStreak: 0,
      resolved: false,
    });
    expect(prisma.learnerMistake.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ wrongCount: 2, correctStreak: 0 }),
      }),
    );
  });

  it('refuses an answer for an item that is not a choice, or an index outside the options', async () => {
    await expect(
      setup({
        ...open,
        detail: { ...detail, answerable: false },
      }).service.answer(10, 5, 1),
    ).rejects.toThrow(BadRequestException);
    await expect(setup(open).service.answer(10, 5, 7)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lets the learner close a mistake and open it again', async () => {
    const { service, prisma } = setup(open);
    await service.setResolved(10, 5, true);
    expect(prisma.learnerMistake.update).toHaveBeenLastCalledWith({
      where: { id: 5 },
      data: { resolvedAt: expect.any(Date) },
    });
    await service.setResolved(10, 5, false);
    expect(prisma.learnerMistake.update).toHaveBeenLastCalledWith({
      where: { id: 5 },
      data: { resolvedAt: null, correctStreak: 0 },
    });
  });

  it('reads each attempt once: a second pass on the same marker stores nothing', async () => {
    const tx = {
      learnerMistakeIngest: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      learnerMistake: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    const none = { findMany: jest.fn().mockResolvedValue([]) };
    // TOEIC exam attempts are not part of the notebook: never read.
    const toeicAttempt = { findMany: jest.fn(), findUnique: jest.fn() };
    const prisma = {
      submission: none,
      toeicAttempt,
      speakingSubmission: none,
      grammarAttempt: {
        findMany: jest.fn().mockResolvedValue([{ id: 4 }]),
        findUnique: jest.fn().mockResolvedValue({
          id: 4,
          createdAt: at,
          answers: { '31': 0 },
          topic: {
            id: 2,
            title: 'Giới từ',
            questions: [
              {
                id: 31,
                question: 'q',
                options: ['a', 'b'],
                correctIndex: 1,
                explanation: null,
              },
            ],
          },
        }),
      },
      learnerMistakeIngest: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const service = new MistakesService(prisma as any);
    await service.sync(10);
    expect(tx.learnerMistakeIngest.createMany).toHaveBeenCalledWith({
      data: [{ userId: 10, kind: 'GRAMMAR_ATTEMPT', sourceId: 4 }],
      skipDuplicates: true,
    });
    expect(tx.learnerMistake.upsert).not.toHaveBeenCalled();

    // The marker is new: the wrong answer is stored.
    tx.learnerMistakeIngest.createMany.mockResolvedValue({ count: 1 });
    tx.learnerMistake.findUnique.mockResolvedValue(null);
    await service.sync(10);
    expect(tx.learnerMistake.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: 10,
          sourceType: 'GRAMMAR_QUESTION',
          itemKey: '31',
          skill: 'GRAMMAR',
          tag: 'Giới từ',
          wrongCount: 1,
        }),
      }),
    );

    // An attempt already marked is not read at all.
    prisma.learnerMistakeIngest.findMany.mockResolvedValue([
      { kind: 'GRAMMAR_ATTEMPT', sourceId: 4 },
    ]);
    prisma.grammarAttempt.findUnique.mockClear();
    await service.sync(10);
    expect(prisma.grammarAttempt.findUnique).not.toHaveBeenCalled();
    expect(toeicAttempt.findMany).not.toHaveBeenCalled();
    expect(toeicAttempt.findUnique).not.toHaveBeenCalled();
  });

  describe('which quiz submissions are read', () => {
    const at = new Date('2026-11-12T10:02:56Z');
    function run(quiz: Record<string, unknown>) {
      const tx = {
        learnerMistakeIngest: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        learnerMistake: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn(),
        },
      };
      const none = { findMany: jest.fn().mockResolvedValue([]) };
      const prisma = {
        submission: {
          findMany: jest.fn().mockResolvedValue([{ id: 204 }]),
          findUnique: jest.fn().mockResolvedValue({
            id: 204,
            submittedAt: at,
            aiFeedback: null,
            quiz: {
              id: 12,
              title: 'Listening B2',
              toeicWritingSetItems: [],
              questions: [
                {
                  id: 51,
                  type: 'MULTIPLE_CHOICE',
                  content: {
                    text: 'What will the speaker probably do?',
                    options: ['Change the client', 'Postpone the presentation'],
                    correctIndex: 1,
                  },
                },
              ],
              ...quiz,
            },
            results: [
              { questionId: 51, answer: 'Change the client', isCorrect: false },
            ],
          }),
        },
        grammarAttempt: none,
        speakingSubmission: none,
        learnerMistakeIngest: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      };
      return { tx, service: new MistakesService(prisma as any) };
    }

    it('a listening quiz without a practice topic is read (owner 2026-11-12)', async () => {
      const { tx, service } = run({
        type: 'LISTENING_PRACTICE',
        practiceTopicId: null,
      });
      await service.sync(19);
      expect(tx.learnerMistakeIngest.createMany).toHaveBeenCalledWith({
        data: [{ userId: 19, kind: 'SUBMISSION', sourceId: 204 }],
        skipDuplicates: true,
      });
      expect(tx.learnerMistake.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 19,
            skill: 'LISTENING',
            itemKey: '51',
          }),
        }),
      );
    });

    it('an exam Writing task stays out: no topic, or inside a TOEIC writing set', async () => {
      for (const quiz of [
        { type: 'WRITING_PICTURE', practiceTopicId: null },
        {
          type: 'WRITING_EMAIL',
          practiceTopicId: 3,
          toeicWritingSetItems: [{ id: 1 }],
        },
      ]) {
        const { tx, service } = run(quiz);
        await service.sync(19);
        expect(tx.learnerMistakeIngest.createMany).toHaveBeenCalled();
        expect(tx.learnerMistake.upsert).not.toHaveBeenCalled();
      }
    });
  });
});
