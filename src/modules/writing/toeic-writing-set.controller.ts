import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ToeicWritingSetService } from './toeic-writing-set.service';
import {
  CreateToeicWritingSetDto,
  CreateToeicWritingSetItemDto,
  UpdateToeicWritingSetDto,
  UpdateToeicWritingSetItemDto,
} from './toeic-writing-set.dto';

@Controller('admin/toeic/writing-sets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminToeicWritingSetController {
  constructor(private readonly writingSets: ToeicWritingSetService) {}

  @Get()
  list() {
    return this.writingSets.listAdmin();
  }

  @Post()
  create(@Body() dto: CreateToeicWritingSetDto, @Req() req: any) {
    return this.writingSets.create(dto, req.user?.id);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.writingSets.getAdmin(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateToeicWritingSetDto,
  ) {
    return this.writingSets.update(id, dto);
  }

  @Post(':id/items')
  addItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateToeicWritingSetItemDto,
  ) {
    return this.writingSets.addItem(id, dto);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateToeicWritingSetItemDto,
  ) {
    return this.writingSets.updateItem(id, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  deleteItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    return this.writingSets.deleteItem(id, itemId);
  }

  @Post(':id/publish')
  publish(@Param('id', ParseIntPipe) id: number) {
    return this.writingSets.publish(id);
  }

  @Post(':id/unpublish')
  unpublish(@Param('id', ParseIntPipe) id: number) {
    return this.writingSets.unpublish(id);
  }
}

@Controller('toeic/writing-sets')
@UseGuards(JwtAuthGuard)
export class ToeicWritingSetController {
  constructor(private readonly writingSets: ToeicWritingSetService) {}

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.writingSets.getLearnerDetail(id);
  }

  @Get(':id/completion')
  completion(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.writingSets.getCompletion(id, req.user.id);
  }
}
