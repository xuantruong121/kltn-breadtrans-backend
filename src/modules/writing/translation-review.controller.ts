import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TranslationReviewService } from './translation-review.service';

class TranslationReviewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

class TranslationDecisionDto {
  @IsInt()
  @Min(1)
  questionId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  answer!: string;
}

@ApiTags('admin-translation-answers')
@Controller('admin/translation-answers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class TranslationReviewController {
  constructor(private readonly service: TranslationReviewService) {}

  @Get()
  @ApiOperation({
    summary: 'Câu dịch AI chấm đúng nhưng chưa có trong đáp án mẫu',
  })
  list(@Query() query: TranslationReviewQueryDto) {
    return this.service.list(query);
  }

  @Post('approve')
  @ApiOperation({ summary: 'Thêm câu dịch vào đáp án mẫu của câu' })
  approve(@Body() body: TranslationDecisionDto) {
    return this.service.approve(body.questionId, body.answer);
  }

  @Post('dismiss')
  @ApiOperation({ summary: 'Bỏ qua câu dịch, không hiện lại trong hàng đợi' })
  dismiss(@Body() body: TranslationDecisionDto) {
    return this.service.dismiss(body.questionId, body.answer);
  }
}
