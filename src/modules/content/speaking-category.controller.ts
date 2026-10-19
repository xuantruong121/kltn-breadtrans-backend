import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateSpeakingCategoryDto,
  UpdateSpeakingCategoryDto,
} from './speaking-category.dto';
import { SpeakingCategoryService } from './speaking-category.service';
import type { SpeakingCategoryScope } from './speaking-category.service';

@ApiTags('admin-speaking-taxonomy')
@ApiBearerAuth()
@Controller('admin/skill-content/speaking/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class SpeakingCategoryController {
  constructor(private readonly service: SpeakingCategoryService) {}

  @Get()
  list(
    @Query('includeInactive') includeInactive?: string,
    @Query('scope') scope?: SpeakingCategoryScope,
  ) {
    return this.service.list({
      includeInactive: includeInactive === 'true',
      scope:
        scope === 'practiceSet' || scope === 'exercise' ? scope : undefined,
    });
  }

  @Post()
  create(@Body() dto: CreateSpeakingCategoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSpeakingCategoryDto,
  ) {
    return this.service.update(id, dto);
  }

  @Post(':id/activate')
  activate(@Param('id', ParseIntPipe) id: number) {
    return this.service.update(id, { isActive: true });
  }

  @Post(':id/deactivate')
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.service.update(id, { isActive: false });
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
