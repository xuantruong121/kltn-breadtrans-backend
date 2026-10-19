export const TOEIC_WRITING_TASK_KINDS = [
  'PICTURE_SENTENCE',
  'WRITTEN_REQUEST',
  'OPINION_ESSAY',
] as const;

export type ToeicWritingTaskKind = (typeof TOEIC_WRITING_TASK_KINDS)[number];

export const TOEIC_WRITING_SLOT_CONTRACT: readonly ToeicWritingTaskKind[] = [
  'PICTURE_SENTENCE',
  'PICTURE_SENTENCE',
  'PICTURE_SENTENCE',
  'PICTURE_SENTENCE',
  'PICTURE_SENTENCE',
  'WRITTEN_REQUEST',
  'WRITTEN_REQUEST',
  'OPINION_ESSAY',
];

export type ToeicWritingSetItemLike = {
  order: number;
  taskKind: string;
};

export function validateToeicWritingStructure(
  items: readonly ToeicWritingSetItemLike[],
) {
  const ordered = [...items].sort((a, b) => a.order - b.order);
  const issues: string[] = [];

  if (ordered.length !== TOEIC_WRITING_SLOT_CONTRACT.length) {
    issues.push(`Cần đúng 8 item, hiện có ${ordered.length}`);
  }

  ordered.forEach((item, index) => {
    const expectedOrder = index + 1;
    const expectedKind = TOEIC_WRITING_SLOT_CONTRACT[index];
    if (item.order !== expectedOrder) {
      issues.push(`Item phải có thứ tự liên tục từ 1 đến 8`);
    }
    if (item.taskKind !== expectedKind) {
      issues.push(
        `Vị trí ${expectedOrder} phải là ${expectedKind}, hiện là ${item.taskKind}`,
      );
    }
  });

  const orders = ordered.map((item) => item.order);
  if (new Set(orders).size !== orders.length) {
    issues.push('Không được trùng thứ tự item');
  }

  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    counts: {
      total: ordered.length,
      pictureSentence: ordered.filter(
        (item) => item.taskKind === 'PICTURE_SENTENCE',
      ).length,
      writtenRequest: ordered.filter(
        (item) => item.taskKind === 'WRITTEN_REQUEST',
      ).length,
      opinionEssay: ordered.filter((item) => item.taskKind === 'OPINION_ESSAY')
        .length,
    },
  };
}

export function isToeicWritingTaskKind(
  value: string,
): value is ToeicWritingTaskKind {
  return (TOEIC_WRITING_TASK_KINDS as readonly string[]).includes(value);
}
