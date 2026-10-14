import { Module } from '@nestjs/common';
import { ToeicService } from './toeic.service';
import { ToeicController } from './toeic.controller';
import { AdminExamService } from './admin-exam.service';
import { AdminExamController } from './admin-exam.controller';
import { SpeakingModule } from '../speaking/speaking.module';

@Module({
  imports: [SpeakingModule],
  controllers: [ToeicController, AdminExamController],
  providers: [ToeicService, AdminExamService],
  exports: [ToeicService, AdminExamService],
})
export class ToeicModule {}
