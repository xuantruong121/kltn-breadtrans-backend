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
/**
 * Tried once when the main model is overloaded or out of quota on every key
 * (owner 2026-11-24: a 503 "high demand" on gemini-3.5-flash-lite stopped the
 * CMS drafts). Capacity and quota are per model; on 24/11 the lite models
 * (3.5 and 3.1) were overloaded at times while gemini-3.5-flash answered, and
 * the 2.5 models returned 404 for these keys. It reads images too, so it also
 * stands in for the vision model. GEMINI_FALLBACK_MODEL_NAME overrides it.
 */
export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash';

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

  /**
   * The model to try when `policy.model` cannot answer: the configured or
   * default fallback, or, when that is the model that failed, the default
   * text model. Image generation has none.
   */
  fallbackFor(policy: GeminiModelPolicy): GeminiModelPolicy | null {
    if (policy.capability === 'IMAGE_GENERATION') return null;
    const candidates = [
      process.env.GEMINI_FALLBACK_MODEL_NAME?.trim() ||
        DEFAULT_GEMINI_FALLBACK_MODEL,
      DEFAULT_GEMINI_TEXT_MODEL,
    ];
    const model = candidates.find((name) => name && name !== policy.model);
    return model ? { ...policy, model } : null;
  }

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
