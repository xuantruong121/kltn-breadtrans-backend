import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  IsIn,
  IsArray,
  Min,
  Max,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  SPEAKING_SET_LEVELS,
  SPEAKING_TASK_TYPES,
} from '../../speaking/speaking-contract';
import type { SpeakingTaskType } from '../../speaking/speaking-contract';

const CONTENT_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
const GRAMMAR_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
const COURSE_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;

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
  @IsIn(COURSE_LEVELS, { message: 'Cấp độ ngữ cảnh từ vựng không hợp lệ' })
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
  @IsIn(CONTENT_LEVELS, { message: 'Cấp độ phải thuộc A1, A2, B1, B2 hoặc C1' })
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
  @IsIn(CONTENT_LEVELS, { message: 'Cấp độ phải thuộc A1, A2, B1, B2 hoặc C1' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  level?: string;

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
  @IsIn(CONTENT_LEVELS, { message: 'Cấp độ phải thuộc A1, A2, B1, B2 hoặc C1' })
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

  @IsOptional()
  @IsInt({ message: 'Số lượng câu hỏi phải là số nguyên' })
  @Min(1, { message: 'Số lượng câu hỏi tối thiểu là 1' })
  @Max(10, { message: 'Số lượng câu hỏi tối đa là 10' })
  @Transform(({ value }) => (value !== undefined ? Number(value) : 5))
  count?: number = 5;
}

export class SuggestCourseCurriculumDto {
  @IsNotEmpty({ message: 'Tên khóa học không được để trống' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  courseTitle: string;

  @IsOptional()
  @IsIn(COURSE_LEVELS, { message: 'Cấp độ khóa học không hợp lệ' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  level?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 5))
  targetLessonCount?: number = 5;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  existingLessonTitles?: string[];
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
  @IsIn(CONTENT_LEVELS, { message: 'Cấp độ phải thuộc A1, A2, B1, B2 hoặc C1' })
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
  @IsIn(CONTENT_LEVELS, { message: 'Cấp độ phải thuộc A1, A2, B1, B2 hoặc C1' })
  level?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 3))
  count?: number = 3;
}

export class SuggestWritingTaskDto {
  @IsNotEmpty({ message: 'Loại bài Writing không được để trống' })
  @IsString()
  taskType: string;

  @IsOptional()
  @IsIn(CONTENT_LEVELS, { message: 'Cấp độ phải thuộc A1, A2, B1, B2 hoặc C1' })
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

  @IsString()
  category: string;

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

  @IsString()
  category: string;

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
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  topic: string;

  @IsIn(SPEAKING_LEVELS)
  level: string;

  @IsString()
  category: string;

  @IsOptional()
  @IsString()
  objective?: string;

  @IsOptional()
  @IsIn([...SPEAKING_TASK_TYPES])
  taskType?: SpeakingTaskType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 5))
  count?: number = 5;
}

export class SuggestListeningFullDraftDto {
  @IsNotEmpty()
  @IsString()
  topic: string;

  @IsOptional()
  @IsIn(CONTENT_LEVELS, { message: 'Cấp độ phải thuộc A1, A2, B1, B2 hoặc C1' })
  level?: string;

  @IsIn(['DIALOGUE', 'DICTATION'])
  mode: 'DIALOGUE' | 'DICTATION';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 5))
  count?: number = 5;
}

export class SuggestReadingFullDraftDto {
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

export class SuggestVocabFullDraftDto {
  @IsNotEmpty()
  @IsString()
  topic: string;

  @IsOptional()
  @IsIn(COURSE_LEVELS)
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
