import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  ListeningQuestionDto,
  SkillContentDto,
  SkillTracksDto,
  SpeakingExerciseDto,
} from './skill-cms.dto';

const dto = (content: Record<string, unknown>) =>
  plainToInstance(ListeningQuestionDto, { type: 'MULTIPLE_CHOICE', content });

describe('ListeningQuestionDto content', () => {
  it('accepts the published shape (object explanation, accent, level, skill, voiceKey)', async () => {
    const errors = await validate(
      dto({
        text: 'What does she order?',
        accent: 'US',
        level: 'BASIC',
        skill: 'LISTENING',
        imageUrl: 'https://cdn/picture.png',
        explanation: { vi: 'Cô ấy gọi cà phê.', en: 'She orders coffee.' },
        transcriptSegments: [
          {
            speaker: 'Anna',
            text: 'Coffee, please.',
            voiceKey: 'en-us-female-01',
          },
        ],
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(errors).toEqual([]);
  });

  it('still rejects an array explanation and an unknown accent', async () => {
    const errors = await validate(dto({ explanation: ['x'], accent: 'AU' }));
    expect(errors[0].children?.map((e) => e.property).sort()).toEqual([
      'accent',
      'explanation',
    ]);
  });
});

describe('SkillContentDto bilingualContent', () => {
  const content = (bilingualContent: unknown) =>
    validate(
      plainToInstance(SkillContentDto, { title: 'Quiz', bilingualContent }),
    );

  it('accepts the listening metadata object the CMS sends', async () => {
    expect(
      await content({ mode: 'DIALOGUE', levels: ['C1'], accents: ['US'] }),
    ).toEqual([]);
  });

  it('accepts a reading paragraph array and rejects a string', async () => {
    expect(await content([{ en: 'Hi', vi: 'Chào' }])).toEqual([]);
    expect((await content('DIALOGUE'))[0].property).toBe('bilingualContent');
  });
});

describe('Speaking DTOs carry no category (2026-11-21)', () => {
  const strict = { whitelist: true, forbidNonWhitelisted: true };

  it('refuses a category on a set or an exercise when asked to be strict', async () => {
    const set = await validate(
      plainToInstance(SkillContentDto, { title: 'Bộ', category: 'GENERAL' }),
      strict,
    );
    expect(set.map((e) => e.property)).toEqual(['category']);
    const exercise = await validate(
      plainToInstance(SpeakingExerciseDto, {
        title: 'Câu',
        targetText: 'Hello.',
        category: 'BUSINESS',
      }),
      strict,
    );
    expect(exercise.map((e) => e.property)).toEqual(['category']);
  });
});

describe('SkillTracksDto', () => {
  const tracks = (value: unknown) =>
    validate(plainToInstance(SkillTracksDto, { tracks: value }));

  it('takes track codes, not only the six old ones', async () => {
    expect(await tracks(['GENERAL', 'Y_TE_DIEU_DUONG'])).toEqual([]);
    expect(await tracks([])).toEqual([]);
  });

  it('refuses malformed, repeated or too many codes', async () => {
    expect(await tracks(['y te'])).not.toEqual([]);
    expect(await tracks(['GENERAL', 'GENERAL'])).not.toEqual([]);
    expect(
      await tracks(Array.from({ length: 21 }, (_, i) => `T_${i}`)),
    ).not.toEqual([]);
  });
});
