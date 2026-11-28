import { PRACTICE_LEVELS } from '../../subscription/practice-level';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  IsOptional,
  IsInt,
  IsIn,
  IsArray,
  Min,
  Max,
  ArrayMaxSize,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  SPEAKING_SET_LEVELS,
  SPEAKING_TASK_TYPES,
} from '../../speaking/speaking-contract';
import type { SpeakingTaskType } from '../../speaking/speaking-contract';
import { SPEAKING_DRAFT_TASK_TYPES } from '../speaking-draft.logic';
import {
  LISTENING_FULL_DRAFT_MODES,
  type ListeningFullDraftMode,
} from '../strategies/ai-evaluator.interface';

// C2 too (owner 2026-11-22): the CMS level select offers it, and a C2
// draft was refused with 400 in every AI form.
/** Every AI draft takes one of the four practice levels (owner 2026-11-27). */
const CONTENT_LEVELS = PRACTICE_LEVELS;
const GRAMMAR_LEVELS = PRACTICE_LEVELS;
const TOEIC_PART5_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type ToeicPart5Difficulty = (typeof TOEIC_PART5_DIFFICULTIES)[number];

export class SuggestVocabWordDto {
  @IsNotEmpty({ message: 'Từ vựng không được để trống' })
  @IsString({ message: 'Từ vựng phải là chuỗi ký tự' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  word: string;

  @IsOptional()
  @IsString({ message: 'Ngữ cảnh phải là chuỗi ký tự' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  context?: string;

  @IsOptional()
  @IsIn(GRAMMAR_LEVELS, { message: 'Cấp độ ngữ cảnh từ vựng không hợp lệ' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  level?: string;
}

export class SuggestGrammarQuestionsDto {
  @IsNotEmpty({ message: 'Tiêu đề chủ đề không được để trống' })
  @IsString({ message: 'Tiêu đề chủ đề phải là chuỗi ký tự' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  topicTitle: string;

  @IsNotEmpty({ message: 'Cấp độ ngữ pháp không được để trống' })
  @IsIn(GRAMMAR_LEVELS, { message: 'Cấp độ ngữ pháp không hợp lệ' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  level: string;

  @IsOptional()
  @IsString({ message: 'Lý thuyết phải là chuỗi ký tự' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  theory?: string;

  @IsOptional()
  @IsString({ message: 'Công thức chính phải là chuỗi ký tự' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  keyFormula?: string;

  /** Items the draft already holds: a "Tạo câu khác" answer never repeats them (owner 2026-11-25). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  avoid?: string[];

  @IsOptional()
  @IsInt({ message: 'Số lượng câu hỏi phải là số nguyên' })
  @Min(1, { message: 'Số lượng câu hỏi tối thiểu là 1' })
  @Max(5, { message: 'Số lượng câu hỏi tối đa là 5' })
  @Transform(({ value }) => (value !== undefined ? Number(value) : 3))
  count?: number = 3;
}

export class SuggestReadingPassageDto {
  @IsNotEmpty({ message: 'Chủ đề bài đọc không được để trống' })
  @IsString({ message: 'Chủ đề phải là chuỗi ký tự' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  topic: string;

  @IsNotEmpty({ message: 'Cấp độ bài đọc không được để trống' })
  @IsIn(CONTENT_LEVELS, {
    message: 'Cấp độ phải là Mất gốc, Cơ bản, Trung cấp hoặc Nâng cao',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  level: string;

  @IsOptional()
  @IsInt({ message: 'Độ dài mục tiêu phải là số nguyên' })
  @Min(50, { message: 'Độ dài tối thiểu là 50 từ' })
  @Max(1000, { message: 'Độ dài tối đa là 1000 từ' })
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  targetLength?: number;

  @IsOptional()
  @IsString({ message: 'Kỹ năng vi mô phải là chuỗi ký tự' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  microSkill?: string;
}

export class SuggestReadingQuestionsDto {
  @IsNotEmpty({ message: 'Đoạn văn đọc không được để trống' })
  @IsString({ message: 'Đoạn văn đọc phải là chuỗi ký tự' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  passage: string;

  @IsOptional()
  @IsIn(CONTENT_LEVELS, {
    message: 'Cấp độ phải là Mất gốc, Cơ bản, Trung cấp hoặc Nâng cao',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  level?: string;

  /** Items the draft already holds: a "Tạo câu khác" answer never repeats them (owner 2026-11-25). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  avoid?: string[];

  @IsOptional()
  @IsInt({ message: 'Số lượng câu hỏi phải là số nguyên' })
  @Min(1, { message: 'Số lượng câu hỏi tối thiểu là 1' })
  @Max(5, { message: 'Số lượng câu hỏi tối đa là 5' })
  @Transform(({ value }) => (value !== undefined ? Number(value) : 3))
  count?: number = 3;
}

export class SuggestToeicPart5Dto {
  @IsOptional()
  @IsString({ message: 'Chủ đề phải là chuỗi ký tự' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  topic?: string;

  @IsOptional()
  @IsIn(CONTENT_LEVELS, {
    message: 'Cấp độ phải là Mất gốc, Cơ bản, Trung cấp hoặc Nâng cao',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  level?: string;

  @IsOptional()
  @IsString({ message: 'Trọng tâm ngữ pháp phải là chuỗi ký tự' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  grammarFocus?: string;

  @IsOptional()
  @IsString({ message: 'Trọng tâm từ vựng phải là chuỗi ký tự' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  vocabularyFocus?: string;

  /** The exam's own difficulty, so new items match the test (owner 2026-11-25). */
  @IsOptional()
  @IsIn(TOEIC_PART5_DIFFICULTIES, {
    message: 'Độ khó phải là easy, medium hoặc hard',
  })
  difficulty?: ToeicPart5Difficulty;

  @IsOptional()
  @IsInt({ message: 'Số lượng câu hỏi phải là số nguyên' })
  @Min(1, { message: 'Số lượng câu hỏi tối thiểu là 1' })
  @Max(10, { message: 'Số lượng câu hỏi tối đa là 10' })
  @Transform(({ value }) => (value !== undefined ? Number(value) : 5))
  count?: number = 5;
}

export class ListeningTurnContextDto {
  @IsNotEmpty()
  @IsString()
  speaker: string;

  @IsNotEmpty()
  @IsString()
  text: string;

  @IsOptional()
  @IsString()
  translation?: string;
}

export class SuggestListeningContentDto {
  @IsIn(['DIALOGUE', 'DICTATION'])
  mode: 'DIALOGUE' | 'DICTATION';

  @IsOptional()
  @IsIn(CONTENT_LEVELS, {
    message: 'Cấp độ phải là Mất gốc, Cơ bản, Trung cấp hoặc Nâng cao',
  })
  level?: string;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsString()
  currentText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ListeningTurnContextDto)
  currentTurns?: ListeningTurnContextDto[];
}

export class SuggestListeningQuestionsDto {
  @IsIn(['DIALOGUE', 'DICTATION'])
  mode: 'DIALOGUE' | 'DICTATION';

  @IsNotEmpty({ message: 'Nội dung nghe hiện tại không được để trống' })
  @IsString()
  sourceText: string;

  @IsOptional()
  @IsIn(CONTENT_LEVELS, {
    message: 'Cấp độ phải là Mất gốc, Cơ bản, Trung cấp hoặc Nâng cao',
  })
  level?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 3))
  count?: number = 3;
}

export class SuggestWritingTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  sourceText?: string;

  @IsNotEmpty({ message: 'Loại bài Writing không được để trống' })
  @IsString()
  taskType: string;

  @IsOptional()
  @IsIn(CONTENT_LEVELS, {
    message: 'Cấp độ phải là Mất gốc, Cơ bản, Trung cấp hoặc Nâng cao',
  })
  level?: string;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsString()
  currentPrompt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  wordMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  wordMax?: number;
}

const SPEAKING_LEVELS = [...SPEAKING_SET_LEVELS];

export class SuggestSpeakingPracticeSetDto {
  @IsNotEmpty({ message: 'Trọng tâm bộ luyện nói không được để trống' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  topic: string;

  @IsIn(SPEAKING_LEVELS)
  level: string;

  /**
   * Lĩnh vực the draft is written for: an active track code. Empty for a
   * general draft. Replaces the required speaking category (2026-11-21).
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{1,40}$/)
  track?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  currentTitle?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  currentDescription?: string;
}

export class SuggestSpeakingExercisesDto {
  @IsNotEmpty({ message: 'Tên bộ luyện nói không được để trống' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  practiceSetTitle: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  practiceSetDescription?: string;

  @IsIn(SPEAKING_LEVELS)
  level: string;

  /**
   * Lĩnh vực the draft is written for: an active track code. Empty for a
   * general draft. Replaces the required speaking category (2026-11-21).
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{1,40}$/)
  track?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  currentTitle?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  currentTargetText?: string;

  @IsOptional()
  @IsIn([...SPEAKING_TASK_TYPES])
  taskType?: SpeakingTaskType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  existingExerciseTitles?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 3))
  count?: number = 3;
}

export class SuggestSpeakingFullDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  sourceText?: string;

  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  topic: string;

  @IsIn(SPEAKING_LEVELS)
  level: string;

  /**
   * Lĩnh vực the draft is written for: an active track code. Empty for a
   * general draft. Replaces the required speaking category (2026-11-21).
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{1,40}$/)
  track?: string;

  @IsOptional()
  @IsString()
  objective?: string;

  /** Text-only types: a picture or information task needs media a draft cannot bring. */
  @IsOptional()
  @IsIn([...SPEAKING_DRAFT_TASK_TYPES], {
    message:
      'Bản nháp AI không soạn câu mô tả tranh hay câu trả lời dựa trên thông tin; hãy thêm các câu đó sau khi tạo bộ.',
  })
  taskType?: SpeakingTaskType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 5))
  count?: number = 5;
}

export class SuggestListeningFullDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  sourceText?: string;

  /** The admin's own description: the situation the draft plays out (owner 2026-11-25). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  brief?: string;

  @IsNotEmpty()
  @IsString()
  topic: string;

  @IsOptional()
  @IsIn(CONTENT_LEVELS, {
    message: 'Cấp độ phải là Mất gốc, Cơ bản, Trung cấp hoặc Nâng cao',
  })
  level?: string;

  /** COMPREHENSION drafts short items, each with its own sentence to hear. */
  @IsIn([...LISTENING_FULL_DRAFT_MODES])
  mode: ListeningFullDraftMode;

  /**
   * Questions (1-10) for DIALOGUE and COMPREHENSION; sentences for DICTATION,
   * which the service keeps between 10 and 30.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 5))
  count?: number = 5;
}

export class SuggestReadingFullDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  sourceText?: string;

  /** The admin's own description: the situation the draft plays out (owner 2026-11-25). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  brief?: string;

  @IsNotEmpty()
  @IsString()
  topic: string;

  @IsNotEmpty()
  @IsIn(CONTENT_LEVELS)
  level: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(1000)
  targetLength?: number;

  @IsOptional()
  @IsString()
  microSkill?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 5))
  count?: number = 5;
}

/** "Tạo bằng AI" on the Writing page: email or "Dịch câu" only (owner 2026-11-19). */
export class SuggestWritingFullDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  sourceText?: string;

  /** The admin's own description: the situation the tasks play out (owner 2026-11-25). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  brief?: string;

  @IsNotEmpty({ message: 'Cần nhập chủ đề' })
  @IsString()
  @MaxLength(300)
  topic: string;

  @IsNotEmpty()
  @IsIn(CONTENT_LEVELS, {
    message: 'Cấp độ phải là Mất gốc, Cơ bản, Trung cấp hoặc Nâng cao',
  })
  level: string;

  @IsIn(['EMAIL', 'TRANSLATION'], {
    message: 'AI chỉ soạn bài Viết email hoặc Dịch câu',
  })
  kind: 'EMAIL' | 'TRANSLATION';

  /** Items the draft already holds: a "Tạo câu khác" answer never repeats them (owner 2026-11-25). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  avoid?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 5))
  count?: number = 5;
}

export class SuggestVocabFullDraftDto {
  @IsNotEmpty()
  @IsString()
  topic: string;

  /** Items the draft already holds: a "Tạo câu khác" answer never repeats them (owner 2026-11-25). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  avoid?: string[];

  @IsOptional()
  @IsIn(GRAMMAR_LEVELS)
  level?: string;

  @IsOptional()
  @IsString()
  context?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 15))
  count?: number = 15;
}

export class SuggestGrammarFullDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  sourceText?: string;

  @IsNotEmpty()
  @IsString()
  topicTitle: string;

  @IsNotEmpty()
  @IsIn(GRAMMAR_LEVELS)
  level: string;

  @IsOptional()
  @IsString()
  objective?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 10))
  count?: number = 10;
}

export class VocabDecksFromDocumentDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(20000)
  text: string;

  @IsOptional()
  @IsIn(GRAMMAR_LEVELS)
  level?: string;
}

export class SuggestDictationLinesDto {
  @IsNotEmpty()
  @IsString()
  topic: string;

  @IsOptional()
  @IsIn(CONTENT_LEVELS)
  level?: string;

  /** From 1: one replacement for a dropped sentence, or the few a draft still needs (owner 2026-11-25). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(40)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 20))
  count?: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  sourceText?: string;

  /** Sentences the lesson already has: the new ones must not repeat them. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  avoid?: string[];

  /** The admin's own description: the situation the sentences belong to. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  brief?: string;
}
