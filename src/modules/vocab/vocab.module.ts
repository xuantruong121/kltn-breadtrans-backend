import { Module } from '@nestjs/common';
import { VocabController } from './vocab.controller';
import { VocabService } from './vocab.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { DictionaryLookupService } from './dictionary-lookup.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [VocabController],
  providers: [VocabService, DictionaryLookupService],
  exports: [VocabService],
})
export class VocabModule {}
