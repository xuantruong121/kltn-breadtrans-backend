import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { ReadingModule } from '../reading/reading.module';
import { QuizModule } from '../quiz/quiz.module';
import { SpeakingModule } from '../speaking/speaking.module';
import { AdaptiveDailyPracticeService } from './adaptive-daily-practice.service';

import { LocationModule } from '../location/location.module';

@Module({
  imports: [ReadingModule, QuizModule, SpeakingModule, LocationModule],
  providers: [UserService, AdaptiveDailyPracticeService],
  controllers: [UserController],
})
export class UserModule {}
