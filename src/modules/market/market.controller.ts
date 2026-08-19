import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { MarketService } from './market.service';
import { CreateMarketOrderDto } from './dto/create-order.dto';
import { AdjustCurrencyDto } from './dto/adjust-currency.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Market & Currency')
@Controller('market')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Get('products')
  @ApiOperation({ summary: 'Lấy danh sách vật phẩm trong Cửa Hàng Bánh Mì' })
  getProducts() {
    return this.marketService.getProducts();
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('currency/balance')
  @ApiOperation({
    summary: 'Lấy số dư Bánh Mì và thông tin Gamification của tôi',
  })
  getCurrencyBalance(@Request() req: any) {
    return this.marketService.getCurrencyBalance(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('currency/history')
  @ApiOperation({ summary: 'Lấy lịch sử giao dịch Bánh Mì của tôi' })
  getCurrencyHistory(@Request() req: any) {
    return this.marketService.getCurrencyHistory(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('orders')
  @ApiOperation({ summary: 'Đặt hàng đổi vật phẩm bằng Bánh Mì' })
  createOrder(@Request() req: any, @Body() dto: CreateMarketOrderDto) {
    return this.marketService.createOrder(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('orders/mine')
  @ApiOperation({ summary: 'Lấy danh sách đơn hàng đã đổi của học viên' })
  getMyOrders(@Request() req: any) {
    return this.marketService.getMyOrders(req.user.id);
  }

  // Admin APIs
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Get('orders')
  @ApiOperation({ summary: '[Admin] Lấy toàn bộ danh sách đơn hàng đổi quà' })
  getAllOrders() {
    return this.marketService.getAllOrders();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Patch('orders/:id/review')
  @ApiOperation({ summary: '[Admin] Phê duyệt hoặc từ chối đơn hàng' })
  reviewOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: 'approved' | 'rejected',
    @Request() req: any,
  ) {
    return this.marketService.reviewOrder(
      id,
      status,
      req.user.email || 'Admin',
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post('currency/adjust')
  @ApiOperation({ summary: '[Admin] Cộng/trừ Bánh Mì thủ công cho học viên' })
  adjustCurrency(@Body() dto: AdjustCurrencyDto, @Request() req: any) {
    return this.marketService.adjustCurrency(dto, req.user.email || 'Admin');
  }
}
