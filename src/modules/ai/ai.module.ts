import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { CloudflareWorkersAiClient } from './cloudflare-workers-ai.client';
import { AnswerReviewService } from './review/answer-review.service';
import { DocumentTextService } from './document-text.service';
import { AdminContextualAiController } from './admin-contextual-ai.controller';
import { GeminiEvaluatorStrategy } from './strategies/gemini-evaluator.strategy';
import { AI_EVALUATOR_TOKEN } from './strategies/ai-evaluator.interface';
import { GeminiModelRouter } from './gemini/gemini-model-router';
import { GeminiCredentialManager } from './gemini/gemini-credential-manager.service';
import { AiImageSemanticValidator } from './ai-image-semantic-validator.service';
import { UploadModule } from '../upload/upload.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SpeakingCategoryService } from '../content/speaking-category.service';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TutorService } from './tutor.service';
import { MistakesModule } from '../mistakes/mistakes.module';
import { TutorContextService } from './tutor-context.service';

@Module({
  imports: [UploadModule, PrismaModule, SubscriptionModule, MistakesModule],
  controllers: [AiController, AdminContextualAiController],
  providers: [
    AiService,
    DocumentTextService,
    SpeakingCategoryService,
    GeminiModelRouter,
    GeminiCredentialManager,
    AiImageSemanticValidator,
    CloudflareWorkersAiClient,
    AnswerReviewService,
    TutorContextService,
    TutorService,
    {
      provide: AI_EVALUATOR_TOKEN,
      useClass: GeminiEvaluatorStrategy,
    },
  ],
  exports: [
    AiService,
    DocumentTextService,
    GeminiModelRouter,
    GeminiCredentialManager,
    AiImageSemanticValidator,
    AnswerReviewService,
    TutorService,
  ],
})
export class AiModule {}
