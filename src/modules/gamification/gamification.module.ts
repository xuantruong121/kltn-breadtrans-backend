import { Module } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { GamificationController } from './gamification.controller';
import { GamificationListener } from './gamification.listener';

@Module({
  providers: [GamificationService, GamificationListener],
  controllers: [GamificationController],
  exports: [GamificationService],
})
export class GamificationModule {}
