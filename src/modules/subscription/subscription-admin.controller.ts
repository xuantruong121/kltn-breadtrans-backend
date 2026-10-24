import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AdminActivePlanDto,
  AdminExtendSubscriptionDto,
  AdminGrantSubscriptionDto,
  AdminLearnerLookupDto,
  AdminRevokeSubscriptionDto,
  AdminSubscriptionEventDto,
  AdminSubscriptionItemDto,
  AdminSubscriptionQueryDto,
  PaginatedAdminSubscriptionsDto,
} from './dto/admin-subscription.dto';
import { SubscriptionAdminService } from './subscription-admin.service';

type AdminRequest = { user: { id: number } };

@ApiTags('admin-subscriptions')
@ApiBearerAuth()
@Controller('admin/subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class SubscriptionAdminController {
  constructor(
    private readonly subscriptionAdminService: SubscriptionAdminService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Danh sách quyền học viên kèm bộ lọc',
  })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedAdminSubscriptionsDto })
  list(
    @Query() query: AdminSubscriptionQueryDto,
  ): Promise<PaginatedAdminSubscriptionsDto> {
    return this.subscriptionAdminService.listSubscriptions(query);
  }

  @Get('plans')
  @ApiOperation({ summary: 'Danh sách các gói nâng cấp đang mở để Admin tặng' })
  @ApiResponse({ status: HttpStatus.OK, type: [AdminActivePlanDto] })
  getActivePlans(): Promise<AdminActivePlanDto[]> {
    return this.subscriptionAdminService.getActivePlans();
  }

  @Get('learners')
  @ApiOperation({ summary: 'Tra cứu học viên cho modal tặng gói' })
  @ApiResponse({ status: HttpStatus.OK, type: [AdminLearnerLookupDto] })
  searchLearners(@Query('q') query?: string): Promise<AdminLearnerLookupDto[]> {
    return this.subscriptionAdminService.searchLearners(query);
  }

  @Post('grant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Admin tặng gói nâng cấp cho học viên (không sinh bản ghi thanh toán)',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AdminSubscriptionItemDto })
  grant(
    @Request() request: AdminRequest,
    @Body() dto: AdminGrantSubscriptionDto,
  ): Promise<AdminSubscriptionItemDto> {
    return this.subscriptionAdminService.grantSubscription(
      request.user.id,
      dto,
    );
  }

  @Post(':id/extend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Admin gia hạn gói nâng cấp đang hoạt động (bảo toàn ngày còn lại)',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AdminSubscriptionItemDto })
  extend(
    @Param('id', ParseIntPipe) id: number,
    @Request() request: AdminRequest,
    @Body() dto: AdminExtendSubscriptionDto,
  ): Promise<AdminSubscriptionItemDto> {
    return this.subscriptionAdminService.extendSubscription(
      request.user.id,
      id,
      dto,
    );
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin thu hồi quyền gói của học viên (không xóa bản ghi)',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AdminSubscriptionItemDto })
  revoke(
    @Param('id', ParseIntPipe) id: number,
    @Request() request: AdminRequest,
    @Body() dto: AdminRevokeSubscriptionDto,
  ): Promise<AdminSubscriptionItemDto> {
    return this.subscriptionAdminService.revokeSubscription(
      request.user.id,
      id,
      dto,
    );
  }

  @Get(':id/history')
  @ApiOperation({
    summary: 'Lịch sử kiểm toán của một gói học viên (audit history timeline)',
  })
  @ApiResponse({ status: HttpStatus.OK, type: [AdminSubscriptionEventDto] })
  getHistory(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdminSubscriptionEventDto[]> {
    return this.subscriptionAdminService.getSubscriptionHistory(id);
  }

  @Get('user/:userId/history')
  @ApiOperation({
    summary: 'Toàn bộ lịch sử gói nâng cấp của một học viên',
  })
  @ApiResponse({ status: HttpStatus.OK, type: [AdminSubscriptionEventDto] })
  getLearnerHistory(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<AdminSubscriptionEventDto[]> {
    return this.subscriptionAdminService.getLearnerHistory(userId);
  }
}
