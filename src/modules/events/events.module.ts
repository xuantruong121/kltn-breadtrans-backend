import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { ArenaGateway } from './arena.gateway';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [EventsGateway, ArenaGateway],
  exports: [EventsGateway, ArenaGateway],
})
export class EventsModule {}
