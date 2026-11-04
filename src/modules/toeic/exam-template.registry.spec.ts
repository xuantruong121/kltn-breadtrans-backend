import {
  EXAM_TEMPLATES,
  lrPaperSeconds,
  templateTotalMinutes,
} from './exam-template.registry';

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
