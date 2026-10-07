import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreatePlanPurchaseDto,
  PlanPurchaseResponseDto,
} from './dto/plan-purchase.dto';
import { PlanPurchaseService } from './plan-purchase.service';

type StudentRequest = { user: { id: number } };

@ApiTags('plan-purchases')
@ApiBearerAuth()
@Controller('plan-purchases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STUDENT)
export class PlanPurchaseController {
  constructor(private readonly purchaseService: PlanPurchaseService) {}

  @Post()
  @ApiOperation({ summary: 'Create or resume a fixed-duration plan purchase' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PlanPurchaseResponseDto })
  create(
    @Body() dto: CreatePlanPurchaseDto,
    @Request() request: StudentRequest,
  ): Promise<PlanPurchaseResponseDto> {
    return this.purchaseService.createPurchase(
      request.user.id,
      dto.planVersionId,
      dto.idempotencyKey,
    );
  }

  @Get('me')
  @ApiOperation({ summary: 'List the authenticated student plan purchases' })
  @ApiResponse({ status: HttpStatus.OK, type: [PlanPurchaseResponseDto] })
  listMine(
    @Request() request: StudentRequest,
  ): Promise<PlanPurchaseResponseDto[]> {
    return this.purchaseService.getMyPurchases(request.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one owned plan purchase' })
  @ApiResponse({ status: HttpStatus.OK, type: PlanPurchaseResponseDto })
  getMine(
    @Param('id', ParseIntPipe) id: number,
    @Request() request: StudentRequest,
  ): Promise<PlanPurchaseResponseDto> {
    return this.purchaseService.getMyPurchase(request.user.id, id);
  }

  @Post(':id/replace-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supersede an active payment and create a new one' })
  @ApiResponse({ status: HttpStatus.OK, type: PlanPurchaseResponseDto })
  replacePayment(
    @Param('id', ParseIntPipe) id: number,
    @Request() request: StudentRequest,
  ): Promise<PlanPurchaseResponseDto> {
    return this.purchaseService.replacePayment(request.user.id, id);
  }

  @Post(':id/report-transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Report a manual bank transfer for review' })
  @ApiResponse({ status: HttpStatus.OK, type: PlanPurchaseResponseDto })
  reportTransfer(
    @Param('id', ParseIntPipe) id: number,
    @Request() request: StudentRequest,
  ): Promise<PlanPurchaseResponseDto> {
    return this.purchaseService.reportTransfer(request.user.id, id);
  }
}
