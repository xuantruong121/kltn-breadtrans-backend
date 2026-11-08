import { RewardEligibilityService } from './reward-eligibility';
import { Module } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { GamificationController } from './gamification.controller';
import { GamificationListener } from './gamification.listener';
import { RankingController } from './ranking.controller';
import { RankingService } from './ranking.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [
    GamificationService,
    GamificationListener,
    RewardEligibilityService,
    RankingService,
  ],
  controllers: [GamificationController, RankingController],
  exports: [
    GamificationService,
    GamificationListener,
    RewardEligibilityService,
  ],
})
export class GamificationModule {}
