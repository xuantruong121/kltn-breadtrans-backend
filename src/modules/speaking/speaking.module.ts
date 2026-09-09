import { Module } from '@nestjs/common';
import { SpeakingController } from './speaking.controller';
import { SpeakingService } from './speaking.service';
import { AiModule } from '../ai/ai.module';
import { UploadModule } from '../upload/upload.module';

import { SpeakingWorkerService } from './speaking-worker.service';

@Module({
  imports: [AiModule, UploadModule],
  controllers: [SpeakingController],
  providers: [SpeakingService, SpeakingWorkerService],
  exports: [SpeakingService, SpeakingWorkerService],
})
export class SpeakingModule {}
