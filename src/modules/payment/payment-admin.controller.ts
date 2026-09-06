import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { PaymentService } from './payment.service';
import {
  AdminPaymentFilterDto,
  PaginatedAdminPaymentsDto,
  AdminPaymentDetailDto,
  RejectPaymentDto,
} from './dto/payment-admin.dto';

@ApiTags('admin-payments')
@Controller('admin/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(Role.ADMIN)
export class PaymentAdminController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get()
  @ApiOperation({
    summary:
      'Admin lấy danh sách thanh toán và hàng đợi kiểm tra (Review Queue)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách thanh toán phân trang phục vụ đối soát',
    type: PaginatedAdminPaymentsDto,
  })
  getAdminPayments(
    @Query() query: AdminPaymentFilterDto,
  ): Promise<PaginatedAdminPaymentsDto> {
    return this.paymentService.getAdminPayments(query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Admin lấy chi tiết đối soát thanh toán kèm ngữ cảnh ghi danh và lớp học',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Chi tiết đối soát thanh toán an toàn',
    type: AdminPaymentDetailDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Không tìm thấy thông tin thanh toán',
  })
  getAdminPaymentDetail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdminPaymentDetailDto> {
    return this.paymentService.getAdminPaymentDetail(id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Admin từ chối thanh toán đã báo chuyển khoản kèm lý do nội bộ (REPORTED -> REJECTED)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      'Từ chối thanh toán thành công, ghi nhận người duyệt và thời gian',
    type: AdminPaymentDetailDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Không tìm thấy thông tin thanh toán',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'Thanh toán không ở trạng thái REPORTED hoặc đã bị từ chối trước đó',
  })
  rejectPayment(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
    @Body() dto: RejectPaymentDto,
  ): Promise<AdminPaymentDetailDto> {
    return this.paymentService.rejectPayment(id, req.user.id, dto);
  }
}
