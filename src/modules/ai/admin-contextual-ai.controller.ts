import {
  Controller,
  Post,
  Body,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  Logger,
  BadGatewayException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from './ai.service';
import { SpeakingCategoryService } from '../content/speaking-category.service';
import {
  SuggestVocabWordDto,
  SuggestGrammarQuestionsDto,
  SuggestReadingPassageDto,
  SuggestReadingQuestionsDto,
  SuggestToeicPart5Dto,
  SuggestListeningContentDto,
  SuggestListeningQuestionsDto,
  SuggestWritingTaskDto,
  SuggestSpeakingPracticeSetDto,
  SuggestSpeakingExercisesDto,
  SuggestSpeakingFullDraftDto,
  SuggestListeningFullDraftDto,
  SuggestReadingFullDraftDto,
  SuggestVocabFullDraftDto,
  SuggestGrammarFullDraftDto,
  SuggestDictationLinesDto,
  VocabDecksFromDocumentDto,
} from './dto/contextual-ai.dto';
import { DocumentTextService } from './document-text.service';
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_DECKS,
  DOCUMENT_MAX_WORDS_PER_DECK,
  deckHeadwords,
  isReadableDocument,
  limitDocumentText,
  normalizeDictationSentences,
  normalizeVocabDecks,
} from './document-import.logic';

@ApiTags('Admin Contextual AI')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminContextualAiController {
  private readonly logger = new Logger(AdminContextualAiController.name);

  constructor(
    private readonly aiService: AiService,
    private readonly documents: DocumentTextService,
    private readonly prisma: PrismaService,
    @Optional()
    private readonly speakingCategoryService?: SpeakingCategoryService,
  ) {}

  private async speakingCategoryContext(code: string) {
    if (!this.speakingCategoryService) {
      throw new BadRequestException('Speaking taxonomy service chưa sẵn sàng');
    }
    const category = await this.speakingCategoryService.getByCode(
      code,
      'practiceSet',
    );
    return {
      category: category.code,
      categoryContext: {
        code: category.code,
        displayLabel: category.name,
        allowPracticeSet: category.allowPracticeSet,
        allowExercise: category.allowExercise,
      },
    };
  }

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
        sourceText: dto.sourceText,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`AI Writing Task failed: ${error?.message || ''}`);
      throw new BadGatewayException(
        'Không thể gợi ý đề bài Writing từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('speaking/ai/suggest-practice-set')
  @ApiOperation({ summary: 'Gợi ý bộ luyện nói nháp, cần Admin xem lại' })
  async suggestSpeakingPracticeSet(@Body() dto: SuggestSpeakingPracticeSetDto) {
    try {
      const taxonomy = await this.speakingCategoryContext(dto.category);
      return await this.aiService.suggestSpeakingPracticeSet({
        topic: dto.topic,
        level: dto.level,
        ...taxonomy,
        currentTitle: dto.currentTitle,
        currentDescription: dto.currentDescription,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(
        `AI Speaking practice-set failed: ${error?.message || ''}`,
      );
      throw new BadGatewayException(
        'Không thể gợi ý bộ luyện nói từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('speaking/ai/suggest-exercises')
  @ApiOperation({ summary: 'Gợi ý câu luyện nói nháp từ ngữ cảnh bộ luyện' })
  async suggestSpeakingExercises(@Body() dto: SuggestSpeakingExercisesDto) {
    try {
      const taxonomy = await this.speakingCategoryContext(dto.category);
      return await this.aiService.suggestSpeakingExercises({
        practiceSetTitle: dto.practiceSetTitle,
        practiceSetDescription: dto.practiceSetDescription,
        level: dto.level,
        ...taxonomy,
        currentTitle: dto.currentTitle,
        currentTargetText: dto.currentTargetText,
        taskType: dto.taskType,
        existingExerciseTitles: dto.existingExerciseTitles,
        count: dto.count || 3,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`AI Speaking exercises failed: ${error?.message || ''}`);
      throw new BadGatewayException(
        'Không thể gợi ý câu luyện nói từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('speaking/ai/full-draft')
  @ApiOperation({ summary: 'Soạn bộ luyện Speaking cùng các câu luyện nháp' })
  async suggestSpeakingFullDraft(@Body() dto: SuggestSpeakingFullDraftDto) {
    try {
      const taxonomy = await this.speakingCategoryContext(dto.category);
      return await this.aiService.suggestSpeakingFullDraft({
        topic: dto.topic,
        level: dto.level,
        ...taxonomy,
        objective: dto.objective,
        taskType: dto.taskType,
        count: dto.count || 5,
        sourceText: dto.sourceText,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(
        `AI Speaking full draft failed: ${error?.message || ''}`,
      );
      throw new BadGatewayException(
        'Không thể soạn bộ luyện Speaking lúc này.',
      );
    }
  }

  @Post('listening/ai/full-draft')
  @ApiOperation({ summary: 'Soạn bài Listening gồm nội dung và câu hỏi nháp' })
  async suggestListeningFullDraft(@Body() dto: SuggestListeningFullDraftDto) {
    try {
      return await this.aiService.suggestListeningFullDraft({
        topic: dto.topic,
        level: dto.level,
        mode: dto.mode,
        count: dto.count || 5,
        sourceText: dto.sourceText,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(
        `AI Listening full draft failed: ${error?.message || ''}`,
      );
      throw new BadGatewayException('Không thể soạn bài Listening lúc này.');
    }
  }

  @Post('reading/ai/full-draft')
  @ApiOperation({ summary: 'Soạn bài Reading gồm đoạn đọc và câu hỏi nháp' })
  async suggestReadingFullDraft(@Body() dto: SuggestReadingFullDraftDto) {
    try {
      return await this.aiService.suggestReadingFullDraft({
        topic: dto.topic,
        level: dto.level,
        targetLength: dto.targetLength,
        microSkill: dto.microSkill,
        count: dto.count || 5,
        sourceText: dto.sourceText,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`AI Reading full draft failed: ${error?.message || ''}`);
      throw new BadGatewayException('Không thể soạn bài Reading lúc này.');
    }
  }

  @Post('ai/document-text')
  @ApiOperation({
    summary: 'Đọc chữ từ tệp PDF, DOCX, TXT; không gọi AI, không lưu tệp',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({
    status: 400,
    description: 'Tệp không đọc được hoặc không có chữ.',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES } }),
  )
  async readDocument(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Vui lòng chọn tệp.');
    if (!isReadableDocument(file.originalname))
      throw new BadRequestException('Chỉ đọc được tệp PDF, DOCX hoặc TXT.');
    const raw = await this.documents.extractTextFromBuffer(
      file.buffer,
      file.mimetype,
      file.originalname,
    );
    const document = limitDocumentText(raw);
    if (!document.text)
      throw new BadRequestException(
        'Tệp không có chữ để đọc. Tệp scan cần được chuyển thành chữ trước.',
      );
    return document;
  }

  @Post('vocab/ai/from-document')
  @ApiOperation({ summary: 'Gợi ý các bộ từ từ tài liệu, chờ admin duyệt' })
  async suggestVocabDecks(@Body() dto: VocabDecksFromDocumentDto) {
    try {
      const { decks } = await this.aiService.suggestVocabDecksFromDocument({
        text: dto.text,
        level: dto.level,
        maxDecks: DOCUMENT_MAX_DECKS,
        maxWordsPerDeck: DOCUMENT_MAX_WORDS_PER_DECK,
      });
      const known = await this.prisma.dictionaryEntry.findMany({
        where: { headword: { in: deckHeadwords(decks) } },
        select: { headword: true },
      });
      return {
        decks: normalizeVocabDecks(
          decks,
          new Set(known.map((row) => row.headword.toLowerCase())),
        ),
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`AI vocab decks failed: ${error?.message || ''}`);
      throw new BadGatewayException('Không thể tạo bộ từ từ tài liệu lúc này.');
    }
  }

  @Post('listening/ai/dictation-lines')
  @ApiOperation({ summary: 'Soạn các câu nghe chép nháp' })
  async suggestDictationLines(@Body() dto: SuggestDictationLinesDto) {
    try {
      const draft = await this.aiService.suggestDictationLines({
        topic: dto.topic,
        level: dto.level,
        count: dto.count || 20,
        sourceText: dto.sourceText,
      });
      return {
        ...draft,
        sentences: normalizeDictationSentences(draft.sentences),
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`AI dictation failed: ${error?.message || ''}`);
      throw new BadGatewayException('Không thể soạn câu nghe chép lúc này.');
    }
  }

  @Post('vocab/ai/full-draft')
  @ApiOperation({ summary: 'Soạn chủ đề Vocabulary cùng danh sách từ nháp' })
  async suggestVocabFullDraft(@Body() dto: SuggestVocabFullDraftDto) {
    try {
      return await this.aiService.suggestVocabFullDraft({
        topic: dto.topic,
        level: dto.level,
        context: dto.context,
        count: dto.count || 15,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(
        `AI Vocabulary full draft failed: ${error?.message || ''}`,
      );
      throw new BadGatewayException(
        'Không thể soạn chủ đề Vocabulary lúc này.',
      );
    }
  }

  @Post('grammar/ai/full-draft')
  @ApiOperation({ summary: 'Soạn bài Grammar cùng câu hỏi nháp' })
  async suggestGrammarFullDraft(@Body() dto: SuggestGrammarFullDraftDto) {
    try {
      return await this.aiService.suggestGrammarFullDraft({
        topicTitle: dto.topicTitle,
        level: dto.level,
        objective: dto.objective,
        count: dto.count || 10,
        sourceText: dto.sourceText,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`AI Grammar full draft failed: ${error?.message || ''}`);
      throw new BadGatewayException('Không thể soạn bài Grammar lúc này.');
    }
  }
}
