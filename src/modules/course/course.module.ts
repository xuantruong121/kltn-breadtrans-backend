import { Module } from '@nestjs/common';
import { CourseService } from './course.service';
import { CourseController } from './course.controller';
import { CoursePublicController } from './course-public.controller';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  providers: [CourseService],
  controllers: [CoursePublicController, CourseController],
  exports: [CourseService],
})
export class CourseModule {}
