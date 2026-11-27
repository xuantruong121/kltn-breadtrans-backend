import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SuggestSpeakingFullDraftDto } from './dto/contextual-ai.dto';
import {
  SPEAKING_DRAFT_TASK_TYPES,
  SPEAKING_SET_COPY_RULE,
  cleanSpeakingCandidates,
  exerciseSuggestionTaskTypes,
  fullDraftTaskTypes,
  isVietnameseText,
  speakingTaskTypeRule,
} from './speaking-draft.logic';

const candidate = (over: Record<string, unknown> = {}) => ({
  title: ' Greeting ',
  targetText: ' Hello, nice to meet you. ',
  difficulty: 'STARTER',
  taskType: 'READ_ALOUD',
  ...over,
});

describe('Speaking AI drafts write only task types the CMS can save', () => {
  it('keeps picture and information tasks out of every draft', () => {
    expect(SPEAKING_DRAFT_TASK_TYPES).toEqual([
      'READ_ALOUD',
      'RESPOND_TO_QUESTION',
      'EXPRESS_OPINION',
      'PRONUNCIATION_DRILL',
    ]);
  });

  it('a full draft ignores a requested picture or information task', () => {
    expect(fullDraftTaskTypes('EXPRESS_OPINION')).toEqual(['EXPRESS_OPINION']);
    expect(fullDraftTaskTypes('DESCRIBE_PICTURE')).toEqual(
      SPEAKING_DRAFT_TASK_TYPES,
    );
    expect(fullDraftTaskTypes('RESPOND_USING_INFORMATION')).toEqual(
      SPEAKING_DRAFT_TASK_TYPES,
    );
    expect(fullDraftTaskTypes()).toEqual(SPEAKING_DRAFT_TASK_TYPES);
  });

  it('form suggestions keep the type the admin picked, who adds its media there', () => {
    expect(exerciseSuggestionTaskTypes('DESCRIBE_PICTURE')).toEqual([
      'DESCRIBE_PICTURE',
    ]);
    expect(exerciseSuggestionTaskTypes()).toEqual(SPEAKING_DRAFT_TASK_TYPES);
  });

  it('drops a candidate of a type outside the allowed list (backstop)', () => {
    expect(
      cleanSpeakingCandidates(
        [
          candidate(),
          candidate({ title: 'Office', taskType: 'DESCRIBE_PICTURE' }),
          candidate({
            title: 'Schedule',
            taskType: 'RESPOND_USING_INFORMATION',
          }),
          candidate({ title: 'Easy', difficulty: 'Easy' }),
          candidate({ targetText: '   ' }),
          null,
        ],
        SPEAKING_DRAFT_TASK_TYPES,
      ),
    ).toEqual([
      {
        title: 'Greeting',
        targetText: 'Hello, nice to meet you.',
        difficulty: 'STARTER',
        taskType: 'READ_ALOUD',
      },
    ]);
    expect(
      cleanSpeakingCandidates('not a list', SPEAKING_DRAFT_TASK_TYPES),
    ).toEqual([]);
  });

  it('names the allowed types in the prompt and forbids the media ones', () => {
    const rule = speakingTaskTypeRule(SPEAKING_DRAFT_TASK_TYPES);
    expect(rule).toContain('READ_ALOUD, RESPOND_TO_QUESTION');
    expect(rule).toContain(
      'Never use DESCRIBE_PICTURE or RESPOND_USING_INFORMATION',
    );
    expect(speakingTaskTypeRule(['EXPRESS_OPINION'])).toBe(
      'Every candidate uses taskType EXPRESS_OPINION.',
    );
  });

  it('the full-draft request refuses a picture or information task type', async () => {
    const errors = await validate(
      plainToInstance(SuggestSpeakingFullDraftDto, {
        topic: 'Văn phòng',
        level: 'INTERMEDIATE',
        taskType: 'DESCRIBE_PICTURE',
      }),
    );
    expect(errors.map((error) => error.property)).toEqual(['taskType']);
    expect(Object.values(errors[0].constraints ?? {})[0]).toContain(
      'mô tả tranh',
    );
    await expect(
      validate(
        plainToInstance(SuggestSpeakingFullDraftDto, {
          topic: 'Văn phòng',
          level: 'INTERMEDIATE',
          taskType: 'READ_ALOUD',
        }),
      ),
    ).resolves.toEqual([]);
  });
});

describe('Speaking set copy is Vietnamese', () => {
  it('asks for a Vietnamese title in the published style and a Vietnamese description', () => {
    expect(SPEAKING_SET_COPY_RULE).toContain(
      'title and description in Vietnamese',
    );
    expect(SPEAKING_SET_COPY_RULE).toContain(
      'Đọc thành tiếng — Ngữ cảnh công việc',
    );
    expect(SPEAKING_SET_COPY_RULE).toContain(
      'only exercise targetText is English',
    );
  });

  it('tells a Vietnamese description from an English one', () => {
    expect(isVietnameseText('Luyện nói trong các tình huống quen thuộc.')).toBe(
      true,
    );
    expect(isVietnameseText('Đi chợ')).toBe(true);
    expect(isVietnameseText('Practise everyday conversations.')).toBe(false);
  });
});
