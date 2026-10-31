import { createHash } from 'crypto';
import { isAcceptedContentImageReference } from '../upload/content-image-validation';
import {
  buildToeicListeningAudioScript,
  toeicListeningAudioFingerprint,
} from './toeic-listening-audio';

export type ToeicValidationQuestion = {
  id: number;
  questionNumber: number;
  options: unknown;
  correctIndex: number;
};

export type ToeicValidationGroup = {
  id: number;
  part: number;
  groupOrder: number;
  canonicalAccent?: string | null;
  imageUrl?: string | null;
  audioUrl?: string | null;
  passageText?: string | null;
  transcriptText?: string | null;
  imageBrief?: string | null;
  mediaMetadata?: unknown;
  questions: ToeicValidationQuestion[];
};

export type ToeicValidationExam = {
  id: number;
  type: string;
  durationSeconds: number;
  groups: ToeicValidationGroup[];
};

export type ToeicValidationIssue = {
  code: string;
  message: string;
  groupId?: number;
  questionId?: number;
};

const EXPECTED_PART_COUNTS: Record<number, number> = {
  1: 6,
  2: 25,
  3: 39,
  4: 30,
  5: 30,
  6: 16,
  7: 54,
};

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export function validateToeicExam(exam: ToeicValidationExam): {
  learnerReady: boolean;
  issues: ToeicValidationIssue[];
  counts: Record<string, number>;
} {
  const issues: ToeicValidationIssue[] = [];
  const groups = [...(exam.groups ?? [])].sort(
    (a, b) => a.groupOrder - b.groupOrder,
  );
  const questions = groups.flatMap((group) => group.questions ?? []);
  const partCounts: Record<number, number> = {};
  for (const group of groups)
    partCounts[group.part] =
      (partCounts[group.part] ?? 0) + group.questions.length;

  if (exam.type !== 'FULL_TEST') {
    issues.push({
      code: 'INCOMPLETE_TEMPLATE',
      message:
        'Draft hiện chưa phải đề TOEIC Full Test 200 câu; cần hoàn thiện đúng template trước khi xuất bản.',
    });
  } else {
    const expectedTotal = Object.values(EXPECTED_PART_COUNTS).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (questions.length !== expectedTotal)
      issues.push({
        code: 'TOTAL_COUNT',
        message: `Cần ${expectedTotal} câu hỏi, hiện có ${questions.length} câu.`,
      });
    for (const [part, expected] of Object.entries(EXPECTED_PART_COUNTS)) {
      const actual = partCounts[Number(part)] ?? 0;
      if (actual !== expected)
        issues.push({
          code: 'PART_COUNT',
          message: `Part ${part} cần ${expected} câu, hiện có ${actual} câu.`,
        });
    }
    const numbers = questions.map((question) => question.questionNumber);
    const uniqueNumbers = new Set(numbers);
    if (
      uniqueNumbers.size !== numbers.length ||
      numbers.some(
        (number) => !Number.isInteger(number) || number < 1 || number > 200,
      )
    ) {
      issues.push({
        code: 'QUESTION_ORDER',
        message:
          'Số câu của Full Test không được trùng và phải đủ từ 1 đến 200.',
      });
    } else if (
      [...uniqueNumbers]
        .sort((a, b) => a - b)
        .some((number, index) => number !== index + 1)
    ) {
      issues.push({
        code: 'QUESTION_ORDER',
        message:
          'Số câu của Full Test phải đủ từ 1 đến 200 theo đúng thứ tự chuẩn.',
      });
    }
    const groupsFor = (part: number) =>
      groups.filter((group) => group.part === part);
    for (const [part, expectedGroups] of [
      [1, 6],
      [2, 25],
    ] as const) {
      const partGroups = groupsFor(part);
      if (
        partGroups.length !== expectedGroups ||
        partGroups.some((group) => group.questions.length !== 1)
      ) {
        issues.push({
          code: 'LISTENING_GROUP_STRUCTURE',
          message: `Part ${part} phải có ${expectedGroups} nhóm audio một câu hỏi.`,
        });
      }
    }
    for (const [part, expectedGroups] of [
      [3, 13],
      [4, 10],
    ] as const) {
      const partGroups = groupsFor(part);
      if (
        partGroups.length !== expectedGroups ||
        partGroups.some((group) => group.questions.length !== 3)
      ) {
        issues.push({
          code: 'GROUP_STRUCTURE',
          message: `Part ${part} phải có ${expectedGroups} nhóm ba câu hỏi.`,
        });
      }
    }
    const part7 = groupsFor(7);
    const single = part7.filter(
      (group) => group.questions.length >= 2 && group.questions.length <= 4,
    );
    const multiple = part7.filter((group) => group.questions.length === 5);
    if (
      single.length !== 10 ||
      single.reduce((sum, group) => sum + group.questions.length, 0) !== 29 ||
      multiple.length !== 5
    ) {
      issues.push({
        code: 'PART7_STRUCTURE',
        message:
          'Part 7 phải có 10 nhóm một đoạn văn (29 câu) và 5 nhóm nhiều đoạn văn (25 câu).',
      });
    }
  }

  for (const group of groups) {
    if (group.part < 1 || group.part > 7)
      issues.push({
        code: 'PART',
        message: `Part ${group.part} không hợp lệ.`,
        groupId: group.id,
      });
    if (group.part === 1 && !isAcceptedContentImageReference(group.imageUrl))
      issues.push({
        code: 'MISSING_IMAGE',
        message: 'Nhóm Part 1 chưa có hình ảnh.',
        groupId: group.id,
      });
    if (group.part >= 1 && group.part <= 4 && !group.audioUrl)
      issues.push({
        code: 'MISSING_AUDIO',
        message: 'Nhóm Listening chưa có audio đã lưu.',
        groupId: group.id,
      });
    const media = (group.mediaMetadata ?? {}) as {
      audio?: {
        transcriptHash?: string;
        sourceHash?: string;
        source?: string;
        status?: string;
        stale?: boolean;
      };
      image?: { briefHash?: string };
    };
    if (group.part >= 1 && group.part <= 4) {
      try {
        buildToeicListeningAudioScript(group);
        const sourceHash = toeicListeningAudioFingerprint(group);
        if (
          media.audio?.source === 'AI_GENERATED' &&
          media.audio.sourceHash !== sourceHash
        ) {
          issues.push({
            code: 'STALE_AUDIO',
            message: 'Audio đã tạo không khớp với nội dung nghe hiện tại.',
            groupId: group.id,
          });
        }
        if (media.audio?.stale) {
          issues.push({
            code: 'STALE_AUDIO',
            message: 'Audio đã lỗi thời vì nội dung nghe vừa thay đổi.',
            groupId: group.id,
          });
        }
        if (
          media.audio?.source !== 'AI_GENERATED' &&
          media.audio?.sourceHash &&
          media.audio.sourceHash !== sourceHash
        ) {
          issues.push({
            code: 'STALE_AUDIO',
            message: 'Audio không khớp với nội dung nghe hiện tại.',
            groupId: group.id,
          });
        }
        // Legacy authored assets have no generated provenance and remain
        // compatible. Legacy AI assets without sourceHash fail closed above.
        if (
          !media.audio?.sourceHash &&
          media.audio?.transcriptHash &&
          media.audio.source !== 'AI_GENERATED' &&
          media.audio.transcriptHash !== digest(group.transcriptText ?? '')
        ) {
          issues.push({
            code: 'STALE_AUDIO',
            message: 'Audio cũ không khớp với nội dung nghe đã lưu.',
            groupId: group.id,
          });
        }
      } catch (error) {
        issues.push({
          code: 'INVALID_LISTENING_SCRIPT',
          message:
            error instanceof Error
              ? error.message
              : 'Nội dung nghe không hợp lệ.',
          groupId: group.id,
        });
      }
    }
    if (
      group.part === 1 &&
      media.image?.briefHash &&
      media.image.briefHash !== digest(group.imageBrief ?? '')
    )
      issues.push({
        code: 'STALE_IMAGE',
        message: 'Ảnh cần được rà soát lại sau khi mô tả hình thay đổi',
        groupId: group.id,
      });
    if (
      group.part === 1 &&
      ['STALE', 'FAILED'].includes((media.image as any)?.questionStatus)
    )
      issues.push({
        code: 'STALE_IMAGE_QUESTION',
        message:
          'Câu hỏi Part 1 cần được tạo lại hoặc rà soát sau khi ảnh thay đổi',
        groupId: group.id,
      });
    if ((group.part === 6 || group.part === 7) && !group.passageText?.trim())
      issues.push({
        code: 'MISSING_PASSAGE',
        message: 'Nhóm Reading chưa có đoạn văn.',
        groupId: group.id,
      });
    for (const question of group.questions) {
      const options = Array.isArray(question.options) ? question.options : [];
      const expectedOptions = group.part === 2 ? 3 : 4;
      if (
        options.length !== expectedOptions ||
        options.some((option) => typeof option !== 'string' || !option.trim())
      )
        issues.push({
          code: 'OPTIONS',
          message: `Cần ${expectedOptions} phương án không để trống.`,
          groupId: group.id,
          questionId: question.id,
        });
      if (
        !Number.isInteger(question.correctIndex) ||
        question.correctIndex < 0 ||
        question.correctIndex >= options.length
      )
        issues.push({
          code: 'ANSWER_KEY',
          message: 'Câu hỏi chưa có đáp án đúng hợp lệ.',
          groupId: group.id,
          questionId: question.id,
        });
    }
  }
  return {
    learnerReady: exam.type === 'FULL_TEST' && issues.length === 0,
    issues,
    counts: {
      total: questions.length,
      listening: questions.filter((question) => {
        const group = groups.find((candidate) =>
          candidate.questions.some((item) => item.id === question.id),
        );
        return !!group && group.part <= 4;
      }).length,
      reading: questions.filter((question) => {
        const group = groups.find((candidate) =>
          candidate.questions.some((item) => item.id === question.id),
        );
        return !!group && group.part >= 5;
      }).length,
      groups: groups.length,
    },
  };
}
/**
 * Human-readable, Admin-facing view of a ToeicValidationIssue.
 * `code`/`groupId`/`questionId` stay for internal navigation (outline jump
 * targets); `humanMessage` is the only thing meant to be shown in the UI —
 * never raw codes like MISSING_AUDIO or a bare "Group ID: 128".
 */
export type HumanReadableToeicIssue = ToeicValidationIssue & {
  part?: number;
  groupOrder?: number;
  questionNumber?: number;
  humanMessage: string;
};

const PART_LABEL: Record<number, string> = {
  1: 'Listening · Part 1',
  2: 'Listening · Part 2',
  3: 'Listening · Part 3',
  4: 'Listening · Part 4',
  5: 'Reading · Part 5',
  6: 'Reading · Part 6',
  7: 'Reading · Part 7',
};

const GROUP_NOUN: Record<number, string> = {
  1: 'Bức ảnh',
  2: 'Câu hỏi',
  3: 'Nhóm hội thoại',
  4: 'Nhóm bài nói',
  5: 'Câu hỏi',
  6: 'Đoạn văn',
  7: 'Đoạn văn',
};

/**
 * Attaches a human-readable Vietnamese message + navigation coordinates
 * (part/groupOrder/questionNumber) to each raw validation issue. Never
 * mutates `validateToeicExam`'s own output — call this only where issues
 * are about to be shown to an Admin.
 */
export function humanizeToeicValidationIssues(
  exam: ToeicValidationExam,
  issues: ToeicValidationIssue[],
): HumanReadableToeicIssue[] {
  const groupsById = new Map(
    (exam.groups ?? []).map((group) => [group.id, group]),
  );
  const questionIndex = new Map<
    number,
    { group: ToeicValidationGroup; question: ToeicValidationQuestion }
  >();
  for (const group of exam.groups ?? []) {
    for (const question of group.questions ?? []) {
      questionIndex.set(question.id, { group, question });
    }
  }

  return issues.map((issue) => {
    const group = issue.groupId ? groupsById.get(issue.groupId) : undefined;
    const fromQuestion = issue.questionId
      ? questionIndex.get(issue.questionId)
      : undefined;
    const part = group?.part ?? fromQuestion?.group.part;
    const groupOrder = group?.groupOrder ?? fromQuestion?.group.groupOrder;
    const questionNumber = fromQuestion?.question.questionNumber;
    const partLabel = part ? PART_LABEL[part] : undefined;
    const groupLabel =
      part && groupOrder
        ? `${GROUP_NOUN[part] ?? 'Nhóm'} ${groupOrder}`
        : undefined;

    let humanMessage = issue.message;
    switch (issue.code) {
      case 'MISSING_AUDIO':
        humanMessage = `${partLabel} · ${groupLabel} chưa có audio.`;
        break;
      case 'MISSING_IMAGE':
        humanMessage = `${partLabel} · ${groupLabel} chưa có hình ảnh.`;
        break;
      case 'MISSING_PASSAGE':
        humanMessage = `${partLabel} · ${groupLabel} chưa có đoạn văn.`;
        break;
      case 'OPTIONS':
        humanMessage = questionNumber
          ? `${partLabel} · Câu ${questionNumber} chưa đủ đáp án lựa chọn.`
          : humanMessage;
        break;
      case 'ANSWER_KEY':
        humanMessage = questionNumber
          ? `${partLabel} · Câu ${questionNumber} chưa có đáp án đúng.`
          : humanMessage;
        break;
      case 'STALE_AUDIO':
        humanMessage = `${partLabel} · ${groupLabel}: audio chưa khớp với nội dung cần nghe, hãy tạo lại audio.`;
        break;
      case 'INVALID_LISTENING_SCRIPT':
        humanMessage = `${partLabel} · ${groupLabel}: nội dung nghe chưa đủ cấu trúc để tạo audio.`;
        break;
      case 'LISTENING_GROUP_STRUCTURE':
        humanMessage =
          'Cấu trúc nhóm Listening Part 1 hoặc Part 2 chưa đúng số câu cần có.';
        break;
      case 'STALE_IMAGE':
      case 'STALE_IMAGE_QUESTION':
        humanMessage = `${partLabel} · ${groupLabel}: hình ảnh cần rà soát lại.`;
        break;
      case 'TOTAL_COUNT':
      case 'PART_COUNT':
      case 'GROUP_STRUCTURE':
      case 'PART7_STRUCTURE':
      case 'QUESTION_ORDER':
      case 'INCOMPLETE_TEMPLATE':
        humanMessage =
          'Cấu trúc đề chưa đúng chuẩn TOEIC Full Test — cần AI soạn lại hoặc bổ sung thủ công.';
        break;
      default:
        break;
    }

    return { ...issue, part, groupOrder, questionNumber, humanMessage };
  });
}
