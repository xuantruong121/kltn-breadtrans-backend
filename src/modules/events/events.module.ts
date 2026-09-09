import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { ArenaGateway } from './arena.gateway';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { SupportModule } from '../support/support.module';

@Module({
  imports: [PrismaModule, AuthModule, SupportModule],
  providers: [EventsGateway, ArenaGateway],
  exports: [EventsGateway, ArenaGateway],
})
export class EventsModule {}
