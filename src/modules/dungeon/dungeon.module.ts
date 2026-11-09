import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GamificationModule } from '../gamification/gamification.module';
import { DungeonController } from './dungeon.controller';
import { DungeonService } from './dungeon.service';

/** Hầm Bánh Mì, the Arena's roguelite word game. */
@Module({
  imports: [PrismaModule, GamificationModule],
  controllers: [DungeonController],
  providers: [DungeonService],
})
export class DungeonModule {}
