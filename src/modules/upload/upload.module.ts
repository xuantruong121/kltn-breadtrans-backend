import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { R2Service } from './r2.service';

@Module({
  controllers: [UploadController],
  providers: [UploadService, R2Service],
  exports: [UploadService, R2Service],
})
export class UploadModule {}
