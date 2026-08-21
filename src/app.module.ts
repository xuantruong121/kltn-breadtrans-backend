import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { WritingModule } from './modules/writing/writing.module';
import { VocabModule } from './modules/vocab/vocab.module';
import { ToeicModule } from './modules/toeic/toeic.module';
import { ClassModule } from './modules/class/class.module';
import { EventsModule } from './modules/events/events.module';
import { AdminModule } from './modules/admin/admin.module';
import { AssignmentModule } from './modules/assignment/assignment.module';
import { GrammarModule } from './modules/grammar/grammar.module';
import { MarketModule } from './modules/market/market.module';
import { ContentModule } from './modules/content/content.module';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TeacherModule } from './modules/teacher/teacher.module';
import { LoggingMiddleware } from './common/middleware/logging.middleware';
import { RedisModule } from '@nestjs-modules/ioredis';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    RedisModule.forRoot({
      type: 'single',
      url: 'redis://localhost:6379',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
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
    WritingModule,
    VocabModule,
    ToeicModule,
    ClassModule,
    EventsModule,
    AdminModule,
    AssignmentModule,
    GrammarModule,
    MarketModule,
    ContentModule,
    NotificationsModule,
    TeacherModule,
  ],

  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
