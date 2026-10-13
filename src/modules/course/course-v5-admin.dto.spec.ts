import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateV5QuestionDto, CreateV5SectionDto } from './course-v5-admin.dto';

describe('Course V5 DTO payload fields', () => {
  it('keeps section content and question correctAnswer with whitelist validation', async () => {
    const section = plainToInstance(CreateV5SectionDto, {
      type: 'THEORY',
      heading: 'Routine rule',
      content: { body: 'Used for repeated actions.' },
    });
    const question = plainToInstance(CreateV5QuestionDto, {
      prompt: 'I ___ to school every day.',
      options: ['go', 'goes'],
      correctAnswer: 'go',
      explanation: 'Use the base verb after I.',
    });

    expect(await validate(section, { whitelist: true })).toHaveLength(0);
    expect(await validate(question, { whitelist: true })).toHaveLength(0);
    expect(section.content).toEqual({ body: 'Used for repeated actions.' });
    expect(question.correctAnswer).toBe('go');
  });
});
