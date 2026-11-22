import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  SuggestDictationLinesDto,
  SuggestListeningFullDraftDto,
  SuggestReadingFullDraftDto,
} from './contextual-ai.dto';

/**
 * The CMS level select offers A1 to C2; the AI forms refused C2 with 400
 * until 2026-11-22 (owner: "sửa luôn 2 lỗi đó đi").
 */
describe('AI content levels', () => {
  const levelErrors = async <T extends object>(
    cls: new () => T,
    body: Record<string, unknown>,
  ) =>
    (await validate(plainToInstance(cls, body)))
      .filter((error) => error.property === 'level')
      .map((error) => Object.values(error.constraints ?? {}).join(' '));

  it('accepts C2 in the listening and reading full drafts and the dictation lines', async () => {
    expect(
      await levelErrors(SuggestListeningFullDraftDto, {
        topic: 'Hỏi đường',
        level: 'C2',
        mode: 'COMPREHENSION',
        count: 3,
      }),
    ).toEqual([]);
    expect(
      await levelErrors(SuggestReadingFullDraftDto, {
        topic: 'Biến đổi khí hậu',
        level: 'C2',
      }),
    ).toEqual([]);
    expect(
      await levelErrors(SuggestDictationLinesDto, {
        topic: 'Du lịch',
        level: 'C2',
      }),
    ).toEqual([]);
  });

  it('still refuses a level outside A1 to C2, and says which ones are allowed', async () => {
    const errors = await levelErrors(SuggestListeningFullDraftDto, {
      topic: 'Hỏi đường',
      level: 'C3',
      mode: 'COMPREHENSION',
      count: 3,
    });
    expect(errors).toEqual(['Cấp độ phải thuộc A1, A2, B1, B2, C1 hoặc C2']);
  });
});
