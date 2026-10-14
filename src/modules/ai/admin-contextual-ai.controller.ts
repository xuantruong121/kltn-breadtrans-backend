import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AiService } from './ai.service';
import {
  SuggestVocabWordDto,
  SuggestGrammarQuestionsDto,
  SuggestReadingPassageDto,
  SuggestReadingQuestionsDto,
  SuggestToeicPart5Dto,
  SuggestCourseCurriculumDto,
  SuggestListeningContentDto,
  SuggestListeningQuestionsDto,
  SuggestWritingTaskDto,
} from './dto/contextual-ai.dto';

@ApiTags('Admin Contextual AI')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminContextualAiController {
  private readonly logger = new Logger(AdminContextualAiController.name);

  constructor(private readonly aiService: AiService) {}

  @Post('vocab/ai/suggest-word')
  @ApiOperation({
    summary: 'Gợi ý nội dung từ vựng tiếng Anh theo chuẩn VocabWord',
  })
  async suggestVocabWord(@Body() dto: SuggestVocabWordDto) {
    try {
      return await this.aiService.suggestVocabWord({
        word: dto.word,
        context: dto.context,
        level: dto.level,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      const msg = error?.message || '';
      this.logger.warn(`AI Vocab Suggestion failed: ${msg}`);
      throw new BadGatewayException(
        'Không thể lấy gợi ý từ vựng từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('grammar/ai/suggest-questions')
  @ApiOperation({
    summary: 'Gợi ý danh sách câu hỏi ngữ pháp trắc nghiệm nháp',
  })
  async suggestGrammarQuestions(@Body() dto: SuggestGrammarQuestionsDto) {
    try {
      return await this.aiService.suggestGrammarQuestions({
        topicTitle: dto.topicTitle,
        level: dto.level,
        theory: dto.theory,
        keyFormula: dto.keyFormula,
        count: dto.count || 3,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      const msg = error?.message || '';
      this.logger.warn(`AI Grammar Suggestion failed: ${msg}`);
      throw new BadGatewayException(
        'Không thể tạo câu hỏi ngữ pháp nháp từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('reading/ai/suggest-passage')
  @ApiOperation({
    summary: 'Gợi ý đoạn văn đọc (Reading passage) nháp',
  })
  async suggestReadingPassage(@Body() dto: SuggestReadingPassageDto) {
    try {
      return await this.aiService.suggestReadingPassage({
        topic: dto.topic,
        level: dto.level,
        targetLength: dto.targetLength,
        microSkill: dto.microSkill,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      const msg = error?.message || '';
      this.logger.warn(`AI Reading Passage Suggestion failed: ${msg}`);
      throw new BadGatewayException(
        'Không thể tạo đoạn đọc nháp từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('reading/ai/suggest-questions')
  @ApiOperation({
    summary:
      'Gợi ý câu hỏi trắc nghiệm đọc hiểu dựa trên đoạn văn hiện tại trong editor',
  })
  async suggestReadingQuestions(@Body() dto: SuggestReadingQuestionsDto) {
    try {
      return await this.aiService.suggestReadingQuestions({
        passage: dto.passage,
        level: dto.level,
        count: dto.count || 3,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      const msg = error?.message || '';
      this.logger.warn(`AI Reading Questions Suggestion failed: ${msg}`);
      throw new BadGatewayException(
        'Không thể tạo câu hỏi đọc hiểu từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('exams/ai/suggest-part5')
  @ApiOperation({
    summary: 'Gợi ý câu hỏi trắc nghiệm TOEIC Part 5 nháp',
  })
  async suggestToeicPart5(@Body() dto: SuggestToeicPart5Dto) {
    try {
      return await this.aiService.suggestToeicPart5({
        topic: dto.topic,
        level: dto.level,
        grammarFocus: dto.grammarFocus,
        vocabularyFocus: dto.vocabularyFocus,
        count: dto.count || 5,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      const msg = error?.message || '';
      this.logger.warn(`AI TOEIC Part 5 Suggestion failed: ${msg}`);
      throw new BadGatewayException(
        'Không thể tạo câu hỏi TOEIC Part 5 từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('courses/ai/suggest-curriculum')
  @ApiOperation({ summary: 'Gợi ý chương trình học nháp cho Course Studio' })
  async suggestCourseCurriculum(@Body() dto: SuggestCourseCurriculumDto) {
    try {
      return await this.aiService.suggestCourseCurriculum({
        courseTitle: dto.courseTitle,
        level: dto.level,
        description: dto.description,
        targetLessonCount: dto.targetLessonCount || 5,
        existingLessonTitles: dto.existingLessonTitles,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`AI Course Curriculum failed: ${error?.message || ''}`);
      throw new BadGatewayException(
        'Không thể gợi ý chương trình học từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('listening/ai/suggest-content')
  @ApiOperation({ summary: 'Gợi ý nội dung nghe nháp trong Listening Studio' })
  async suggestListeningContent(@Body() dto: SuggestListeningContentDto) {
    try {
      return await this.aiService.suggestListeningContent({
        mode: dto.mode,
        level: dto.level,
        topic: dto.topic,
        currentText: dto.currentText,
        currentTurns: dto.currentTurns,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`AI Listening Content failed: ${error?.message || ''}`);
      throw new BadGatewayException(
        'Không thể gợi ý nội dung nghe từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('listening/ai/suggest-questions')
  @ApiOperation({ summary: 'Tạo câu hỏi nghe nháp từ nội dung hiện tại' })
  async suggestListeningQuestions(@Body() dto: SuggestListeningQuestionsDto) {
    try {
      return await this.aiService.suggestListeningQuestions({
        mode: dto.mode,
        sourceText: dto.sourceText,
        level: dto.level,
        count: dto.count || 3,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(
        `AI Listening Questions failed: ${error?.message || ''}`,
      );
      throw new BadGatewayException(
        'Không thể tạo câu hỏi nghe từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('writing/ai/suggest-task')
  @ApiOperation({ summary: 'Gợi ý đề bài Writing nháp trong Writing Studio' })
  async suggestWritingTask(@Body() dto: SuggestWritingTaskDto) {
    try {
      return await this.aiService.suggestWritingTask({
        taskType: dto.taskType,
        level: dto.level,
        topic: dto.topic,
        currentPrompt: dto.currentPrompt,
        wordMin: dto.wordMin,
        wordMax: dto.wordMax,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`AI Writing Task failed: ${error?.message || ''}`);
      throw new BadGatewayException(
        'Không thể gợi ý đề bài Writing từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }
}
