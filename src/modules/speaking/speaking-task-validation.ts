import { BadRequestException } from '@nestjs/common';
import { SpeakingStimulusKind } from '@prisma/client';
import { isAcceptedContentImageReference } from '../upload/content-image-validation';
import { SPEAKING_TASK_TYPES, SpeakingTaskType } from './speaking-contract';

/**
 * Admin-facing reasons, in Vietnamese: the CMS shows them as they are (QA
 * 2026-11-22 found "DESCRIBE_PICTURE cần ảnh raster..." in a toast).
 */
export const SPEAKING_TASK_ERRORS = {
  missingTaskType: 'Thiếu loại bài nói.',
  missingText: 'Thiếu câu mẫu hoặc đề bài.',
  pictureNeedsImage: 'Câu mô tả tranh cần ảnh đã được kiểm duyệt.',
  informationNeedsStimulus:
    'Câu trả lời dựa trên thông tin cần chọn thông tin dùng chung.',
  informationNeedsText:
    'Câu trả lời dựa trên thông tin chỉ dùng thông tin dạng văn bản, không dùng ảnh.',
} as const;

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
    throw new BadRequestException('Loại bài nói không hợp lệ.');
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
  if (!input.taskType) return [SPEAKING_TASK_ERRORS.missingTaskType];
  if (!input.targetText?.trim()) errors.push(SPEAKING_TASK_ERRORS.missingText);
  if (
    input.taskType === 'DESCRIBE_PICTURE' &&
    !isAcceptedContentImageReference(input.imageUrl)
  ) {
    errors.push(SPEAKING_TASK_ERRORS.pictureNeedsImage);
  }
  if (input.taskType === 'RESPOND_USING_INFORMATION') {
    // One reason per problem: a missing stimulus has no kind to complain about.
    if (!input.stimulusId)
      errors.push(SPEAKING_TASK_ERRORS.informationNeedsStimulus);
    else if (input.stimulus?.kind !== SpeakingStimulusKind.INFORMATION) {
      errors.push(SPEAKING_TASK_ERRORS.informationNeedsText);
    }
  }
  return errors;
}
