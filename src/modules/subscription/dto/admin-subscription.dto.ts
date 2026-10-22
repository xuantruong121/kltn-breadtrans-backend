import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionEventType } from '@prisma/client';

export type AdminSubscriptionStatusFilter =
  'ALL' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export class AdminSubscriptionQueryDto {
  @ApiPropertyOptional({
    description: 'Bộ lọc trạng thái quyền học viên',
    enum: ['ALL', 'ACTIVE', 'EXPIRED', 'REVOKED'],
    default: 'ACTIVE',
  })
  @IsOptional()
  @IsString()
  status?: AdminSubscriptionStatusFilter;

  @ApiPropertyOptional({
    description: 'Tìm kiếm theo email hoặc họ tên học viên',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Trang cần lấy', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Số lượng mục trên mỗi trang',
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

export class AdminGrantSubscriptionDto {
  @ApiProperty({ description: 'ID học viên được tặng gói' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  studentId: number;

  @ApiProperty({ description: 'ID phiên bản gói được cấp' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  planVersionId: number;

  @ApiPropertyOptional({
    description:
      'Thời hạn gói tính theo ngày (nếu bỏ trống sẽ lấy theo thời hạn của PlanVersion)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays?: number;

  @ApiProperty({ description: 'Lý do tặng gói (bắt buộc để kiểm toán)' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({
    description: 'Idempotency key tránh thao tác trùng lặp',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class AdminExtendSubscriptionDto {
  @ApiProperty({ description: 'Số ngày gia hạn thêm (+days)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  extensionDays: number;

  @ApiProperty({ description: 'Lý do gia hạn (bắt buộc để kiểm toán)' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({
    description: 'Idempotency key tránh thao tác trùng lặp',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class AdminRevokeSubscriptionDto {
  @ApiProperty({ description: 'Lý do thu hồi quyền (bắt buộc để kiểm toán)' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({
    description: 'Idempotency key tránh thao tác trùng lặp',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class AdminSubscriptionItemDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  userId: number;

  @ApiProperty()
  userEmail: string;

  @ApiProperty({ nullable: true })
  userFullName: string | null;

  @ApiProperty()
  planId: number;

  @ApiProperty()
  planCode: string;

  @ApiProperty()
  planDisplayName: string;

  @ApiProperty()
  planVersionId: number;

  @ApiProperty()
  version: number;

  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'REVOKED'] })
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';

  @ApiProperty()
  startsAt: Date;

  @ApiProperty()
  endsAt: Date;

  @ApiProperty()
  remainingDays: number;

  @ApiProperty({ enum: ['PAYMENT', 'ADMIN_GRANT'] })
  source: 'PAYMENT' | 'ADMIN_GRANT';

  @ApiProperty()
  sourceLabel: string;

  @ApiProperty({ nullable: true })
  planPurchaseId: number | null;

  @ApiProperty()
  createdAt: Date;
}

export class PaginatedAdminSubscriptionsDto {
  @ApiProperty({ type: [AdminSubscriptionItemDto] })
  items: AdminSubscriptionItemDto[];

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  total: number;

  @ApiProperty()
  totalPages: number;
}

export class AdminSubscriptionEventDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  subscriptionId: number;

  @ApiProperty({ enum: SubscriptionEventType })
  type: SubscriptionEventType;

  @ApiProperty()
  typeLabel: string;

  @ApiProperty({ nullable: true })
  actorUserId: number | null;

  @ApiProperty()
  actorName: string;

  @ApiProperty({ nullable: true })
  actorEmail: string | null;

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty({ nullable: true })
  previousEndsAt: Date | null;

  @ApiProperty({ nullable: true })
  newEndsAt: Date | null;

  @ApiProperty({ nullable: true })
  metadata: Record<string, any> | null;

  @ApiProperty()
  createdAt: Date;
}

export class AdminActivePlanDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  code: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty()
  currentVersionId: number;

  @ApiProperty()
  version: number;

  @ApiProperty({ nullable: true })
  durationDays: number | null;

  @ApiProperty({ nullable: true })
  priceVnd: number | null;
}

export class AdminLearnerLookupDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  email: string;

  @ApiProperty({ nullable: true })
  fullName: string | null;

  @ApiProperty({ nullable: true, type: AdminSubscriptionItemDto })
  activeSubscription: AdminSubscriptionItemDto | null;
}
