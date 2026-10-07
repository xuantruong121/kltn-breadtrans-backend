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
  PaginatedPlanPurchasesDto,
  PlanPurchaseAdminDto,
  PlanPurchaseQueryDto,
  RejectPlanPurchaseDto,
} from './dto/plan-purchase.dto';
import { PlanPurchaseService } from './plan-purchase.service';

type AdminRequest = { user: { id: number } };

@ApiTags('admin-plan-purchases')
@ApiBearerAuth()
@Controller('admin/plan-purchases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PlanPurchaseAdminController {
  constructor(private readonly purchaseService: PlanPurchaseService) {}

  @Get()
  @ApiOperation({ summary: 'List and filter manual plan purchases' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedPlanPurchasesDto })
  list(
    @Query() query: PlanPurchaseQueryDto,
  ): Promise<PaginatedPlanPurchasesDto> {
    return this.purchaseService.listAdminPurchases(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Inspect one plan purchase/payment report' })
  @ApiResponse({ status: HttpStatus.OK, type: PlanPurchaseAdminDto })
  get(@Param('id', ParseIntPipe) id: number): Promise<PlanPurchaseAdminDto> {
    return this.purchaseService.getAdminPurchase(id);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm transfer and atomically activate access' })
  @ApiResponse({ status: HttpStatus.OK, type: PlanPurchaseAdminDto })
  confirm(
    @Param('id', ParseIntPipe) id: number,
    @Request() request: AdminRequest,
  ): Promise<PlanPurchaseAdminDto> {
    return this.purchaseService.confirmPurchase(id, request.user.id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a reported manual plan transfer' })
  @ApiResponse({ status: HttpStatus.OK, type: PlanPurchaseAdminDto })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectPlanPurchaseDto,
    @Request() request: AdminRequest,
  ): Promise<PlanPurchaseAdminDto> {
    return this.purchaseService.rejectPurchase(
      id,
      request.user.id,
      dto.rejectionReason,
    );
  }
}
