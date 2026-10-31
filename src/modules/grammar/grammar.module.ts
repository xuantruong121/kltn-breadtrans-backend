import { Module } from '@nestjs/common';
import { GrammarService } from './grammar.service';
import { GrammarController } from './grammar.controller';
import { AdminGrammarController } from './admin-grammar.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [PrismaModule, GamificationModule],
  controllers: [GrammarController, AdminGrammarController],
  providers: [GrammarService],
  exports: [GrammarService],
})
export class GrammarModule {}
