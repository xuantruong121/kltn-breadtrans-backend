import { GeminiEvaluatorStrategy } from './gemini-evaluator.strategy';
import { SPEAKING_SET_COPY_RULE } from '../speaking-draft.logic';

/** A strategy whose model answers `answer`; the request it got is recorded. */
function strategyAnswering(answer: unknown) {
  const strategy = new GeminiEvaluatorStrategy() as any;
  strategy.hasKeys = () => true;
  strategy.recordUsage = jest.fn();
  const generateContent = jest.fn().mockResolvedValue({
    response: { text: () => JSON.stringify(answer) },
  });
  strategy.executeWithRotation = (run: (model: unknown) => unknown) =>
    run({ generateContent });
  const request = () => generateContent.mock.calls[0][0];
  const prompt = (): string => request().contents[0].parts[0].text;
  return { strategy, request, prompt };
}

const draftSet = {
  title: 'Phản hồi câu hỏi — Nơi công sở',
  description: 'Trả lời câu hỏi thường gặp ở văn phòng bằng câu ngắn, rõ ý.',
  level: 'B1-B2',
};
const readAloud = {
  title: 'Read Aloud B1 — Meeting Notice',
  targetText: 'The meeting starts at nine in room two.',
  difficulty: 'INTERMEDIATE',
  taskType: 'READ_ALOUD',
};

describe('Speaking full draft (QA 2026-11-22: a picture task left a half-created set)', () => {
  it('offers no picture or information task in the schema or the prompt', async () => {
    const { strategy, request, prompt } = strategyAnswering({
      practiceSet: draftSet,
      exercises: [readAloud],
    });
    await strategy.suggestSpeakingFullDraft({
      topic: 'Nơi công sở',
      level: 'B1-B2',
      count: 3,
    });
    const taskEnum: string[] =
      request().generationConfig.responseSchema.properties.exercises.items
        .properties.taskType.enum;
    expect(taskEnum).toEqual([
      'READ_ALOUD',
      'RESPOND_TO_QUESTION',
      'EXPRESS_OPINION',
      'PRONUNCIATION_DRILL',
    ]);
    expect(prompt()).toContain(
      'Never use DESCRIBE_PICTURE or RESPOND_USING_INFORMATION',
    );
  });

  it('drops a picture or information task the model returns anyway', async () => {
    const { strategy } = strategyAnswering({
      practiceSet: draftSet,
      exercises: [
        readAloud,
        { ...readAloud, title: 'Office', taskType: 'DESCRIBE_PICTURE' },
        {
          ...readAloud,
          title: 'Schedule',
          taskType: 'RESPOND_USING_INFORMATION',
        },
      ],
    });
    const draft = await strategy.suggestSpeakingFullDraft({
      topic: 'Nơi công sở',
      level: 'B1-B2',
      count: 3,
    });
    expect(draft.exercises.map((e: { title: string }) => e.title)).toEqual([
      'Read Aloud B1 — Meeting Notice',
    ]);
  });

  it('fails rather than return a draft made only of picture tasks', async () => {
    const { strategy } = strategyAnswering({
      practiceSet: draftSet,
      exercises: [{ ...readAloud, taskType: 'DESCRIBE_PICTURE' }],
    });
    await expect(
      strategy.suggestSpeakingFullDraft({
        topic: 'Nơi công sở',
        level: 'B1-B2',
        count: 1,
      }),
    ).rejects.toThrow('AI không soạn được bộ luyện nói hợp lệ');
  });

  it('asks for the set title and description in Vietnamese, in the published style', async () => {
    const { strategy, prompt } = strategyAnswering({
      practiceSet: draftSet,
      exercises: [readAloud],
    });
    await strategy.suggestSpeakingFullDraft({
      topic: 'Nơi công sở',
      level: 'B1-B2',
      count: 1,
    });
    expect(prompt()).toContain(SPEAKING_SET_COPY_RULE);
  });

  it('refuses an English set description', async () => {
    const { strategy } = strategyAnswering({
      practiceSet: {
        ...draftSet,
        description: 'Answer common questions at the office.',
      },
      exercises: [readAloud],
    });
    await expect(
      strategy.suggestSpeakingFullDraft({
        topic: 'Office',
        level: 'B1-B2',
        count: 1,
      }),
    ).rejects.toThrow('không phải tiếng Việt');
  });
});

describe('Speaking set suggestion ("Gợi ý tên & mô tả")', () => {
  it('asks for Vietnamese copy and keeps a Vietnamese answer', async () => {
    const { strategy, prompt } = strategyAnswering(draftSet);
    await expect(
      strategy.suggestSpeakingPracticeSet({
        topic: 'Office small talk',
        level: 'B1-B2',
      }),
    ).resolves.toEqual({ ...draftSet, track: null });
    expect(prompt()).toContain(SPEAKING_SET_COPY_RULE);
  });

  it('refuses an English description (QA 2026-11-22)', async () => {
    const { strategy } = strategyAnswering({
      ...draftSet,
      description: 'Practise short answers to everyday office questions.',
    });
    await expect(
      strategy.suggestSpeakingPracticeSet({
        topic: 'Office small talk',
        level: 'B1-B2',
      }),
    ).rejects.toThrow('không phải tiếng Việt');
  });
});

describe('Speaking exercise suggestions inside the form', () => {
  it('without a picked type, offers only text-only tasks and drops the rest', async () => {
    const { strategy, request } = strategyAnswering({
      candidates: [
        readAloud,
        { ...readAloud, title: 'Office', taskType: 'DESCRIBE_PICTURE' },
      ],
    });
    const result = await strategy.suggestSpeakingExercises({
      practiceSetTitle: 'Nơi công sở',
      level: 'B1-B2',
      count: 2,
    });
    expect(result.candidates.map((c: { title: string }) => c.title)).toEqual([
      'Read Aloud B1 — Meeting Notice',
    ]);
    expect(
      request().generationConfig.responseSchema.properties.candidates.items
        .properties.taskType.enum,
    ).not.toContain('DESCRIBE_PICTURE');
  });

  it('keeps the picture type the admin picked, who uploads the picture in the form', async () => {
    const picture = {
      ...readAloud,
      title: 'Describe a Picture B1 — Office',
      taskType: 'DESCRIBE_PICTURE',
    };
    const { strategy, request } = strategyAnswering({ candidates: [picture] });
    const result = await strategy.suggestSpeakingExercises({
      practiceSetTitle: 'Nơi công sở',
      level: 'B1-B2',
      taskType: 'DESCRIBE_PICTURE',
      count: 1,
    });
    expect(result.candidates).toEqual([picture]);
    expect(
      request().generationConfig.responseSchema.properties.candidates.items
        .properties.taskType.enum,
    ).toEqual(['DESCRIBE_PICTURE']);
  });
});
