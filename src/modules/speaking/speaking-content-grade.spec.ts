import type { PronunciationFeedback } from '../ai/strategies/ai-evaluator.interface';
import {
  buildSpeakingContentRequest,
  combineSpeakingScores,
  gradeFreeAnswerContent,
  parseSpeakingContentGrade,
} from './speaking-content-grade';

// Owner 2026-11-13: "Where do we meet the tour guide?" answered with
// something else scored 6.9 on pronunciation alone.
const task = {
  taskType: 'RESPOND_TO_QUESTION',
  targetText: 'Where do we meet the tour guide?',
};
const pronunciation: PronunciationFeedback = {
  overallScore: 6.9,
  clarity: 'Good',
  feedback: 'Điểm phát âm: 6.9/10.',
  problematicWords: [],
  suggestions: ['Nhấn rõ âm cuối.'],
  accuracyScore: 67,
  fluencyScore: 70,
  transcript: 'I like to eat pizza with my friends on Sunday.',
};
const reply = (o: Record<string, unknown>) => () =>
  Promise.resolve({ text: JSON.stringify(o) });

describe('free speaking answer content', () => {
  it('an off-topic answer totals at most 3 and says why', async () => {
    const fb = await gradeFreeAnswerContent(
      reply({
        taskRelevance: 'OFF_TOPIC',
        contentScore: 6,
        comment:
          'Câu trả lời nói về sở thích ăn uống, chưa nói nơi gặp hướng dẫn viên.',
      }),
      task,
      pronunciation,
    );
    expect(fb.overallScore).toBe(3);
    expect(fb.pronunciationScore).toBe(6.9);
    expect(fb.contentScore).toBe(2);
    expect(fb.contentRelevance).toBe('OFF_TOPIC');
    expect(fb.feedback).toMatch(/tối đa 3/);
    expect(fb.suggestions[0]).toMatch(/trả lời đúng điều được hỏi/);
    expect(fb.clarity).toBe('Poor');
  });

  it('an answer on the task totals the mean of pronunciation and content', async () => {
    const fb = await gradeFreeAnswerContent(
      reply({
        taskRelevance: 'ON_TASK',
        contentScore: 8,
        comment: 'Câu trả lời nêu rõ nơi gặp, nên thêm giờ gặp cho đầy đủ.',
      }),
      task,
      {
        ...pronunciation,
        transcript: 'We meet the guide in front of the hotel.',
      },
    );
    expect(fb.overallScore).toBe(7.5);
    expect(fb.contentStatus).toBe('GRADED');
    expect(fb.scoreVersion).toBe('v2-content');
  });

  it('a failed or malformed grade leaves pronunciation alone, labelled, never a number', async () => {
    const failed = await gradeFreeAnswerContent(
      () =>
        Promise.reject(
          Object.assign(new Error('quota'), { code: 'PROVIDER_UNAVAILABLE' }),
        ),
      task,
      pronunciation,
    );
    expect(failed.overallScore).toBe(6.9);
    expect(failed.contentStatus).toBe('UNAVAILABLE');
    expect(failed.contentScore).toBeUndefined();
    expect(failed.feedback).toMatch(/chưa chấm được nội dung/);

    expect(parseSpeakingContentGrade('not json').status).toBe('UNAVAILABLE');
    expect(
      parseSpeakingContentGrade(
        JSON.stringify({
          taskRelevance: 'ON_TASK',
          contentScore: 12,
          comment: 'Câu trả lời tốt.',
        }),
      ).status,
    ).toBe('UNAVAILABLE');
    expect(
      parseSpeakingContentGrade(
        JSON.stringify({
          taskRelevance: 'ON_TASK',
          contentScore: 7,
          comment: 'Good answer overall.',
        }),
      ).status,
    ).toBe('UNAVAILABLE');
  });

  it('silence or an empty transcript is not sent for grading', async () => {
    const generate = jest.fn();
    const silent = { ...pronunciation, transcript: '' };
    expect(await gradeFreeAnswerContent(generate, task, silent)).toBe(silent);
    expect(generate).not.toHaveBeenCalled();
  });

  it('the request carries the task, the information and what was heard', () => {
    const request = buildSpeakingContentRequest(
      {
        taskType: 'RESPOND_USING_INFORMATION',
        targetText: 'What time does the workshop begin?',
        stimulus: {
          title: 'Seminar schedule',
          content: 'The workshop begins at 2:00.',
        },
      },
      'It begins at two.',
    );
    const body = JSON.parse(request.prompt) as Record<string, unknown>;
    expect(body.task).toBe('What time does the workshop begin?');
    expect(body.information).toEqual({
      title: 'Seminar schedule',
      content: 'The workshop begins at 2:00.',
    });
    expect(body.learnerTranscript).toBe('It begins at two.');
    expect(request.responseSchema.required).toEqual([
      'taskRelevance',
      'contentScore',
      'comment',
    ]);
  });

  it('combines with a cap under content 3', () => {
    expect(combineSpeakingScores(9, 2)).toBe(3);
    expect(combineSpeakingScores(2, 2)).toBe(2);
    expect(combineSpeakingScores(6.9, 3)).toBe(5);
  });
});
