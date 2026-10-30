import {
  isWritingQuizType,
  learnerVisibleTaskContent,
} from './writing-task-visibility';

describe('Writing learner-visible content contract', () => {
  const email = {
    skill: 'WRITING',
    level: 'A2',
    taskType: 'SHORT_MESSAGE',
    prompt: 'Viết 40–60 từ.',
    wordRange: [40, 60],
    requirements: ['apologize', 'give a reason'],
    rubric: { grammar: 2, vocabulary: 2, organization: 2, taskAchievement: 4 },
    sampleResponse: 'Hi Lan, I am sorry...',
  };
  const picture = {
    skill: 'WRITING',
    taskType: 'PICTURE_SENTENCE',
    prompt: 'Viết một câu.',
    imageUrl: 'https://example.test/a.png',
    requiredKeywords: ['cashier', 'scan'],
    requireLinking: true,
    wordRange: [1, 40],
    sampleResponse: 'The cashier is scanning...',
    sceneDescription: 'At a supermarket checkout...',
  };

  it('keeps everything a learner needs to answer', () => {
    expect(learnerVisibleTaskContent(email)).toEqual({
      skill: 'WRITING',
      level: 'A2',
      taskType: 'SHORT_MESSAGE',
      prompt: 'Viết 40–60 từ.',
      wordRange: [40, 60],
      requirements: ['apologize', 'give a reason'],
      rubric: {
        grammar: 2,
        vocabulary: 2,
        organization: 2,
        taskAchievement: 4,
      },
    });
    expect(learnerVisibleTaskContent(picture)).toMatchObject({
      prompt: 'Viết một câu.',
      imageUrl: 'https://example.test/a.png',
      requiredKeywords: ['cashier', 'scan'],
      requireLinking: true,
    });
  });

  it('drops the reference answer, the picture description and any unlisted field', () => {
    for (const content of [
      email,
      picture,
      { ...email, modelAnswer: 'x', graderNotes: { answer: 'y' } },
    ]) {
      const text = JSON.stringify(learnerVisibleTaskContent(content));
      expect(text).not.toMatch(
        /sampleResponse|sceneDescription|modelAnswer|graderNotes|I am sorry|scanning|supermarket/,
      );
    }
  });

  it('passes through non-object content and recognises Writing quiz types', () => {
    expect(learnerVisibleTaskContent(null)).toBeNull();
    expect(isWritingQuizType('WRITING_EMAIL')).toBe(true);
    expect(isWritingQuizType('WRITING_PICTURE')).toBe(true);
    expect(isWritingQuizType('LISTENING_PRACTICE')).toBe(false);
  });
});
