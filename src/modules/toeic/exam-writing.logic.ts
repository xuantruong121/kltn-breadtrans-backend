import { QuizType } from '@prisma/client';
import { TOEIC_WRITING_SLOT_CONTRACT } from '../writing/toeic-writing-set.contract';

/** A TOEIC Writing section has 8 fixed slots; each task belongs to one exam. */
export function examWritingSlot(order: number) {
  const taskKind = TOEIC_WRITING_SLOT_CONTRACT[order - 1];
  if (!taskKind) return null;
  return {
    order,
    taskKind,
    quizType:
      taskKind === 'PICTURE_SENTENCE'
        ? QuizType.WRITING_PICTURE
        : QuizType.WRITING_EMAIL,
  };
}

export type ExamWritingInput = {
  title: string;
  prompt: string;
  imageUrl?: string;
  keywords?: string[];
  email?: string;
};

/** Merges on top of what the task already holds, so unknown fields survive. */
export function examWritingContent(
  taskKind: string,
  input: ExamWritingInput,
  current: Record<string, unknown> = {},
) {
  const content: Record<string, unknown> = {
    ...current,
    prompt: input.prompt.trim(),
    taskType: taskKind,
  };
  const text = (key: 'imageUrl' | 'email', value?: string) => {
    if (value === undefined) return;
    if (value.trim()) content[key] = value.trim();
    else delete content[key];
  };
  text('imageUrl', input.imageUrl);
  text('email', input.email);
  if (input.keywords)
    content.keywords = input.keywords
      .map((word) => word.trim())
      .filter(Boolean);
  return content;
}

/** Why a slot cannot be saved as it is; null when it can. */
export function examWritingProblem(taskKind: string, input: ExamWritingInput) {
  if (!input.title.trim()) return 'Cần nhập tiêu đề câu.';
  if (!input.prompt.trim()) return 'Cần nhập đề bài.';
  if (taskKind === 'PICTURE_SENTENCE') {
    if (!input.imageUrl?.trim()) return 'Câu viết theo tranh cần có ảnh.';
    if ((input.keywords ?? []).filter((word) => word.trim()).length < 2)
      return 'Câu viết theo tranh cần ít nhất 2 từ khoá.';
  }
  return null;
}
