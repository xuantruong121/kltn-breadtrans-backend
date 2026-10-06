import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EffectivePlan, SubscriptionService } from './subscription.service';

@ApiTags('subscriptions')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('me')
  @ApiOperation({ summary: 'Lấy gói và quyền hiệu lực của tài khoản hiện tại' })
  getMyEffectivePlan(
    @Request() request: { user: { id: number } },
  ): Promise<EffectivePlan> {
    return this.subscriptionService.resolveEffectivePlan(request.user.id);
  }
}
