import { Module } from '@nestjs/common';
import { GrammarService } from './grammar.service';
import { GrammarController } from './grammar.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [PrismaModule, GamificationModule],
  controllers: [GrammarController],
  providers: [GrammarService],
  exports: [GrammarService],
})
export class GrammarModule {}
