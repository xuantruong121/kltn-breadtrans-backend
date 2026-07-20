import { Module } from '@nestjs/common';
import { WritingController } from './writing.controller';
import { WritingService } from './writing.service';
import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [AiModule, PrismaModule],
  controllers: [WritingController],
  providers: [WritingService],
})
export class WritingModule {}
