import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsNotEmpty,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus, EnrollmentStatus } from '@prisma/client';
import { BankTransferInstructionsDto } from './payment.dto';

export class AdminPaymentFilterDto {
  @ApiPropertyOptional({
    enum: PaymentStatus,
    description:
      'Lọc theo trạng thái thanh toán (PENDING, REPORTED, CONFIRMED, REJECTED, REVIEW_REQUIRED)',
  })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({
    description:
      'Tìm kiếm theo mã chuyển khoản, họ tên hoặc email học viên (tối đa 100 ký tự)',
    example: 'BT-45',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MaxLength(100, { message: 'Từ khóa tìm kiếm không được vượt quá 100 ký tự' })
  search?: string;

  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    description: 'Số trang (bắt đầu từ 1)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    default: 10,
    minimum: 1,
    maximum: 100,
    description: 'Số mục mỗi trang (tối đa 100)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

export class RejectPaymentDto {
  @ApiProperty({
    example: 'Không tìm thấy giao dịch khớp trên sao kê ngân hàng',
    description:
      'Lý do từ chối thanh toán (bắt buộc, từ 5 đến 500 ký tự sau khi cắt khoảng trắng)',
  })
  @IsString({ message: 'Lý do từ chối phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Lý do từ chối không được để trống' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(5, { message: 'Lý do từ chối phải có ít nhất 5 ký tự' })
  @MaxLength(500, { message: 'Lý do từ chối không được vượt quá 500 ký tự' })
  reason: string;
}

export class AdminStudentSummaryDto {
  @ApiProperty({ example: 8 })
  id: number;

  @ApiProperty({ example: 'student@breadtrans.com' })
  email: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  fullName: string;
}

export class AdminStudentDetailDto extends AdminStudentSummaryDto {
  @ApiProperty({ example: '0901234567', nullable: true })
  phone: string | null;
}

export class AdminReviewerSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'admin@breadtrans.com' })
  email: string;

  @ApiProperty({ example: 'Admin User' })
  fullName: string;
}

export class AdminClassSummaryDto {
  @ApiProperty({ example: 15 })
  id: number;

  @ApiProperty({ example: 'IELTS Intensive K01' })
  name: string;

  @ApiProperty({
    example: 1500000,
    description:
      'Học phí niêm yết hiện tại của lớp (tham khảo, không thay thế amountVnd)',
  })
  tuitionFeeVnd: number;

  @ApiProperty({
    example: { id: 3, title: 'Khoá học IELTS 7.0+' },
  })
  course: {
    id: number;
    title: string;
  };
}

export class AdminPaymentSummaryDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 45 })
  enrollmentId: number;

  @ApiProperty({
    example: 1500000,
    description: 'Số tiền thanh toán ảnh chụp thực tế (authoritative)',
  })
  amountVnd: number;

  @ApiProperty({
    example: 'BT-45',
    description: 'Mã nội dung chuyển khoản duy nhất',
  })
  transferCode: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.REPORTED })
  status: PaymentStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  reportedAt: Date | null;

  @ApiProperty({ nullable: true })
  reviewedAt: Date | null;

  @ApiProperty({ nullable: true })
  confirmedAt: Date | null;

  @ApiProperty({ type: () => AdminStudentSummaryDto })
  student: AdminStudentSummaryDto;

  @ApiProperty({ type: () => AdminClassSummaryDto })
  class: AdminClassSummaryDto;

  @ApiProperty({ type: () => AdminReviewerSummaryDto, nullable: true })
  reviewedBy: AdminReviewerSummaryDto | null;
}

export class AdminEnrollmentDetailDto {
  @ApiProperty({ example: 45 })
  id: number;

  @ApiProperty({
    enum: EnrollmentStatus,
    example: EnrollmentStatus.PENDING_PAYMENT,
  })
  status: EnrollmentStatus;

  @ApiProperty()
  joinedAt: Date;
}

export class AdminPaymentDetailDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 45 })
  enrollmentId: number;

  @ApiProperty({
    example: 1500000,
    description: 'Số tiền đối soát thực tế snapshot (authoritative)',
  })
  amountVnd: number;

  @ApiProperty({ example: 'BT-45' })
  transferCode: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.REPORTED })
  status: PaymentStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ nullable: true })
  reportedAt: Date | null;

  @ApiProperty({ nullable: true })
  reviewedAt: Date | null;

  @ApiProperty({ nullable: true })
  confirmedAt: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'Ghi chú lý do từ chối hoặc xử lý nội bộ của Admin',
  })
  adminNote: string | null;

  @ApiProperty({ type: () => AdminStudentDetailDto })
  student: AdminStudentDetailDto;

  @ApiProperty({ type: () => AdminEnrollmentDetailDto })
  enrollment: AdminEnrollmentDetailDto;

  @ApiProperty({ type: () => AdminClassSummaryDto })
  class: AdminClassSummaryDto;

  @ApiProperty({ type: () => BankTransferInstructionsDto })
  bankInstructions: BankTransferInstructionsDto;

  @ApiProperty({ type: () => AdminReviewerSummaryDto, nullable: true })
  reviewedBy: AdminReviewerSummaryDto | null;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 45 })
  totalItems: number;

  @ApiProperty({ example: 5 })
  totalPages: number;
}

export class PaginatedAdminPaymentsDto {
  @ApiProperty({ type: () => [AdminPaymentSummaryDto] })
  items: AdminPaymentSummaryDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  pagination: PaginationMetaDto;
}
