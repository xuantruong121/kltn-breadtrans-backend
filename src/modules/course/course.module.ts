import { Module } from '@nestjs/common';
import { CourseService } from './course.service';
import { CourseController } from './course.controller';
import { CoursePublicController } from './course-public.controller';
import { EventsModule } from '../events/events.module';
import { PaymentModule } from '../payment/payment.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [EventsModule, PaymentModule, SubscriptionModule],
  providers: [CourseService],
  controllers: [CoursePublicController, CourseController],
  exports: [CourseService],
})
export class CourseModule {}
