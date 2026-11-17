import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccountDeletionService } from './account-deletion.service';

export class RequestDeletionDto {
  @ApiPropertyOptional({
    description: 'Mật khẩu hiện tại (tài khoản có mật khẩu).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;

  @ApiPropertyOptional({
    description:
      'Email của tài khoản, gõ lại để xác nhận (tài khoản chỉ đăng nhập Google).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  confirmEmail?: string;
}

export class CancelDeletionDto {
  @ApiProperty({
    description: 'Mã huỷ nhận được khi đăng nhập lúc tài khoản đang chờ xoá.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  cancelToken: string;
}

@ApiTags('account')
@Controller('account')
export class AccountController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('deletion')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Yêu cầu xoá tài khoản: khoá và đăng xuất ngay, xoá vĩnh viễn sau 7 ngày',
  })
  @ApiResponse({ status: 200, description: 'Đã hẹn ngày xoá.' })
  @ApiResponse({ status: 401, description: 'Mật khẩu không đúng.' })
  requestDeletion(@Body() dto: RequestDeletionDto, @Request() req: any) {
    return this.deletion.request(req.user.id, dto);
  }

  @Post('deletion/cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Huỷ yêu cầu xoá tài khoản bằng mã huỷ' })
  @ApiResponse({ status: 200, description: 'Đã huỷ yêu cầu xoá.' })
  @ApiResponse({ status: 401, description: 'Mã huỷ hết hạn.' })
  cancelDeletion(@Body() dto: CancelDeletionDto) {
    return this.deletion.cancel(dto.cancelToken);
  }
}
