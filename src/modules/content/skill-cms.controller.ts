import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  Request,
  Res,
  UploadedFile,
  ParseIntPipe,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  FileTypeValidator,
  MaxFileSizeValidator,
  ParseFilePipe,
} from '@nestjs/common';
import { SkillCmsService } from './skill-cms.service';
import {
  SkillContentDto,
  ListeningQuestionDto,
  SkillPublishDto,
  SkillTracksDto,
  SkillQuestionDto,
  SpeakingExerciseDto,
  SpeakingExerciseReorderDto,
  WritingQuestionDto,
} from './skill-cms.dto';
import { SpeakingStimulusDto } from './speaking-stimulus.dto';

@ApiTags('admin-skill-cms')
@ApiBearerAuth()
@Controller('admin/skill-content')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class SkillCmsController {
  constructor(private readonly service: SkillCmsService) {}

  @Get(':domain')
  @ApiOperation({
    summary:
      'Admin: danh sách nội dung kỹ năng; gửi page để nhận một trang đã lọc',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'PUBLISHED'] })
  @ApiQuery({ name: 'level', required: false })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['NEWEST', 'OLDEST', 'TITLE', 'LEVEL', 'FEWEST'],
  })
  @ApiQuery({
    name: 'audio',
    required: false,
    enum: ['ok', 'pending', 'error', 'none'],
  })
  @ApiQuery({
    name: 'mode',
    required: false,
    enum: ['COMPREHENSION', 'DICTATION', 'DIALOGUE'],
  })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({
    name: 'track',
    required: false,
    description: 'Ngành, hoặc UNTAGGED cho nội dung chưa gắn ngành',
  })
  @ApiResponse({
    status: 200,
    description:
      'Mảng (không có page) hoặc { items, total, page, pageSize, facets }',
  })
  list(
    @Param('domain') domain: string,
    @Request() req: any,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.service.list(domain, req.user, query);
  }

  @Get('speaking/stimuli') listSpeakingStimuli(@Request() req: any) {
    return this.service.listSpeakingStimuli(req.user);
  }

  @Post('speaking/stimuli') createSpeakingStimulus(
    @Body() dto: SpeakingStimulusDto,
    @Request() req: any,
  ) {
    return this.service.createSpeakingStimulus(dto, req.user);
  }

  @Patch('speaking/stimuli/:id') updateSpeakingStimulus(
    @Param('id') id: string,
    @Body() dto: SpeakingStimulusDto,
    @Request() req: any,
  ) {
    return this.service.updateSpeakingStimulus(id, dto, req.user);
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
  @Post('writing/:id/questions') addWritingQuestion(
    @Param('id') id: string,
    @Body() dto: WritingQuestionDto,
    @Request() req: any,
  ) {
    return this.service.addWritingQuestion(id, dto, req.user);
  }

  @Patch('writing/:id/questions/:questionId') updateWritingQuestion(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: WritingQuestionDto,
    @Request() req: any,
  ) {
    return this.service.updateWritingQuestion(id, questionId, dto, req.user);
  }
  @Post('listening/:id/questions') addListeningQuestion(
    @Param('id') id: string,
    @Body() dto: ListeningQuestionDto,
    @Request() req: any,
  ) {
    return this.service.addListeningQuestion(id, dto, req.user);
  }

  @Patch('listening/:id/questions/:questionId') updateListeningQuestion(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: ListeningQuestionDto,
    @Request() req: any,
  ) {
    return this.service.updateListeningQuestion(id, questionId, dto, req.user);
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

  @Post('listening/:id/audio/validate') validateListeningAudio(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return this.service.validateListeningAudio(id, req.user);
  }

  @Post('listening/:id/audio/generate-preview') generateListeningAudioPreview(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return this.service.generateListeningAudioPreview(id, req.user);
  }

  @Get('listening/:id/audio') listListeningAudio(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
  ) {
    return this.service.listListeningAudio(id, req.user);
  }

  @Get('listening/:id/audio/:artifactId/preview')
  async previewListeningAudio(
    @Param('id', ParseIntPipe) id: number,
    @Param('artifactId', ParseIntPipe) artifactId: number,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const result = await this.service.previewListeningAudio(
      id,
      artifactId,
      req.user,
    );
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': result.buffer.length,
      'Cache-Control': 'private, no-cache',
    });
    return res.send(result.buffer);
  }

  @Post('listening/:id/audio/:artifactId/approve') approveListeningAudio(
    @Param('id', ParseIntPipe) id: number,
    @Param('artifactId', ParseIntPipe) artifactId: number,
    @Request() req: any,
  ) {
    return this.service.approveListeningAudio(id, artifactId, req.user);
  }

  @Post('listening/:id/audio/:artifactId/publish') publishListeningAudio(
    @Param('id', ParseIntPipe) id: number,
    @Param('artifactId', ParseIntPipe) artifactId: number,
    @Request() req: any,
  ) {
    return this.service.publishListeningAudio(id, artifactId, req.user);
  }

  @Post('listening/:id/questions/:questionId/audio-assets')
  @UseInterceptors(FileInterceptor('file'))
  uploadListeningQuestionAudio(
    @Param('id', ParseIntPipe) id: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^audio\// }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Request() req: any,
  ) {
    return this.service.uploadListeningQuestionAudio(
      id,
      questionId,
      file,
      req.user,
    );
  }

  @ApiOperation({
    summary:
      'Synthesize a Listening question clip (turns, comprehension audioText or dictation sentence)',
  })
  @ApiResponse({ status: 201, description: 'The new active audio asset' })
  @Post('listening/:id/questions/:questionId/audio-assets/generate')
  generateListeningQuestionAudio(
    @Param('id', ParseIntPipe) id: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Request() req: any,
  ) {
    return this.service.generateListeningDialogueAudio(
      id,
      questionId,
      req.user,
    );
  }

  @ApiOperation({
    summary:
      'Synthesize the reference audio of a Speaking exercise (Azure TTS)',
  })
  @ApiResponse({
    status: 201,
    description: 'The exercise with its new audioUrl',
  })
  @Post('speaking/:setId/exercises/:exerciseId/reference-audio')
  generateSpeakingReferenceAudio(
    @Param('setId') setId: string,
    @Param('exerciseId') exerciseId: string,
    @Request() req: any,
  ) {
    return this.service.generateSpeakingReferenceAudio(
      setId,
      exerciseId,
      req.user,
    );
  }

  @Post('listening/:id/questions/:questionId/audio-assets/generate-dialogue')
  generateListeningDialogueAudio(
    @Param('id', ParseIntPipe) id: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Request() req: any,
  ) {
    return this.service.generateListeningDialogueAudio(
      id,
      questionId,
      req.user,
    );
  }
  @Post(':domain/:id/exercises') addExercise(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Body() dto: SpeakingExerciseDto,
    @Request() req: any,
  ) {
    return this.service.addSpeakingExercise(domain, id, dto, req.user);
  }
  @Patch(':domain/:id/exercises/reorder') reorderExercises(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Body() dto: SpeakingExerciseReorderDto,
    @Request() req: any,
  ) {
    return this.service.reorderSpeakingExercises(domain, id, dto, req.user);
  }
  @Patch(':domain/:id/exercises/:exerciseId') updateExercise(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Param('exerciseId') exerciseId: string,
    @Body() dto: SpeakingExerciseDto,
    @Request() req: any,
  ) {
    return this.service.updateSpeakingExercise(
      domain,
      id,
      exerciseId,
      dto,
      req.user,
    );
  }
  @Delete(':domain/:id/exercises/:exerciseId') deleteExercise(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Param('exerciseId') exerciseId: string,
    @Request() req: any,
  ) {
    return this.service.deleteSpeakingExercise(
      domain,
      id,
      exerciseId,
      req.user,
    );
  }
  @Get(':domain/:id/validate') validate(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.validate(domain, id, req.user);
  }
  @Put(':domain/:id/tracks')
  @ApiOperation({
    summary: 'Gắn ngành cho nội dung; đề xuất theo ngành đọc từ đây',
  })
  @ApiResponse({ status: 200, description: 'Danh sách ngành sau khi lưu' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy nội dung' })
  setTracks(
    @Param('domain') domain: string,
    @Param('id') id: string,
    @Body() body: SkillTracksDto,
    @Request() req: any,
  ) {
    return this.service.setTracks(domain, id, body.tracks, req.user);
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
