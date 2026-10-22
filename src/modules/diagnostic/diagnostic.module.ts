import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DiagnosticController } from './diagnostic.controller';
import { DiagnosticService } from './diagnostic.service';
import { DiagnosticSpeakingService } from './diagnostic-speaking.service';
import { AiModule } from '../ai/ai.module';
import { UploadModule } from '../upload/upload.module';
import { DiagnosticSpeakingAudioNormalizer } from './diagnostic-speaking-audio-normalizer';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [PrismaModule, AiModule, UploadModule, GamificationModule],
  controllers: [DiagnosticController],
  providers: [
    DiagnosticService,
    DiagnosticSpeakingService,
    DiagnosticSpeakingAudioNormalizer,
  ],
  exports: [DiagnosticSpeakingService],
})
export class DiagnosticModule {}
