import { SpeakingStimulusKind } from '@prisma/client';
import {
  SPEAKING_TASK_ERRORS,
  taskTypeValidationErrors,
} from './speaking-task-validation';

const VIETNAMESE_LETTER = /[À-ỹĐđ]/;

describe('Speaking task semantic validation', () => {
  it('requires real learner-visible media for Describe a Picture', () => {
    expect(
      taskTypeValidationErrors({
        taskType: 'DESCRIBE_PICTURE',
        targetText: 'Describe the office scene.',
        imageUrl: null,
      }),
    ).toEqual(['Câu mô tả tranh cần ảnh đã được kiểm duyệt.']);

    expect(
      taskTypeValidationErrors({
        taskType: 'DESCRIBE_PICTURE',
        targetText: 'Describe the office scene.',
        imageUrl:
          'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/office.png',
      }),
    ).toEqual([]);

    expect(
      taskTypeValidationErrors({
        taskType: 'DESCRIBE_PICTURE',
        targetText: 'Describe the office scene.',
        imageUrl: 'data:image/svg+xml,<svg/>',
      }),
    ).toContain(SPEAKING_TASK_ERRORS.pictureNeedsImage);
  });

  it('requires one reusable INFORMATION stimulus for Respond Using Information', () => {
    expect(
      taskTypeValidationErrors({
        taskType: 'RESPOND_USING_INFORMATION',
        targetText: 'Explain the afternoon schedule.',
        stimulusId: null,
        stimulus: null,
      }),
    ).toEqual([SPEAKING_TASK_ERRORS.informationNeedsStimulus]);

    expect(
      taskTypeValidationErrors({
        taskType: 'RESPOND_USING_INFORMATION',
        targetText: 'Explain the afternoon schedule.',
        stimulusId: 4,
        stimulus: { kind: SpeakingStimulusKind.IMAGE },
      }),
    ).toEqual([SPEAKING_TASK_ERRORS.informationNeedsText]);

    expect(
      taskTypeValidationErrors({
        taskType: 'RESPOND_USING_INFORMATION',
        targetText: 'Explain the afternoon schedule.',
        stimulusId: 4,
        stimulus: { kind: SpeakingStimulusKind.INFORMATION },
      }),
    ).toEqual([]);
  });

  it('does not infer a semantic task type from the title', () => {
    expect(
      taskTypeValidationErrors({
        taskType: null,
        targetText: 'Read this sentence aloud.',
      }),
    ).toEqual([SPEAKING_TASK_ERRORS.missingTaskType]);
  });

  it('writes every reason in Vietnamese, with no task type code in it', () => {
    for (const message of Object.values(SPEAKING_TASK_ERRORS)) {
      expect(message).toMatch(VIETNAMESE_LETTER);
      expect(message).not.toMatch(
        /[A-Z]{2,}_[A-Z_]+|\b(stimulus|prompt|learner|raster)\b/i,
      );
    }
  });
});
