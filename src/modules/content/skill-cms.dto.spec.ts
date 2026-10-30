import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ListeningQuestionDto } from './skill-cms.dto';

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
