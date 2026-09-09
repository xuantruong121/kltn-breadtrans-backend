import { Module } from '@nestjs/common';
import { ToeicService } from './toeic.service';
import { ToeicController } from './toeic.controller';
import { SpeakingModule } from '../speaking/speaking.module';

@Module({
  imports: [SpeakingModule],
  controllers: [ToeicController],
  providers: [ToeicService],
})
export class ToeicModule {}
