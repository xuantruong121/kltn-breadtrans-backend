import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { CourseModule } from './modules/course/course.module';
import { QuizModule } from './modules/quiz/quiz.module';
import { AiModule } from './modules/ai/ai.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { UploadModule } from './modules/upload/upload.module';
import { SpeakingModule } from './modules/speaking/speaking.module';
import { PrismaModule } from './prisma/prisma.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ReadingModule } from './modules/reading/reading.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    AuthModule,
    UserModule,
    CourseModule,
    QuizModule,
    AiModule,
    GamificationModule,
    UploadModule,
    SpeakingModule,
    PrismaModule,
    ReadingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
