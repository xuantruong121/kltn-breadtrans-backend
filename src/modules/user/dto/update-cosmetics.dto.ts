import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';

import { FRAME_SLUGS, SHOP_BADGE_SLUGS } from '../../market/market-effects';

/**
 * The shop frame and badge a learner wears. A value must be a cosmetic sold in
 * the shop; null takes it off; a missing field is left as it is.
 */
export class UpdateCosmeticsDto {
  @ApiPropertyOptional({
    enum: FRAME_SLUGS,
    nullable: true,
    example: 'frame-crown',
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsIn(FRAME_SLUGS)
  avatarFrame?: string | null;

  @ApiPropertyOptional({
    enum: SHOP_BADGE_SLUGS,
    nullable: true,
    example: 'badge-star',
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsIn(SHOP_BADGE_SLUGS)
  badgeKey?: string | null;
}
