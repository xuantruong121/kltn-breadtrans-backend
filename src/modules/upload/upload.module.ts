import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { R2Service } from './r2.service';
import { R2CleanupService } from './r2-cleanup.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UploadController],
  providers: [UploadService, R2Service, R2CleanupService],
  exports: [UploadService, R2Service, R2CleanupService],
})
export class UploadModule {}
