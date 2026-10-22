import { Module } from '@nestjs/common';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [PrismaModule, GamificationModule],
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
