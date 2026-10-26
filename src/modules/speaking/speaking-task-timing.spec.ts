import { maxRecordingMs, speakingTaskTiming } from './speaking-task-timing';

describe('Speaking task timing (ETS TOEIC Speaking format for exam tasks)', () => {
  const exam = (order: number, taskType: string) =>
    speakingTaskTiming({ taskType, order, examTask: true });

  it('follows the ETS table by question number', () => {
    expect(exam(1, 'READ_ALOUD')).toEqual({
      readingSeconds: 0,
      prepSeconds: 45,
      responseSeconds: 45,
    });
    expect(exam(3, 'DESCRIBE_PICTURE').responseSeconds).toBe(30);
    expect(exam(5, 'RESPOND_TO_QUESTION')).toEqual({
      readingSeconds: 0,
      prepSeconds: 3,
      responseSeconds: 15,
    });
    expect(exam(7, 'RESPOND_TO_QUESTION').responseSeconds).toBe(30);
    expect(exam(8, 'RESPOND_USING_INFORMATION')).toEqual({
      readingSeconds: 45,
      prepSeconds: 3,
      responseSeconds: 15,
    });
    expect(exam(10, 'RESPOND_USING_INFORMATION').responseSeconds).toBe(30);
    expect(exam(11, 'EXPRESS_OPINION')).toEqual({
      readingSeconds: 0,
      prepSeconds: 45,
      responseSeconds: 60,
    });
  });

  it('ordinary practice keeps 45 s, 60 s for an opinion, with no preparation clock', () => {
    expect(
      speakingTaskTiming({ taskType: 'READ_ALOUD', order: 1, examTask: false }),
    ).toEqual({ readingSeconds: 0, prepSeconds: 0, responseSeconds: 45 });
    expect(
      speakingTaskTiming({
        taskType: 'EXPRESS_OPINION',
        order: null,
        examTask: false,
      }).responseSeconds,
    ).toBe(60);
  });

  it('accepts a recording up to the limit plus a small flush tolerance', () => {
    expect(maxRecordingMs(exam(5, 'RESPOND_TO_QUESTION'))).toBe(16_500);
    expect(maxRecordingMs(exam(11, 'EXPRESS_OPINION'))).toBe(61_500);
  });
});
