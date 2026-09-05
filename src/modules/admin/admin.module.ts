import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { UploadModule } from '../upload/upload.module';
import { CourseModule } from '../course/course.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, UploadModule, CourseModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
