import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ListeningQuestionDto, SkillContentDto } from './skill-cms.dto';

const dto = (content: Record<string, unknown>) =>
  plainToInstance(ListeningQuestionDto, { type: 'MULTIPLE_CHOICE', content });

describe('ListeningQuestionDto content', () => {
  it('accepts the published shape (object explanation, accent, level, skill, voiceKey)', async () => {
    const errors = await validate(
      dto({
        text: 'What does she order?',
        accent: 'US',
        level: 'A2',
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
