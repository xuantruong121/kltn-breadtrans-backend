import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GamificationModule } from '../gamification/gamification.module';
import { WordBlasterController } from './word-blaster.controller';
import { WordBlasterService } from './word-blaster.service';

/** Pháo Bánh Mì, the Arena's single-player word game. */
@Module({
  imports: [PrismaModule, GamificationModule],
  controllers: [WordBlasterController],
  providers: [WordBlasterService],
})
export class WordBlasterModule {}
