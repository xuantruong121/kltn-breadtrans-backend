import { QuizType } from '@prisma/client';
import {
  examWritingContent,
  examWritingProblem,
  examWritingSlot,
} from './exam-writing.logic';

describe('exam writing logic', () => {
  it('follows the TOEIC slot order', () => {
    expect(examWritingSlot(1)).toEqual({
      order: 1,
      taskKind: 'PICTURE_SENTENCE',
      quizType: QuizType.WRITING_PICTURE,
    });
    expect(examWritingSlot(7)?.taskKind).toBe('WRITTEN_REQUEST');
    expect(examWritingSlot(8)).toEqual({
      order: 8,
      taskKind: 'OPINION_ESSAY',
      quizType: QuizType.WRITING_EMAIL,
    });
  });

  it('has no ninth slot', () => {
    expect(examWritingSlot(9)).toBeNull();
    expect(examWritingSlot(0)).toBeNull();
  });

  it('writes the task type the readiness check expects', () => {
    expect(
      examWritingContent('OPINION_ESSAY', { title: 'T', prompt: ' Cũ ' }),
    ).toEqual({ prompt: 'Cũ', taskType: 'OPINION_ESSAY' });
  });

  it('keeps fields the form does not show', () => {
    expect(
      examWritingContent(
        'WRITTEN_REQUEST',
        { title: 'T', prompt: 'Mới', email: 'Thư mới' },
        { prompt: 'Cũ', email: 'Thư cũ', rubric: 'giữ' },
      ),
    ).toEqual({
      prompt: 'Mới',
      email: 'Thư mới',
      rubric: 'giữ',
      taskType: 'WRITTEN_REQUEST',
    });
  });

  it('removes an emptied field and trims keywords', () => {
    expect(
      examWritingContent(
        'PICTURE_SENTENCE',
        { title: 'T', prompt: 'P', imageUrl: ' ', keywords: [' a ', '', 'b'] },
        { imageUrl: 'old.png' },
      ),
    ).toEqual({
      prompt: 'P',
      taskType: 'PICTURE_SENTENCE',
      keywords: ['a', 'b'],
    });
  });

  it('asks a picture task for its image and two keywords', () => {
    const input = { title: 'T', prompt: 'P' };
    expect(examWritingProblem('PICTURE_SENTENCE', input)).toContain('ảnh');
    expect(
      examWritingProblem('PICTURE_SENTENCE', {
        ...input,
        imageUrl: 'a.png',
        keywords: ['một'],
      }),
    ).toContain('từ khoá');
    expect(
      examWritingProblem('PICTURE_SENTENCE', {
        ...input,
        imageUrl: 'a.png',
        keywords: ['một', 'hai'],
      }),
    ).toBeNull();
  });

  it('needs a title and a prompt on every task', () => {
    expect(
      examWritingProblem('OPINION_ESSAY', { title: ' ', prompt: 'P' }),
    ).toContain('tiêu đề');
    expect(
      examWritingProblem('OPINION_ESSAY', { title: 'T', prompt: ' ' }),
    ).toContain('đề bài');
  });
});
