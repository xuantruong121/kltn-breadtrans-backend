import { Injectable } from '@nestjs/common';
import { AiService } from './ai.service';
import type {
  AiImageSemanticValidationInput,
  AiImageSemanticValidationResult,
} from './strategies/ai-evaluator.interface';

/** Semantic output is advisory only; domain services retain Draft/Publish authority. */
@Injectable()
export class AiImageSemanticValidator {
  constructor(private readonly ai: AiService) {}

  async validate(
    input: AiImageSemanticValidationInput,
  ): Promise<AiImageSemanticValidationResult> {
    try {
      return await this.ai.validateImageSemantic(input);
    } catch {
      return {
        status: 'UNAVAILABLE',
        confidence: 0,
        description:
          'Không thể xác nhận ảnh tự động. Vui lòng kiểm tra thủ công.',
        visibleFacts: [],
        issues: [],
        rejectionReasons: [],
      };
    }
  }
}
