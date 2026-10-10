import { Module } from '@nestjs/common';
import { CourseService } from './course.service';
import { CourseController } from './course.controller';
import { CoursePublicController } from './course-public.controller';
import { EventsModule } from '../events/events.module';
import { PaymentModule } from '../payment/payment.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { CourseLearningV5Service } from './course-v5.service';

@Module({
  imports: [EventsModule, PaymentModule, SubscriptionModule],
  providers: [CourseService, CourseLearningV5Service],
  controllers: [CoursePublicController, CourseController],
  exports: [CourseService, CourseLearningV5Service],
})
export class CourseModule {}
