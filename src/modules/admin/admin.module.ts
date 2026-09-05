import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { UploadModule } from '../upload/upload.module';
import { CourseModule } from '../course/course.module';

@Module({
  imports: [PrismaModule, UploadModule, CourseModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
