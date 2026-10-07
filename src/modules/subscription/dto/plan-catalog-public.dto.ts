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

  @ApiPropertyOptional({ type: PublicPlanVersionDto, nullable: true })
  currentVersion!: PublicPlanVersionDto | null;
}

export class PublicPlanCatalogDto {
  @ApiProperty({ type: [PublicPlanDto] })
  plans!: PublicPlanDto[];
}
