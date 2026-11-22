import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
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
  @ApiResponse({
    status: 200,
    description:
      'Bài tập kèm bộ luyện và trạng thái khoá; practiceSet.tracks là [{ code, name, sortOrder }] các lĩnh vực đang bật của bộ',
  })
  findAllExercises(@Request() req: { user?: { id?: number; role?: Role } }) {
    return this.speakingService.findAllExercises(
      req?.user?.id,
      req?.user?.role,
    );
  }
}
