import { SpeakingStimulusKind } from '@prisma/client';
import { taskTypeValidationErrors } from './speaking-task-validation';

describe('Speaking task semantic validation', () => {
  it('requires real learner-visible media for Describe a Picture', () => {
    expect(
      taskTypeValidationErrors({
        taskType: 'DESCRIBE_PICTURE',
        targetText: 'Describe the office scene.',
        imageUrl: null,
      }),
    ).toContain('DESCRIBE_PICTURE cần imageUrl learner-visible');

    expect(
      taskTypeValidationErrors({
        taskType: 'DESCRIBE_PICTURE',
        targetText: 'Describe the office scene.',
        imageUrl: 'https://cdn.example/office.png',
      }),
    ).toEqual([]);
  });

  it('requires one reusable INFORMATION stimulus for Respond Using Information', () => {
    expect(
      taskTypeValidationErrors({
        taskType: 'RESPOND_USING_INFORMATION',
        targetText: 'Explain the afternoon schedule.',
        stimulusId: null,
        stimulus: null,
      }),
    ).toContain('RESPOND_USING_INFORMATION cần stimulus');

    expect(
      taskTypeValidationErrors({
        taskType: 'RESPOND_USING_INFORMATION',
        targetText: 'Explain the afternoon schedule.',
        stimulusId: 4,
        stimulus: { kind: SpeakingStimulusKind.IMAGE },
      }),
    ).toContain('Stimulus của RESPOND_USING_INFORMATION phải là INFORMATION');
  });

  it('does not infer a semantic task type from the title', () => {
    expect(
      taskTypeValidationErrors({
        taskType: null,
        targetText: 'Read this sentence aloud.',
      }),
    ).toContain('Thiếu loại bài Speaking');
  });
});
