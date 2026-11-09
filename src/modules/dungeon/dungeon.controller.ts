import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DungeonAnswerDto,
  DungeonPickDto,
  FinishDungeonDto,
  StartDungeonDto,
} from './dto/dungeon.dto';
import { DungeonService } from './dungeon.service';

@ApiTags('dungeon')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('games/dungeon')
export class DungeonController {
  constructor(private readonly dungeon: DungeonService) {}

  @Post('start')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Vào Hầm Bánh Mì (mua vé), hoặc trả về lượt đang chơi',
  })
  @ApiResponse({
    status: 200,
    description: 'Lượt chơi: quái, câu hỏi (không có đáp án)',
  })
  @ApiResponse({
    status: 400,
    description: 'Không đủ Bánh Mì, hoặc đã chơi Hầm hôm nay',
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  start(@Request() req: any, @Body() dto: StartDungeonDto) {
    return this.dungeon.start(req.user.id, dto.mode);
  }

  @Get('current')
  @ApiOperation({ summary: 'Lượt Hầm Bánh Mì đang chơi của học viên, nếu có' })
  @ApiResponse({ status: 200, description: 'Lượt đang chơi hoặc null' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  current(@Request() req: any) {
    return this.dungeon.current(req.user.id);
  }

  @Get('board')
  @ApiOperation({ summary: 'Bảng xếp hạng Hầm hôm nay và kỷ lục của học viên' })
  @ApiResponse({
    status: 200,
    description: 'Top 20 hôm nay, hạng và kỷ lục của mình',
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  board(@Request() req: any) {
    return this.dungeon.board(req.user.id);
  }

  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @Post(':id/answer')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Trả lời câu đang hỏi; không gửi gì nghĩa là hết giờ',
  })
  @ApiResponse({
    status: 200,
    description: 'Kết quả câu vừa trả lời và trạng thái lượt',
  })
  @ApiResponse({ status: 403, description: 'Không phải lượt của học viên' })
  @ApiResponse({
    status: 404,
    description: 'Lượt không tồn tại hoặc đã hết hạn',
  })
  answer(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: DungeonAnswerDto,
  ) {
    return this.dungeon.answer(req.user.id, id, dto);
  }

  @Post(':id/pick')
  @HttpCode(200)
  @ApiOperation({ summary: 'Chọn topping sau khi qua tầng, xuống tầng tiếp' })
  @ApiResponse({ status: 200, description: 'Tầng mới và câu hỏi đầu tiên' })
  @ApiResponse({ status: 400, description: 'Topping không có trong lựa chọn' })
  @ApiResponse({ status: 403, description: 'Không phải lượt của học viên' })
  pick(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: DungeonPickDto,
  ) {
    return this.dungeon.pick(req.user.id, id, dto.topping);
  }

  @Post(':id/finish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rời hầm (chốt ở tầng hiện tại) hoặc chốt lượt đã kết thúc',
  })
  @ApiResponse({
    status: 200,
    description: 'Trạng thái lượt, kèm kết quả nếu đã chốt',
  })
  @ApiResponse({ status: 403, description: 'Không phải lượt của học viên' })
  @ApiResponse({
    status: 404,
    description: 'Lượt không tồn tại hoặc đã hết hạn',
  })
  finish(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: FinishDungeonDto,
  ) {
    return this.dungeon.finish(req.user.id, id, Boolean(dto.forfeit));
  }
}
