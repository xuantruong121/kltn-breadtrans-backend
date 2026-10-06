import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
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
  CreatePlanEntitlementDto,
  CreatePlanVersionDto,
  PlanCatalogAdminDto,
  PlanEntitlementAdminDto,
  PlanVersionAdminDto,
  UpdatePlanEntitlementDto,
  UpdatePlanVersionDto,
} from './dto/plan-catalog-admin.dto';
import { PlanCatalogAdminService } from './plan-catalog-admin.service';

type AdminRequest = { user: { id: number } };

@ApiTags('admin-plan-catalog')
@ApiBearerAuth()
@Controller('admin/plan-catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PlanCatalogAdminController {
  constructor(private readonly catalog: PlanCatalogAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Inspect plans, versions and entitlements' })
  @ApiResponse({ status: HttpStatus.OK, type: [PlanCatalogAdminDto] })
  list(): Promise<PlanCatalogAdminDto[]> {
    return this.catalog.listCatalog();
  }

  @Get('plans/:code')
  @ApiOperation({ summary: 'Inspect one plan history' })
  @ApiResponse({ status: HttpStatus.OK, type: PlanCatalogAdminDto })
  getPlan(@Param('code') code: string): Promise<PlanCatalogAdminDto> {
    return this.catalog.getPlan(code);
  }

  @Get('versions/:id')
  @ApiOperation({ summary: 'Inspect one plan version' })
  @ApiResponse({ status: HttpStatus.OK, type: PlanVersionAdminDto })
  getVersion(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PlanVersionAdminDto> {
    return this.catalog.getVersion(id);
  }

  @Post('plans/:code/versions')
  @ApiOperation({
    summary: 'Create a non-current DRAFT version for PLUS or PRO',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: PlanVersionAdminDto })
  createDraft(
    @Param('code') code: string,
    @Body() dto: CreatePlanVersionDto,
    @Request() request: AdminRequest,
  ): Promise<PlanVersionAdminDto> {
    return this.catalog.createDraft(code, dto, request.user.id);
  }

  @Patch('versions/:id')
  @ApiOperation({ summary: 'Edit terms of a non-current DRAFT version' })
  @ApiResponse({ status: HttpStatus.OK, type: PlanVersionAdminDto })
  updateDraft(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePlanVersionDto,
    @Request() request: AdminRequest,
  ): Promise<PlanVersionAdminDto> {
    return this.catalog.updateDraft(id, dto, request.user.id);
  }

  @Get('versions/:id/entitlements')
  @ApiOperation({ summary: 'List DRAFT or historical entitlements' })
  @ApiResponse({ status: HttpStatus.OK, type: [PlanEntitlementAdminDto] })
  listEntitlements(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PlanEntitlementAdminDto[]> {
    return this.catalog.listEntitlements(id);
  }

  @Post('versions/:id/entitlements')
  @ApiOperation({ summary: 'Add an entitlement to a DRAFT version' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PlanEntitlementAdminDto })
  createEntitlement(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePlanEntitlementDto,
    @Request() request: AdminRequest,
  ): Promise<PlanEntitlementAdminDto> {
    return this.catalog.createEntitlement(id, dto, request.user.id);
  }

  @Patch('versions/:id/entitlements/:entitlementId')
  @ApiOperation({ summary: 'Edit a DRAFT entitlement' })
  @ApiResponse({ status: HttpStatus.OK, type: PlanEntitlementAdminDto })
  updateEntitlement(
    @Param('id', ParseIntPipe) id: number,
    @Param('entitlementId', ParseIntPipe) entitlementId: number,
    @Body() dto: UpdatePlanEntitlementDto,
    @Request() request: AdminRequest,
  ): Promise<PlanEntitlementAdminDto> {
    return this.catalog.updateEntitlement(
      id,
      entitlementId,
      dto,
      request.user.id,
    );
  }

  @Delete('versions/:id/entitlements/:entitlementId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an entitlement from a DRAFT version' })
  deleteEntitlement(
    @Param('id', ParseIntPipe) id: number,
    @Param('entitlementId', ParseIntPipe) entitlementId: number,
    @Request() request: AdminRequest,
  ): Promise<{ deleted: true }> {
    return this.catalog.deleteEntitlement(id, entitlementId, request.user.id);
  }

  @Post('versions/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate and atomically publish a DRAFT version' })
  publish(
    @Param('id', ParseIntPipe) id: number,
    @Request() request: AdminRequest,
  ): Promise<PlanVersionAdminDto> {
    return this.catalog.publish(id, request.user.id);
  }

  @Post('versions/:id/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a DRAFT before publication' })
  @ApiResponse({ status: HttpStatus.OK, type: PlanVersionAdminDto })
  validate(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PlanVersionAdminDto> {
    return this.catalog.validate(id);
  }

  @Post('versions/:id/retire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retire a non-current historical version' })
  retire(
    @Param('id', ParseIntPipe) id: number,
    @Request() request: AdminRequest,
  ): Promise<PlanVersionAdminDto> {
    return this.catalog.retire(id, request.user.id);
  }
}
