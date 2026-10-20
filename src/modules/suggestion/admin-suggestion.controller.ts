import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SuggestionQueryDto } from './dto/suggestion-query.dto';
import { UpdateSuggestionDto } from './dto/update-suggestion.dto';
import { SuggestionService } from './suggestion.service';

@ApiTags('admin-suggestions')
@Controller('admin/suggestions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminSuggestionController {
  constructor(private readonly service: SuggestionService) {}
  @Get()
  @ApiOperation({ summary: 'Admin xem đề xuất và góp ý' })
  list(@Query() query: SuggestionQueryDto) {
    return this.service.listAdmin(query);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Admin xem chi tiết đề xuất' })
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.getAdmin(id);
  }
  @Patch(':id')
  @ApiOperation({ summary: 'Admin cập nhật trạng thái hoặc phản hồi đề xuất' })
  update(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSuggestionDto,
  ) {
    return this.service.updateAdmin(id, req.user.id, dto);
  }
}
