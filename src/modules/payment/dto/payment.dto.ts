import { PaymentStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CourseSummaryDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'Lộ trình IELTS 6.5+' })
  title: string;
}

export class ClassSummaryDto {
  @ApiProperty({ example: 8 })
  id: number;

  @ApiProperty({ example: 'IELTS Foundation K20' })
  name: string;

  @ApiProperty({ type: () => CourseSummaryDto })
  course: CourseSummaryDto;
}

export class BankTransferInstructionsDto {
  @ApiProperty({ example: '970436' })
  bin: string;

  @ApiProperty({ example: 'Example Bank' })
  bankName: string;

  @ApiProperty({ example: '0000000000' })
  accountNumber: string;

  @ApiProperty({ example: 'BREADTRANS EXAMPLE CENTER' })
  accountName: string;

  @ApiProperty({ example: 1500000 })
  amountVnd: number;

  @ApiProperty({ example: 'BT-45' })
  transferCode: string;

  @ApiProperty({
    example:
      'https://img.vietqr.io/image/970436-0000000000-compact2.png?amount=1500000&addInfo=BT-45&accountName=BREADTRANS+EXAMPLE+CENTER',
  })
  vietQrUrl: string;
}

export class StudentPaymentSummaryDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 45 })
  enrollmentId: number;

  @ApiProperty({ example: 1500000 })
  amountVnd: number;

  @ApiProperty({ example: 'BT-45' })
  transferCode: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PENDING })
  status: PaymentStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  reportedAt: Date | null;

  @ApiProperty({ nullable: true })
  confirmedAt: Date | null;

  @ApiProperty({ type: () => ClassSummaryDto })
  class: ClassSummaryDto;
}

export class StudentPaymentDetailDto extends StudentPaymentSummaryDto {
  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: () => BankTransferInstructionsDto })
  bankInstructions: BankTransferInstructionsDto;
}
