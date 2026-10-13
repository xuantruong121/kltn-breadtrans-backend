import { Module } from '@nestjs/common';
import { CourseService } from './course.service';
import { CourseController } from './course.controller';
import { CoursePublicController } from './course-public.controller';
import { EventsModule } from '../events/events.module';
import { PaymentModule } from '../payment/payment.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { CourseLearningV5Service } from './course-v5.service';
import { CourseV5AdminController } from './course-v5-admin.controller';
import { CourseV5AdminService } from './course-v5-admin.service';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [EventsModule, PaymentModule, SubscriptionModule, UploadModule],
  providers: [CourseService, CourseLearningV5Service, CourseV5AdminService],
  controllers: [
    CoursePublicController,
    CourseController,
    CourseV5AdminController,
  ],
  exports: [CourseService, CourseLearningV5Service],
})
export class CourseModule {}
