import { Module } from '@nestjs/common';
import { SpeakingProcessingModule } from '../modules/speaking/speaking-processing.module';
import { SpeakingWorkerRunnerService } from './speaking-worker-runner.service';

/**
 * Standalone Worker root module.
 * Strictly isolates worker runtime: zero HTTP controllers, zero Swagger,
 * zero EventsGateway, zero schedulers.
 */
@Module({
  imports: [SpeakingProcessingModule],
  providers: [SpeakingWorkerRunnerService],
})
export class SpeakingWorkerModule {}
