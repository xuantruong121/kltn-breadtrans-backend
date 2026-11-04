import { BadRequestException } from '@nestjs/common';
import { TOEIC_SPEAKING_TASK_SEQUENCE } from '../speaking/toeic-speaking-contract';

export const PRACTICE_DISCLAIMER =
  'Lưu ý: Đây là đề luyện tập tham khảo được xây dựng nhằm mô phỏng cấu trúc TOEIC. Nội dung không phải đề thi chính thức do ETS phát hành và không thay thế bài thi TOEIC chính thức.';

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
    /** Set on the sections a learner sits; Parts sit inside them. */
    minutes?: number;
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
      { code: 'LISTENING', label: 'Listening', count: 100, minutes: 45 },
      { code: 'READING', label: 'Reading', count: 100, minutes: 75 },
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
        minutes: 20,
        tasks: TOEIC_SPEAKING_TASK_SEQUENCE,
      },
      {
        code: 'WRITING',
        label: 'Writing',
        count: 8,
        minutes: 60,
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
        minutes: 120,
        includes: ['TOEIC_LR_V1'],
      },
      {
        code: 'SPEAKING',
        label: 'Speaking',
        count: 11,
        minutes: 20,
        includes: ['TOEIC_SW_V1'],
      },
      {
        code: 'WRITING',
        label: 'Writing',
        count: 8,
        minutes: 60,
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

/** Default length of a part-practice paper, by the ETS section its Parts belong to. */
export const PART_PRACTICE_DEFAULT_MINUTES = { LISTENING: 45, READING: 75 };

/** Minutes of every timed section: L&R 120, S&W 20 + 60 = 80, 4 skills 200. */
export function templateTotalMinutes(template: ExamTemplate): number {
  return template.sections.reduce(
    (sum, section) => sum + (section.minutes ?? 0),
    0,
  );
}

/**
 * Length of the L&R paper an exam owns. A full test follows the ETS structure
 * (45 + 75 minutes, also the L&R section of the 4-skill exam) and ignores what
 * the form sends. Part practice exists for L&R only and keeps the requested
 * length.
 */
export function lrPaperSeconds(
  variantCode: string,
  type: string | undefined,
  requestedSeconds?: number,
): number {
  if (type === 'PRACTICE_BY_PART') {
    if (variantCode !== 'TOEIC_LR')
      throw new BadRequestException(
        'Chỉ đề Listening & Reading có loại luyện tập theo Part',
      );
    return requestedSeconds ?? PART_PRACTICE_DEFAULT_MINUTES.LISTENING * 60;
  }
  const template = EXAM_TEMPLATES.find(
    (candidate) => candidate.variantCode === variantCode,
  );
  const minutes = (template?.sections ?? [])
    .filter((section) =>
      ['LISTENING', 'READING', 'LISTENING_READING'].includes(section.code),
    )
    .reduce((sum, section) => sum + (section.minutes ?? 0), 0);
  return (minutes || 120) * 60;
}
