import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListeningQuestionDto, WritingQuestionDto } from './skill-cms.dto';

describe('Skill CMS DTOs', () => {
  it('validates structured Listening dialogue turns', async () => {
    const dto = plainToInstance(ListeningQuestionDto, {
      type: 'DIALOGUE',
      content: {
        transcriptSegments: [
          { speaker: 'Customer', text: 'Hello.' },
          { speaker: 'Agent', text: 'How can I help?' },
        ],
      },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects invalid Listening transcript fields', async () => {
    const dto = plainToInstance(ListeningQuestionDto, {
      type: 'DIALOGUE',
      content: {
        transcriptSegments: [{ speaker: '', text: '' }],
      },
    });

    const errors = await validate(dto);
    expect(errors.flatMap((error) => error.children ?? [])).not.toHaveLength(0);
  });

  it('validates Writing task metadata and numeric constraints', async () => {
    const valid = plainToInstance(WritingQuestionDto, {
      type: 'WRITING',
      prompt: 'Write an email.',
      taskType: 'EMAIL',
      wordRange: [100, 130],
      sampleSentences: ['Dear team,'],
    });
    expect(await validate(valid)).toHaveLength(0);

    const invalid = plainToInstance(WritingQuestionDto, {
      type: 'WRITING',
      prompt: 'Write an email.',
      wordRange: [100, 130, 140],
    });
    expect(await validate(invalid)).not.toHaveLength(0);
  });
});
