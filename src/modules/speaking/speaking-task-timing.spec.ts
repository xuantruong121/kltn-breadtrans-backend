import { maxRecordingMs, speakingTaskTiming } from './speaking-task-timing';

describe('Speaking task timing (ETS TOEIC Speaking format for exam tasks)', () => {
  const exam = (order: number, taskType: string) =>
    speakingTaskTiming({ taskType, order, examTask: true });

  it('follows the ETS table by question number', () => {
    // Q1-2 answer in 30 s, not ETS's 45 s: Azure's scripted assessment limit.
    expect(exam(1, 'READ_ALOUD')).toEqual({
      readingSeconds: 0,
      prepSeconds: 45,
      responseSeconds: 30,
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
      speakingTaskTiming({
        taskType: 'RESPOND_TO_QUESTION',
        order: 1,
        examTask: false,
      }),
    ).toEqual({ readingSeconds: 0, prepSeconds: 0, responseSeconds: 45 });
    expect(
      speakingTaskTiming({
        taskType: 'EXPRESS_OPINION',
        order: null,
        examTask: false,
      }).responseSeconds,
    ).toBe(60);
  });

  it('read-aloud and drills answer in at most 30 s, practice and exam alike', () => {
    for (const taskType of ['READ_ALOUD', 'PRONUNCIATION_DRILL', null])
      expect(
        speakingTaskTiming({ taskType, order: null, examTask: false })
          .responseSeconds,
      ).toBe(30);
    expect(exam(2, 'READ_ALOUD').responseSeconds).toBe(30);
    expect(maxRecordingMs(exam(1, 'READ_ALOUD'))).toBe(31_500);
  });

  it('accepts a recording up to the limit plus a small flush tolerance', () => {
    expect(maxRecordingMs(exam(5, 'RESPOND_TO_QUESTION'))).toBe(16_500);
    expect(maxRecordingMs(exam(11, 'EXPRESS_OPINION'))).toBe(61_500);
  });
});
