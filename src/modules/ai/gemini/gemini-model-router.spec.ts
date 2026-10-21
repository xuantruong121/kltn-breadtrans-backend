import { AiTaskType, GeminiModelRouter } from './gemini-model-router';

describe('GeminiModelRouter', () => {
  const previousText = process.env.GEMINI_MODEL_NAME;
  const previousVision = process.env.GEMINI_VISION_MODEL;

  beforeEach(() => {
    process.env.GEMINI_MODEL_NAME = 'text-model';
    process.env.GEMINI_VISION_MODEL = 'vision-model';
  });
  afterAll(() => {
    process.env.GEMINI_MODEL_NAME = previousText;
    process.env.GEMINI_VISION_MODEL = previousVision;
  });

  it.each([
    AiTaskType.TEXT_AUTHORING,
    AiTaskType.STRUCTURED_AUTHORING,
    AiTaskType.SIMPLE_EVALUATION,
  ])('routes %s to the configured text model', (taskType) => {
    expect(new GeminiModelRouter().selectModel(taskType).model).toBe(
      'text-model',
    );
  });

  it.each([
    AiTaskType.IMAGE_SEMANTIC_VALIDATION,
    AiTaskType.IMAGE_TO_CONTENT,
    AiTaskType.WRITING_PICTURE_EVALUATION,
  ])('routes %s to the configured vision model', (taskType) => {
    expect(new GeminiModelRouter().selectModel(taskType).model).toBe(
      'vision-model',
    );
  });
});
