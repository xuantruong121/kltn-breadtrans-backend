import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UploadModule } from '../upload/upload.module';
import { AccountController } from './account.controller';
import { AccountDeletionService } from './account-deletion.service';
import { AccountPurgeService } from './account-purge.service';

/** Self-service account deletion and the purge that carries it out (owner 2026-11-16). */
@Module({
  imports: [PrismaModule, AuthModule, UploadModule],
  controllers: [AccountController],
  providers: [AccountDeletionService, AccountPurgeService],
  exports: [AccountPurgeService],
})
export class AccountModule {}
