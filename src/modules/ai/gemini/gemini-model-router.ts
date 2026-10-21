import { Injectable } from '@nestjs/common';

/** Keep this deliberately small: it describes the capability required by a task,
 * not every product feature that happens to call Gemini. */
export enum AiTaskType {
  TEXT_AUTHORING = 'TEXT_AUTHORING',
  STRUCTURED_AUTHORING = 'STRUCTURED_AUTHORING',
  SIMPLE_EVALUATION = 'SIMPLE_EVALUATION',
  IMAGE_SEMANTIC_VALIDATION = 'IMAGE_SEMANTIC_VALIDATION',
  IMAGE_TO_CONTENT = 'IMAGE_TO_CONTENT',
  WRITING_PICTURE_EVALUATION = 'WRITING_PICTURE_EVALUATION',
  IMAGE_GENERATION = 'IMAGE_GENERATION',
}

export const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-3.5-flash-lite';

export type GeminiModelPolicy = {
  taskType: AiTaskType;
  model: string;
  capability: 'TEXT' | 'VISION' | 'IMAGE_GENERATION';
};

@Injectable()
export class GeminiModelRouter {
  readonly textModel =
    process.env.GEMINI_MODEL_NAME?.trim() || DEFAULT_GEMINI_TEXT_MODEL;
  readonly visionModel =
    process.env.GEMINI_VISION_MODEL?.trim() || this.textModel;
  readonly imageModelOptional =
    process.env.GEMINI_IMAGE_MODEL_NAME?.trim() ||
    'gemini-3.1-flash-lite-image';

  selectModel(taskType: AiTaskType): GeminiModelPolicy {
    switch (taskType) {
      case AiTaskType.IMAGE_SEMANTIC_VALIDATION:
      case AiTaskType.IMAGE_TO_CONTENT:
      case AiTaskType.WRITING_PICTURE_EVALUATION:
        return { taskType, model: this.visionModel, capability: 'VISION' };
      case AiTaskType.IMAGE_GENERATION:
        return {
          taskType,
          model: this.imageModelOptional,
          capability: 'IMAGE_GENERATION',
        };
      default:
        return { taskType, model: this.textModel, capability: 'TEXT' };
    }
  }
}
