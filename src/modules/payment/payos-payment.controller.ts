import {
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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PayosPaymentService } from './payos-payment.service';

@ApiTags('payos-payments')
@ApiBearerAuth()
@Controller('payments/payos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STUDENT)
export class PayosPaymentController {
  constructor(private readonly payos: PayosPaymentService) {}

  @Get(':intentId')
  getMine(
    @Param('intentId', ParseIntPipe) intentId: number,
    @Request() req: { user: { id: number } },
  ) {
    return this.payos.getOwnedIntent(req.user.id, intentId);
  }

  @Post(':intentId/sync')
  @HttpCode(HttpStatus.OK)
  sync(
    @Param('intentId', ParseIntPipe) intentId: number,
    @Request() req: { user: { id: number } },
  ) {
    return this.payos
      .getOwnedIntent(req.user.id, intentId)
      .then((intent) => this.payos.synchronize(intent.orderCode));
  }

  @Post(':intentId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('intentId', ParseIntPipe) intentId: number,
    @Request() req: { user: { id: number } },
  ) {
    return this.payos.cancel(req.user.id, intentId);
  }
}
