import {
  grammarItemContext,
  parseTutorContextRef,
  quizItemContext,
  toeicItemContext,
} from './tutor-context.logic';
import { TutorContextService } from './tutor-context.service';

describe('tutor-context.logic', () => {
  it('describes a TOEIC reading item: passage, choices, the choice made, the key', () => {
    const ctx = toeicItemContext({
      part: 5,
      questionNumber: 101,
      text: 'She is good ___ math.',
      options: ['at', 'in', 'on', 'for'],
      correctIndex: 0,
      explanation: '"good at" đi với danh từ chỉ lĩnh vực.',
      passageText: null,
      transcriptText: 'ignored for reading',
      selectedIndex: 1,
    });
    expect(ctx.label).toBe('Câu 101, Part 5, đề luyện TOEIC đã nộp');
    expect(ctx.lines).toEqual([
      'Câu hỏi: She is good ___ math.',
      'Các lựa chọn: A. at | B. in | C. on | D. for',
      'Người học chọn: B. in',
      'Đáp án đúng: A. at',
      'Kết quả: sai',
      'Lời giải của đề: "good at" đi với danh từ chỉ lĩnh vực.',
    ]);
  });

  it('uses the transcript for a listening part and says when nothing was chosen', () => {
    const ctx = toeicItemContext({
      part: 2,
      questionNumber: 9,
      text: null,
      options: ['Yes, I did.', 'At noon.', 'By bus.'],
      correctIndex: 2,
      transcriptText: 'How do you get to work?',
      passageText: 'ignored for listening',
      selectedIndex: null,
    });
    expect(ctx.lines[0]).toBe('Lời thoại: How do you get to work?');
    expect(ctx.lines).toContain('Người học chọn: bỏ trống');
    expect(ctx.lines).not.toContain('Kết quả: sai');
  });

  it('describes a grammar item with its topic', () => {
    const ctx = grammarItemContext({
      topicTitle: 'Thì hiện tại hoàn thành',
      position: 3,
      question: 'I ___ here since 2020.',
      options: ['live', 'have lived', 'lived', 'am living'],
      correctIndex: 1,
      selectedIndex: 1,
    });
    expect(ctx.label).toBe('Câu 3, bài ngữ pháp "Thì hiện tại hoàn thành"');
    expect(ctx.lines).toContain('Kết quả: đúng');
  });

  it('describes a writing task with the essay and the stored feedback', () => {
    const ctx = quizItemContext({
      quizType: 'WRITING_EMAIL',
      quizTitle: 'Xin nghỉ phép',
      position: 1,
      questionType: 'WRITING',
      content: { prompt: 'Write an email asking for a day off.' },
      answer: 'Dear manager, I want a day off.',
      feedback: 'Thiếu lời chào kết thư.',
    });
    expect(ctx.label).toBe('Câu 1, bài luyện viết "Xin nghỉ phép"');
    expect(ctx.lines).toEqual([
      'Đề bài: Write an email asking for a day off.',
      'Bài viết của người học: Dear manager, I want a day off.',
      'Nhận xét đã chấm: Thiếu lời chào kết thư.',
    ]);
  });

  it('describes a dictation line and a listening choice', () => {
    const dictation = quizItemContext({
      quizType: 'LISTENING_PRACTICE',
      position: 2,
      questionType: 'DICTATION',
      content: {
        correctAnswer: 'I usually get up at six.',
        translation: 'Tôi thường dậy lúc sáu giờ.',
      },
      answer: 'I usualy get up at six',
      isCorrect: false,
    });
    expect(dictation.lines).toEqual([
      'Câu cần chép: I usually get up at six.',
      'Người học chép: I usualy get up at six',
      'Kết quả: sai',
      'Nghĩa: Tôi thường dậy lúc sáu giờ.',
    ]);
    const choice = quizItemContext({
      quizType: 'LISTENING_PRACTICE',
      position: 4,
      questionType: 'MULTIPLE_CHOICE',
      content: {
        audioText: 'The train leaves at nine.',
        text: 'When does the train leave?',
        options: ['At eight', 'At nine'],
        correctIndex: 1,
      },
      answer: { selectedIndex: 0 },
    });
    expect(choice.lines[0]).toBe('Lời thoại: The train leaves at nine.');
    expect(choice.lines).toContain('Người học chọn: A. At eight');
  });

  it('cuts a long passage', () => {
    const ctx = toeicItemContext({
      part: 7,
      questionNumber: 150,
      text: 'q',
      options: ['a', 'b'],
      correctIndex: 0,
      passageText: 'x'.repeat(5000),
      selectedIndex: 0,
    });
    expect(ctx.lines[0].length).toBeLessThan(1300);
  });

  it('accepts only a known source with a positive id', () => {
    expect(
      parseTutorContextRef({
        sourceType: 'TOEIC_ATTEMPT',
        sourceId: '12',
        questionId: 7,
      }),
    ).toEqual({
      sourceType: 'TOEIC_ATTEMPT',
      sourceId: 12,
      questionId: 7,
    });
    expect(
      parseTutorContextRef({ sourceType: 'QUIZ_SUBMISSION', sourceId: 3 }),
    ).toEqual({
      sourceType: 'QUIZ_SUBMISSION',
      sourceId: 3,
    });
    expect(
      parseTutorContextRef({ sourceType: 'USER', sourceId: 1 }),
    ).toBeNull();
    expect(
      parseTutorContextRef({ sourceType: 'TOEIC_ATTEMPT', sourceId: -1 }),
    ).toBeNull();
    expect(parseTutorContextRef('TOEIC_ATTEMPT')).toBeNull();
    expect(parseTutorContextRef(undefined)).toBeNull();
  });
});

describe('TutorContextService', () => {
  const prisma = {
    toeicAttempt: { findFirst: jest.fn() },
    toeicQuestion: { findFirst: jest.fn() },
    toeicAttemptAnswer: { findUnique: jest.fn() },
    grammarAttempt: { findFirst: jest.fn() },
    submission: { findFirst: jest.fn() },
  };
  const service = new TutorContextService(prisma as any);
  const question = {
    id: 7,
    questionNumber: 101,
    text: 'She is good ___ math.',
    options: ['at', 'in'],
    correctIndex: 0,
    explanation: null,
    group: { part: 5, passageText: null, transcriptText: null },
  };

  beforeEach(() => jest.resetAllMocks());

  it('reads a TOEIC item only from the learner own submitted attempt', async () => {
    prisma.toeicAttempt.findFirst.mockResolvedValue({ examId: 3 });
    prisma.toeicQuestion.findFirst.mockResolvedValue(question);
    prisma.toeicAttemptAnswer.findUnique.mockResolvedValue({
      selectedIndex: 1,
    });

    const ctx = await service.load(10, {
      sourceType: 'TOEIC_ATTEMPT',
      sourceId: 55,
      questionId: 7,
    });

    expect(prisma.toeicAttempt.findFirst).toHaveBeenCalledWith({
      where: { id: 55, userId: 10, status: 'SUBMITTED' },
      select: { examId: true },
    });
    expect(prisma.toeicQuestion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, group: { examId: 3 } } }),
    );
    expect(ctx?.lines).toContain('Đáp án đúng: A. at');
  });

  it('gives nothing, and reads no question, for an attempt that is not submitted or not the learner own', async () => {
    prisma.toeicAttempt.findFirst.mockResolvedValue(null);

    const ctx = await service.load(10, {
      sourceType: 'TOEIC_ATTEMPT',
      sourceId: 55,
      questionId: 7,
    });

    expect(ctx).toBeNull();
    expect(prisma.toeicQuestion.findFirst).not.toHaveBeenCalled();
  });

  it('gives nothing for a question of another exam', async () => {
    prisma.toeicAttempt.findFirst.mockResolvedValue({ examId: 3 });
    prisma.toeicQuestion.findFirst.mockResolvedValue(null);

    expect(
      await service.load(10, {
        sourceType: 'TOEIC_ATTEMPT',
        sourceId: 55,
        questionId: 999,
      }),
    ).toBeNull();
  });

  it('reads a practice item only from the learner own graded submission', async () => {
    prisma.submission.findFirst.mockResolvedValue({
      aiFeedback: null,
      results: [
        { questionId: 21, answer: { selectedIndex: 0 }, isCorrect: false },
      ],
      quiz: {
        type: 'BILINGUAL_READING',
        title: 'Office memo',
        questions: [
          { id: 20, type: 'MULTIPLE_CHOICE', content: {} },
          {
            id: 21,
            type: 'MULTIPLE_CHOICE',
            content: {
              text: 'Who wrote it?',
              options: ['HR', 'IT'],
              correctIndex: 1,
            },
          },
        ],
      },
    });

    const ctx = await service.load(10, {
      sourceType: 'QUIZ_SUBMISSION',
      sourceId: 8,
      questionId: 21,
    });

    expect(prisma.submission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 8, userId: 10, score: { not: null } },
      }),
    );
    expect(ctx?.label).toBe('Câu 2, bài luyện đọc "Office memo"');
    expect(ctx?.lines).toContain('Đáp án đúng: B. IT');
  });

  it('reads a grammar item from the learner own attempt', async () => {
    prisma.grammarAttempt.findFirst.mockResolvedValue({
      answers: { '31': 2 },
      topic: {
        title: 'Giới từ',
        questions: [
          {
            id: 31,
            question: 'q?',
            options: ['a', 'b', 'c'],
            correctIndex: 2,
            explanation: null,
          },
        ],
      },
    });

    const ctx = await service.load(10, {
      sourceType: 'GRAMMAR_ATTEMPT',
      sourceId: 4,
      questionId: 31,
    });

    expect(prisma.grammarAttempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 4, userId: 10 } }),
    );
    expect(ctx?.lines).toContain('Kết quả: đúng');
  });

  it('turns a database error into no context', async () => {
    prisma.submission.findFirst.mockRejectedValue(new Error('db down'));
    expect(
      await service.load(10, { sourceType: 'QUIZ_SUBMISSION', sourceId: 8 }),
    ).toBeNull();
  });
});
