import {
  Controller,
  Get,
  Post,
  Param,
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
  StudentPaymentSummaryDto,
  StudentPaymentDetailDto,
} from './dto/payment.dto';

@ApiTags('payments')
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(Role.STUDENT)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * Static route /payments/me declared BEFORE :id route
   * to guarantee that 'me' is never parsed as a numeric parameter.
   */
  @Get('me')
  @ApiOperation({ summary: 'Lấy danh sách các khoản thanh toán của học viên' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách thanh toán an toàn của học viên',
    type: [StudentPaymentSummaryDto],
  })
  getMyPayments(@Request() req: any): Promise<StudentPaymentSummaryDto[]> {
    return this.paymentService.getMyPayments(req.user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Lấy chi tiết khoản thanh toán cùng hướng dẫn chuyển khoản và VietQR',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Chi tiết thanh toán an toàn kèm hướng dẫn chuyển khoản',
    type: StudentPaymentDetailDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Không tìm thấy thanh toán hoặc không thuộc quyền sở hữu',
  })
  getPaymentById(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ): Promise<StudentPaymentDetailDto> {
    return this.paymentService.getPaymentDetailById(id, req.user.id);
  }

  @Post(':id/report-transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Học viên báo đã chuyển khoản thành công (PENDING -> REPORTED)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Báo chuyển khoản thành công hoặc phản hồi idempotent',
    type: StudentPaymentDetailDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Không tìm thấy thanh toán hoặc không thuộc quyền sở hữu',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'Thanh toán không ở trạng thái PENDING (ví dụ CONFIRMED/REJECTED)',
  })
  reportTransfer(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ): Promise<StudentPaymentDetailDto> {
    return this.paymentService.reportTransfer(id, req.user.id);
  }
}
