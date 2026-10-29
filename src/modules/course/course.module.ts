import { Module } from '@nestjs/common';
import { CourseService } from './course.service';
import { CourseController } from './course.controller';
import { CoursePublicController } from './course-public.controller';
import { EventsModule } from '../events/events.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { CourseLearningV5Service } from './course-v5.service';
import { CourseV5AdminController } from './course-v5-admin.controller';
import { CourseV5AdminService } from './course-v5-admin.service';
import { UploadModule } from '../upload/upload.module';
import { AiModule } from '../ai/ai.module';
import { CourseAiAuthoringService } from './course-ai-authoring.service';
import { CourseMediaSearchService } from './course-media-search.service';
import { CourseAiWorkspaceService } from './course-ai-workspace.service';
import { ImageSearchProviderChain } from '../toeic/image-search.provider-chain';
import { PixabayImageSearchProvider } from '../toeic/pixabay-image-search.provider';
import { OpenverseImageSearchProvider } from '../toeic/openverse-image-search.provider';
import { WikimediaCommonsImageSearchProvider } from '../toeic/wikimedia-commons-image-search.provider';

@Module({
  imports: [EventsModule, SubscriptionModule, UploadModule, AiModule],
  providers: [
    CourseService,
    CourseLearningV5Service,
    CourseV5AdminService,
    CourseAiAuthoringService,
    CourseAiWorkspaceService,
    CourseMediaSearchService,
    PixabayImageSearchProvider,
    OpenverseImageSearchProvider,
    WikimediaCommonsImageSearchProvider,
    ImageSearchProviderChain,
  ],
  controllers: [
    CoursePublicController,
    CourseController,
    CourseV5AdminController,
  ],
  exports: [CourseService, CourseLearningV5Service],
})
export class CourseModule {}
