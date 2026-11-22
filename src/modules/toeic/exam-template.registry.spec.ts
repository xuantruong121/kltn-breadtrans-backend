import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  EXAM_TEMPLATES,
  examTypeChangeRefusal,
  lrPaperSeconds,
  PART_PRACTICE_CLOSED,
  templateTotalMinutes,
} from './exam-template.registry';
import { CreateGenericExamDto } from './generic-exam.dto';
import { CreateToeicAiExamDto } from './toeic-ai-exam.dto';

const messagesOf = async <T extends object>(cls: new () => T, body: object) =>
  (await validate(plainToInstance(cls, body))).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

describe('a new exam is a full test (owner 2026-11-22)', () => {
  it('the create form takes a full test or no type, never a part practice', async () => {
    expect(
      await messagesOf(CreateGenericExamDto, {
        title: 'Đề',
        type: 'FULL_TEST',
      }),
    ).toEqual([]);
    expect(await messagesOf(CreateGenericExamDto, { title: 'Đề' })).toEqual([]);
    expect(
      await messagesOf(CreateGenericExamDto, {
        title: 'Đề',
        type: 'PRACTICE_BY_PART',
      }),
    ).toEqual([PART_PRACTICE_CLOSED]);
  });

  it('the AI drafts a whole exam only', async () => {
    expect(
      await messagesOf(CreateToeicAiExamDto, { variantCode: 'TOEIC_LR' }),
    ).toEqual([]);
    const refused = await messagesOf(CreateToeicAiExamDto, {
      variantCode: 'TOEIC_LR',
      mode: 'PART',
      part: 5,
    });
    expect(refused).toContain(
      'AI chỉ soạn đề hoàn chỉnh; Part chưa tốt thì tạo lại ngay trong bản nháp.',
    );
  });

  it('a draft keeps its format or becomes a full test, never a part practice', () => {
    expect(examTypeChangeRefusal('FULL_TEST', undefined)).toBeNull();
    expect(examTypeChangeRefusal('FULL_TEST', 'FULL_TEST')).toBeNull();
    expect(
      examTypeChangeRefusal('PRACTICE_BY_PART', 'PRACTICE_BY_PART'),
    ).toBeNull();
    expect(examTypeChangeRefusal('PRACTICE_BY_PART', 'FULL_TEST')).toBeNull();
    expect(examTypeChangeRefusal('FULL_TEST', 'PRACTICE_BY_PART')).toBe(
      PART_PRACTICE_CLOSED,
    );
  });
});

const template = (variantCode: string) =>
  EXAM_TEMPLATES.find((candidate) => candidate.variantCode === variantCode)!;

describe('exam length by product', () => {
  it('follows the ETS structure: L&R 120, S&W 80, 4 skills 200 minutes', () => {
    expect(templateTotalMinutes(template('TOEIC_LR'))).toBe(120);
    expect(templateTotalMinutes(template('TOEIC_SW'))).toBe(80);
    expect(templateTotalMinutes(template('TOEIC_4_SKILLS'))).toBe(200);
  });

  it('gives a full test the ETS length of its L&R paper and ignores the form', () => {
    expect(lrPaperSeconds('TOEIC_LR', 'FULL_TEST', 2700)).toBe(7200);
    expect(lrPaperSeconds('TOEIC_4_SKILLS', 'FULL_TEST', 2700)).toBe(7200);
  });

  it('keeps the requested length of an L&R part practice', () => {
    expect(lrPaperSeconds('TOEIC_LR', 'PRACTICE_BY_PART', 4500)).toBe(4500);
    expect(lrPaperSeconds('TOEIC_LR', 'PRACTICE_BY_PART')).toBe(2700);
  });

  it('refuses part practice outside Listening & Reading', () => {
    expect(() => lrPaperSeconds('TOEIC_4_SKILLS', 'PRACTICE_BY_PART')).toThrow(
      'Chỉ đề Listening & Reading có loại luyện tập theo Part',
    );
  });
});
