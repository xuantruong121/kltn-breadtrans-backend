import { BadRequestException } from '@nestjs/common';
import {
  resolveReadingCorrectOption,
  resolveReadingMicroSkillForAuthoring,
  validateReadingQuestionContent,
} from './reading-content.validation';

describe('Reading content validation', () => {
  it('resolves correctIndex and legacy fallback', () => {
    expect(
      resolveReadingCorrectOption({ options: ['A', 'B'], correctIndex: 1 }),
    ).toEqual({
      status: 'available',
      answer: 'B',
      index: 1,
    });
    expect(resolveReadingCorrectOption({ correct: 'B' })).toEqual({
      status: 'available',
      answer: 'B',
      index: -1,
    });
  });

  it.each([
    { options: ['A'], correctIndex: 1 },
    { options: ['A', 'B'], correctIndex: 0.5 },
    { options: ['A', ''], correctIndex: 0 },
  ])('rejects unsafe answer structures', (content) => {
    expect(() => validateReadingQuestionContent(content, 'DRAFT')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a canonical/legacy conflict and broad micro-skill', () => {
    expect(() =>
      validateReadingQuestionContent(
        {
          text: 'Question',
          passage: 'Passage.',
          options: ['A', 'B'],
          correctIndex: 0,
          correct: 'B',
          skill: 'READING',
          questionType: 'DETAIL',
        },
        'PUBLISHED',
      ),
    ).toThrow(BadRequestException);
    expect(
      resolveReadingMicroSkillForAuthoring({ questionType: 'READING' }),
    ).toBeNull();
  });

  it('accepts a valid published Reading question', () => {
    expect(() =>
      validateReadingQuestionContent(
        {
          text: 'What is the purpose?',
          passage: 'The notice explains the schedule.',
          options: ['To explain the schedule', 'To sell tickets'],
          correctIndex: 0,
          skill: 'READING',
          questionType: 'PURPOSE',
          explanation: 'The passage states the schedule.',
        },
        'PUBLISHED',
      ),
    ).not.toThrow();
  });
});
