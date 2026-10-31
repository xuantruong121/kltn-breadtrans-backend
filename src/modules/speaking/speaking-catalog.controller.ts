import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { SpeakingService } from './speaking.service';

/**
 * The speaking catalog, open to visitors like the listening and grammar
 * catalogs: a guest sees the published sets (premium ones marked locked,
 * no progress); doing an exercise still needs an account.
 */
@ApiTags('Speaking Practice')
@Controller('speaking')
export class SpeakingCatalogController {
  constructor(private readonly speakingService: SpeakingService) {}

  @Get('exercises')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Danh sách bài luyện nói đã xuất bản; khách xem được, đăng nhập để có tiến độ',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Speaking category code; resolved by the taxonomy source',
  })
  @ApiResponse({
    status: 200,
    description: 'Bài tập kèm bộ luyện và trạng thái khoá',
  })
  findAllExercises(
    @Query('category') category: string,
    @Request() req: { user?: { id?: number; role?: Role } },
  ) {
    return this.speakingService.findAllExercises(
      category,
      req?.user?.id,
      req?.user?.role,
    );
  }
}
