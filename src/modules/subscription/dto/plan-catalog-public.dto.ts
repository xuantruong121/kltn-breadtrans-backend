import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicPlanVersionDto {
  @ApiProperty({ description: 'Only a currently valid purchase target' })
  id!: number;

  @ApiProperty()
  version!: number;

  @ApiPropertyOptional({ nullable: true })
  displayName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty()
  priceVnd!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  durationDays!: number;
}

export class PublicPlanDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty({
    description: 'Whether the plan currently has a sale-safe version',
  })
  purchasable!: boolean;

  @ApiPropertyOptional({
    type: PublicPlanVersionDto,
    nullable: true,
    description:
      'The shortest sale-safe term (30 days), kept for older clients',
  })
  currentVersion!: PublicPlanVersionDto | null;

  @ApiProperty({
    type: [PublicPlanVersionDto],
    description: 'Every sale-safe term (30, 90, 180 days), shortest first',
  })
  versions!: PublicPlanVersionDto[];
}

export class PublicPlanCatalogDto {
  @ApiProperty({ type: [PublicPlanDto] })
  plans!: PublicPlanDto[];
}
