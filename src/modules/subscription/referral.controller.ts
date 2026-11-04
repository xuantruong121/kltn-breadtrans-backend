import {
  Body,
  Controller,
  Get,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReferralService, type ReferralSummary } from './referral.service';

class ClaimReferralDto {
  @ApiProperty({ example: 'BT-7KQ4M2' })
  @IsString()
  @MaxLength(20)
  code!: string;
}

class ReferralSummaryDto implements ReferralSummary {
  @ApiProperty({ example: 'BT-7KQ4M2' }) code!: string;
  @ApiProperty({ description: 'Learners who entered this code' })
  invited!: number;
  @ApiProperty({ description: 'Of them, those who paid (both got the reward)' })
  rewarded!: number;
  @ApiProperty({ example: 7 }) rewardDays!: number;
  @ApiProperty({ nullable: true, type: Object })
  invitedBy!: { status: 'PENDING' | 'REWARDED' } | null;
  @ApiProperty() canClaim!: boolean;
}

type StudentRequest = { user: { id: number } };

@ApiTags('referrals')
@ApiBearerAuth()
@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralController {
  constructor(private readonly referrals: ReferralService) {}

  @Get('me')
  @ApiOperation({ summary: 'My invite code and how many friends it brought' })
  @ApiResponse({ status: HttpStatus.OK, type: ReferralSummaryDto })
  mine(@Request() request: StudentRequest): Promise<ReferralSummary> {
    return this.referrals.summary(request.user.id);
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Enter the code of the friend who invited me (new accounts, before the first payment)',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ReferralSummaryDto })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Refused, with the reason',
  })
  claim(
    @Body() dto: ClaimReferralDto,
    @Request() request: StudentRequest,
  ): Promise<ReferralSummary> {
    return this.referrals.claim(request.user.id, dto.code);
  }
}
