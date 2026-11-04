import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
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
  CreatePromoCodeDto,
  PromoCodeAdminDto,
  PromoCodeQueryDto,
  UpdatePromoCodeDto,
} from './dto/promo-code-admin.dto';
import { PromoCodeAdminService } from './promo-code-admin.service';

type AdminRequest = { user: { id: number } };

@ApiTags('admin-promo-codes')
@ApiBearerAuth()
@Controller('admin/promo-codes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PromoCodeAdminController {
  constructor(private readonly promoCodes: PromoCodeAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List promo codes with their usage' })
  @ApiResponse({ status: HttpStatus.OK, type: [PromoCodeAdminDto] })
  list(@Query() query: PromoCodeQueryDto): Promise<PromoCodeAdminDto[]> {
    return this.promoCodes.list(query.source);
  }

  @Post()
  @ApiOperation({ summary: 'Create a promo code' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PromoCodeAdminDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Code exists' })
  create(
    @Body() dto: CreatePromoCodeDto,
    @Request() request: AdminRequest,
  ): Promise<PromoCodeAdminDto> {
    return this.promoCodes.create(dto, request.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Switch a promo code on or off' })
  @ApiResponse({ status: HttpStatus.OK, type: PromoCodeAdminDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Unknown code' })
  setActive(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePromoCodeDto,
  ): Promise<PromoCodeAdminDto> {
    return this.promoCodes.setActive(id, dto.active);
  }
}
