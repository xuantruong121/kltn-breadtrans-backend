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
  BlasterShotDto,
  FinishBlasterDto,
  StartBlasterDto,
} from './dto/word-blaster.dto';
import { WordBlasterService } from './word-blaster.service';

@ApiTags('word-blaster')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('games/word-blaster')
export class WordBlasterController {
  constructor(private readonly blaster: WordBlasterService) {}

  @Post('start')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mở ván Bắn chữ rơi (trừ cược), hoặc trả về ván đang mở',
  })
  @ApiResponse({
    status: 200,
    description: 'Ván chơi: các khối chữ, không có đáp án',
  })
  @ApiResponse({
    status: 400,
    description: 'Mức cược sai hoặc không đủ Bánh Mì',
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  start(@Request() req: any, @Body() dto: StartBlasterDto) {
    return this.blaster.start(req.user.id, dto.stake);
  }

  @Get('current')
  @ApiOperation({ summary: 'Ván Bắn chữ rơi đang mở của học viên, nếu có' })
  @ApiResponse({ status: 200, description: 'Ván đang mở hoặc null' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  current(@Request() req: any) {
    return this.blaster.current(req.user.id);
  }

  // A fast typist sends a few answers a second; the global limit is 100/min.
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @Post(':id/shot')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gửi một đáp án; máy chủ quyết định khối nào vỡ' })
  @ApiResponse({
    status: 200,
    description: 'Khối trúng (nếu có) và trạng thái ván',
  })
  @ApiResponse({ status: 403, description: 'Không phải ván của học viên' })
  @ApiResponse({
    status: 404,
    description: 'Ván không tồn tại hoặc đã hết hạn',
  })
  shot(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: BlasterShotDto,
  ) {
    return this.blaster.shot(req.user.id, id, dto.text);
  }

  @Post(':id/finish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Kết thúc ván: kiểm lại khi ván đã hết, hoặc thoát (xử thua)',
  })
  @ApiResponse({
    status: 200,
    description: 'Trạng thái ván, kèm kết quả nếu đã chốt',
  })
  @ApiResponse({ status: 403, description: 'Không phải ván của học viên' })
  @ApiResponse({
    status: 404,
    description: 'Ván không tồn tại hoặc đã hết hạn',
  })
  finish(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: FinishBlasterDto,
  ) {
    return this.blaster.finish(req.user.id, id, Boolean(dto.forfeit));
  }
}
