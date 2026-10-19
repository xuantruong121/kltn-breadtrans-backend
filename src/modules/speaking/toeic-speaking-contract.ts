import { taskTypeValidationErrors } from './speaking-task-validation';

export const TOEIC_SPEAKING_TASK_SEQUENCE = [
  'READ_ALOUD',
  'READ_ALOUD',
  'DESCRIBE_PICTURE',
  'DESCRIBE_PICTURE',
  'RESPOND_TO_QUESTION',
  'RESPOND_TO_QUESTION',
  'RESPOND_TO_QUESTION',
  'RESPOND_USING_INFORMATION',
  'RESPOND_USING_INFORMATION',
  'RESPOND_USING_INFORMATION',
  'EXPRESS_OPINION',
] as const;

export function toeicSpeakingContractErrors(source: {
  exercises?: Array<{
    id: number;
    order?: number | null;
    taskType?: string | null;
    title?: string | null;
    targetText?: string | null;
    imageUrl?: string | null;
    stimulusId?: number | null;
    stimulus?: { kind?: string | null } | null;
  }>;
}) {
  const exercises = [...(source.exercises ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id,
  );
  const errors: string[] = [];

  if (exercises.length !== TOEIC_SPEAKING_TASK_SEQUENCE.length) {
    errors.push(
      `TOEIC Speaking cần đúng ${TOEIC_SPEAKING_TASK_SEQUENCE.length} câu; hiện có ${exercises.length}`,
    );
  }

  const orders = exercises.map((exercise) => exercise.order);
  const expectedOrders = TOEIC_SPEAKING_TASK_SEQUENCE.map(
    (_, index) => index + 1,
  );
  if (
    orders.length !== expectedOrders.length ||
    orders.some((order, index) => order !== expectedOrders[index])
  ) {
    errors.push('Thứ tự TOEIC Speaking phải liên tục từ 1 đến 11');
  }

  for (const [index, exercise] of exercises.entries()) {
    const expectedTaskType = TOEIC_SPEAKING_TASK_SEQUENCE[index];
    if (exercise.taskType !== expectedTaskType) {
      errors.push(`Câu ${index + 1}: taskType phải là ${expectedTaskType}`);
    }
    if (!exercise.title?.trim() || !exercise.targetText?.trim()) {
      errors.push(`Câu ${index + 1}: thiếu tiêu đề hoặc prompt`);
    }
    errors.push(
      ...taskTypeValidationErrors({
        taskType: exercise.taskType as any,
        targetText: exercise.targetText,
        imageUrl: exercise.imageUrl,
        stimulusId: exercise.stimulusId,
        stimulus: exercise.stimulus as any,
      }).map((error) => `Câu ${index + 1}: ${error}`),
    );
  }

  const informationExercises = exercises.slice(7, 10);
  const informationIds = informationExercises.map(
    (exercise) => exercise.stimulusId,
  );
  if (
    informationIds.length !== 3 ||
    !informationIds[0] ||
    informationIds.some((stimulusId) => stimulusId !== informationIds[0])
  ) {
    errors.push('Câu 8–10 phải dùng cùng một stimulus INFORMATION');
  }
  if (
    informationExercises.some(
      (exercise) => exercise.stimulus?.kind !== 'INFORMATION',
    )
  ) {
    errors.push('Stimulus của câu 8–10 phải có kind INFORMATION');
  }

  return errors;
}
