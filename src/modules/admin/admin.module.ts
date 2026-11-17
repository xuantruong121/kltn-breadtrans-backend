import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminDictionaryService } from './admin-dictionary.service';
import { RetentionMetricsService } from './retention-metrics.service';
import { AiReviewCostsService } from './ai-review-costs.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { UploadModule } from '../upload/upload.module';
import { AuthModule } from '../auth/auth.module';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [PrismaModule, UploadModule, AuthModule, AccountModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminDictionaryService,
    RetentionMetricsService,
    AiReviewCostsService,
  ],
})
export class AdminModule {}
