import { BadRequestException } from '@nestjs/common';
import { SpeakingStimulusKind } from '@prisma/client';
import { SPEAKING_TASK_TYPES, SpeakingTaskType } from './speaking-contract';

export function isSpeakingTaskType(value: unknown): value is SpeakingTaskType {
  return (
    typeof value === 'string' &&
    (SPEAKING_TASK_TYPES as readonly string[]).includes(value)
  );
}

export function assertSpeakingTaskType(
  value: unknown,
): asserts value is SpeakingTaskType {
  if (!isSpeakingTaskType(value)) {
    throw new BadRequestException('Loại bài Speaking không hợp lệ');
  }
}

export function taskTypeValidationErrors(input: {
  taskType: SpeakingTaskType | null | undefined;
  targetText?: string | null;
  imageUrl?: string | null;
  stimulus?: { kind: SpeakingStimulusKind } | null;
  stimulusId?: number | null;
}): string[] {
  const errors: string[] = [];
  if (!input.taskType) return ['Thiếu loại bài Speaking'];
  if (!input.targetText?.trim()) errors.push('Thiếu nội dung/prompt Speaking');
  if (input.taskType === 'DESCRIBE_PICTURE' && !input.imageUrl?.trim()) {
    errors.push('DESCRIBE_PICTURE cần imageUrl learner-visible');
  }
  if (input.taskType === 'RESPOND_USING_INFORMATION') {
    if (!input.stimulusId)
      errors.push('RESPOND_USING_INFORMATION cần stimulus');
    if (input.stimulus?.kind !== SpeakingStimulusKind.INFORMATION) {
      errors.push('Stimulus của RESPOND_USING_INFORMATION phải là INFORMATION');
    }
  }
  return errors;
}
