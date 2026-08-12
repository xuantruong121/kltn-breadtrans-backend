import { Module } from '@nestjs/common';
import { ToeicService } from './toeic.service';
import { ToeicController } from './toeic.controller';

@Module({
  controllers: [ToeicController],
  providers: [ToeicService],
})
export class ToeicModule {}
