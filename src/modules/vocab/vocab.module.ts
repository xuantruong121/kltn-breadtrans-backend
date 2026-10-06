import { Module } from '@nestjs/common';
import { VocabController } from './vocab.controller';
import { VocabService } from './vocab.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { DictionaryLookupService } from './dictionary-lookup.service';
import { AiModule } from '../ai/ai.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [PrismaModule, AiModule, SubscriptionModule],
  controllers: [VocabController],
  providers: [VocabService, DictionaryLookupService],
  exports: [VocabService],
})
export class VocabModule {}
