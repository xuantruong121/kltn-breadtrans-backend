import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UploadModule } from '../upload/upload.module';
import { SuggestionController } from './suggestion.controller';
import { AdminSuggestionController } from './admin-suggestion.controller';
import { SuggestionService } from './suggestion.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, AuthModule, UploadModule, NotificationsModule],
  controllers: [SuggestionController, AdminSuggestionController],
  providers: [SuggestionService],
})
export class SuggestionModule {}
