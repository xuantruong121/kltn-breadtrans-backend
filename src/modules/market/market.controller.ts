import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  Request,
  Headers,
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
  createOrder(
    @Request() req: any,
    @Body() dto: CreateMarketOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException(
        'Thiếu header Idempotency-Key. Client phải sinh một UUID cho mỗi lần bấm đổi quà và gửi lại đúng UUID đó khi thử lại.',
      );
    }
    return this.marketService.createOrder(req.user.id, dto, idempotencyKey);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get(['orders/my', 'orders/mine'])
  @ApiOperation({ summary: 'Lấy danh sách đơn hàng đã đổi của học viên' })
  getMyOrders(@Request() req: any) {
    return this.marketService.getMyOrders(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('inventory')
  @ApiOperation({ summary: 'Lấy kho đồ vật phẩm đã sở hữu của tôi' })
  getInventory(@Request() req: any) {
    return this.marketService.getInventory(req.user.id);
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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Patch('orders/:id/mark-fulfillment-failed')
  @ApiOperation({
    summary:
      '[Admin] Đánh dấu một đơn ĐÃ DUYỆT nhưng giao/thực hiện thất bại — hoàn Bánh Mì + tồn kho',
  })
  markFulfillmentFailed(
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason: string,
    @Request() req: any,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException(
        'Vui lòng nhập lý do giao/thực hiện thất bại',
      );
    }
    return this.marketService.markFulfillmentFailed(
      id,
      reason.trim(),
      req.user.email || 'Admin',
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Get('reconciliation')
  @ApiOperation({
    summary:
      '[Admin, read-only] Đối soát UserStats.totalBanhRan so với SUM(BanhTransaction.amount) từng học viên',
  })
  getReconciliationReport() {
    return this.marketService.getReconciliationReport();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post('reconciliation/correct')
  @ApiOperation({
    summary:
      '[Admin] Chạy đúng 1 lần đối soát lịch sử cho danh sách userId được chỉ định — chỉ ghi thêm 1 dòng BanhTransaction bù trừ, KHÔNG đổi UserStats.totalBanhRan. An toàn khi gọi lại (idempotent).',
  })
  runLegacyReconciliation(@Body('userIds') userIds: number[]) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new BadRequestException(
        'Vui lòng chỉ định danh sách userId cần đối soát',
      );
    }
    return this.marketService.runLegacyReconciliation(userIds);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Get('ledger/summary')
  @ApiOperation({
    summary:
      '[Admin] Tổng quan Sổ Bánh Mì: tổng số dư, tổng đã phát hành, tổng đã sử dụng',
  })
  getLedgerSummary() {
    return this.marketService.getLedgerSummary();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Get('ledger')
  @ApiOperation({
    summary: '[Admin] Danh sách giao dịch Bánh Mì (BanhTransaction) có lọc',
  })
  listLedgerTransactions(
    @Query('userId') userId?: string,
    @Query('direction') direction?: 'earning' | 'spending',
    @Query('source') source?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.marketService.listLedgerTransactions({
      userId: userId ? Number(userId) : undefined,
      direction,
      source,
      dateFrom,
      dateTo,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Get('ledger/user/:userId')
  @ApiOperation({
    summary:
      '[Admin] Lịch sử Bánh Mì đầy đủ của 1 học viên (từ BanhTransaction, không phải sổ cũ)',
  })
  getUserLedgerHistory(@Param('userId', ParseIntPipe) userId: number) {
    return this.marketService.getUserLedgerHistory(userId);
  }
}
