import { BadRequestException } from '@nestjs/common';
import { TOEIC_SPEAKING_TASK_SEQUENCE } from '../speaking/toeic-speaking-contract';

export type ExamTemplate = {
  key: string;
  familyCode: string;
  variantCode: string;
  displayName: string;
  authoringEnabled: boolean;
  sections: readonly {
    code: string;
    label: string;
    count: number;
    tasks?: readonly string[];
    includes?: readonly string[];
  }[];
};

export const EXAM_TEMPLATES: readonly ExamTemplate[] = [
  {
    key: 'TOEIC_LR_V1',
    familyCode: 'TOEIC',
    variantCode: 'TOEIC_LR',
    displayName: 'TOEIC Listening & Reading',
    authoringEnabled: true,
    sections: [
      { code: 'LISTENING', label: 'Listening', count: 100 },
      { code: 'READING', label: 'Reading', count: 100 },
      { code: 'PART_1', label: 'Part 1', count: 6 },
      { code: 'PART_2', label: 'Part 2', count: 25 },
      { code: 'PART_3', label: 'Part 3', count: 39 },
      { code: 'PART_4', label: 'Part 4', count: 30 },
      { code: 'PART_5', label: 'Part 5', count: 30 },
      { code: 'PART_6', label: 'Part 6', count: 16 },
      { code: 'PART_7', label: 'Part 7', count: 54 },
    ],
  },
  {
    key: 'TOEIC_SW_V1',
    familyCode: 'TOEIC',
    variantCode: 'TOEIC_SW',
    displayName: 'TOEIC Speaking & Writing',
    authoringEnabled: true,
    sections: [
      {
        code: 'SPEAKING',
        label: 'Speaking',
        count: 11,
        tasks: TOEIC_SPEAKING_TASK_SEQUENCE,
      },
      {
        code: 'WRITING',
        label: 'Writing',
        count: 8,
        tasks: ['PICTURE_SENTENCE', 'WRITTEN_REQUEST', 'OPINION_ESSAY'],
      },
    ],
  },
  {
    key: 'TOEIC_4_SKILLS_V1',
    familyCode: 'TOEIC',
    variantCode: 'TOEIC_4_SKILLS',
    displayName: 'TOEIC 4 kỹ năng',
    authoringEnabled: true,
    sections: [
      {
        code: 'LISTENING_READING',
        label: 'Listening & Reading',
        count: 200,
        includes: ['TOEIC_LR_V1'],
      },
      {
        code: 'SPEAKING',
        label: 'Speaking',
        count: 11,
        includes: ['TOEIC_SW_V1'],
      },
      {
        code: 'WRITING',
        label: 'Writing',
        count: 8,
        includes: ['TOEIC_SW_V1'],
      },
    ],
  },
  {
    key: 'IELTS_ACADEMIC_V1',
    familyCode: 'IELTS',
    variantCode: 'IELTS_ACADEMIC',
    displayName: 'IELTS Academic',
    authoringEnabled: false,
    sections: [],
  },
  {
    key: 'IELTS_GENERAL_V1',
    familyCode: 'IELTS',
    variantCode: 'IELTS_GENERAL',
    displayName: 'IELTS General Training',
    authoringEnabled: false,
    sections: [],
  },
];

export function resolveExamTemplate(
  familyCode: string,
  variantCode: string,
): ExamTemplate {
  const family = familyCode.trim().toUpperCase();
  const variant = variantCode.trim().toUpperCase();
  const template = EXAM_TEMPLATES.find(
    (candidate) =>
      candidate.familyCode === family && candidate.variantCode === variant,
  );
  if (!template) {
    throw new BadRequestException(
      `Chưa có template được hỗ trợ cho ${family}/${variant}`,
    );
  }
  if (!template.authoringEnabled) {
    throw new BadRequestException(
      `${template.displayName} đang ở trạng thái Coming soon và chưa thể tạo đề`,
    );
  }
  return template;
}

export function resolveTemplateByKey(templateKey: string): ExamTemplate {
  const template = EXAM_TEMPLATES.find(
    (candidate) => candidate.key === templateKey,
  );
  if (!template) {
    throw new BadRequestException(
      `Template đề thi không hợp lệ: ${templateKey}`,
    );
  }
  if (!template.authoringEnabled) {
    throw new BadRequestException(
      `${template.displayName} chưa hỗ trợ authoring`,
    );
  }
  return template;
}
