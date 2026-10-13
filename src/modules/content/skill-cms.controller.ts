import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SkillCmsService } from './skill-cms.service';
import {
  SkillContentDto,
  SkillPublishDto,
  SkillQuestionDto,
} from './skill-cms.dto';

@ApiTags('admin-skill-cms')
@ApiBearerAuth()
@Controller('admin/skill-content')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class SkillCmsController {
  constructor(private readonly service: SkillCmsService) {}

  @Get(':domain') list(@Param('domain') domain: string, @Request() req: any) {
    return this.service.list(domain, req.user);
  }
  @Post(':domain') create(
    @Param('domain') domain: string,
    @Body() dto: SkillContentDto,
    @Request() req: any,
  ) {
    return this.service.create(domain, dto, req.user);
  }
  @Get(':domain/:id') get(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.get(domain, id, req.user);
  }
  @Patch(':domain/:id') update(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Body() dto: SkillContentDto,
    @Request() req: any,
  ) {
    return this.service.update(domain, id, dto, req.user);
  }
  @Post(':domain/:id/questions') addQuestion(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Body() dto: SkillQuestionDto,
    @Request() req: any,
  ) {
    return this.service.addQuestion(domain, id, dto, req.user);
  }
  @Patch(':domain/:id/questions/:questionId') updateQuestion(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: SkillQuestionDto,
    @Request() req: any,
  ) {
    return this.service.updateQuestion(domain, id, questionId, dto, req.user);
  }
  @Delete(':domain/:id/questions/:questionId') deleteQuestion(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Request() req: any,
  ) {
    return this.service.deleteQuestion(domain, id, questionId, req.user);
  }
  @Get(':domain/:id/validate') validate(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.validate(domain, id, req.user);
  }
  @Post(':domain/:id/publish') publish(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Body() body: SkillPublishDto,
    @Request() req: any,
  ) {
    return this.service.publish(domain, id, body.status, req.user);
  }
}
