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
  UnprocessableEntityException,
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
import {
  SuggestVocabWordDto,
  SuggestGrammarQuestionsDto,
  SuggestReadingPassageDto,
  SuggestReadingQuestionsDto,
  SuggestToeicPart5Dto,
  SuggestListeningContentDto,
  SuggestListeningQuestionsDto,
  SuggestWritingTaskDto,
  SuggestWritingFullDraftDto,
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
  dictationAvoidList,
  withoutAvoided,
  normalizeVocabDecks,
} from './document-import.logic';
import { aiAvoidList, withoutAvoidedItems } from './ai-avoid.logic';
import { GrammarDraftRejected } from '../grammar/grammar-full-draft.logic';

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
  ) {}

  /**
   * The Lĩnh vực a Speaking draft is written for: its name and description
   * go to the prompt. No code means a general draft. Only an active track
   * can be picked, as for tags.
   */
  private async speakingTrackContext(code?: string) {
    if (!code) return {};
    const track = await this.prisma.learningTrack.findFirst({
      where: { code, isActive: true },
      select: { code: true, name: true, description: true },
    });
    if (!track)
      throw new BadRequestException('Lĩnh vực không tồn tại hoặc đã tắt.');
    return { trackContext: track };
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
      const avoid = aiAvoidList(dto.avoid);
      const suggestion = await this.aiService.suggestGrammarQuestions({
        topicTitle: dto.topicTitle,
        level: dto.level,
        theory: dto.theory,
        keyFormula: dto.keyFormula,
        count: dto.count || 3,
        avoid,
      });
      // "Tạo câu khác": a question the draft already has is never offered again.
      return {
        ...suggestion,
        candidates: withoutAvoidedItems(
          suggestion.candidates ?? [],
          (candidate) => String(candidate.question ?? ''),
          avoid,
        ),
      };
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
      const avoid = aiAvoidList(dto.avoid);
      const suggestion = await this.aiService.suggestReadingQuestions({
        passage: dto.passage,
        level: dto.level,
        count: dto.count || 3,
        avoid,
      });
      // "Tạo câu khác": a question the draft already has is never offered again.
      return {
        ...suggestion,
        candidates: withoutAvoidedItems(
          suggestion.candidates ?? [],
          (candidate) => String(candidate.prompt ?? ''),
          avoid,
        ),
      };
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
        difficulty: dto.difficulty,
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
        'Không thể gợi ý lời thoại từ AI lúc này. Vui lòng thử lại sau.',
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

  @Post('writing/ai/full-draft')
  @ApiOperation({
    summary:
      'Soạn cả bài Viết nháp (email hoặc Dịch câu); bài theo tranh không dùng AI',
  })
  @ApiResponse({
    status: 201,
    description: '{ kind, title, description, tasks[], dropped }',
  })
  @ApiResponse({
    status: 422,
    description: 'AI không trả câu nào đạt kiểm tra',
  })
  async suggestWritingFullDraft(@Body() dto: SuggestWritingFullDraftDto) {
    try {
      return await this.aiService.suggestWritingFullDraft({
        topic: dto.topic,
        level: dto.level,
        kind: dto.kind,
        count: dto.count || 5,
        sourceText: dto.sourceText,
        brief: dto.brief,
        avoid: aiAvoidList(dto.avoid),
      });
    } catch (error: any) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnprocessableEntityException
      )
        throw error;
      this.logger.warn(`AI Writing full draft failed: ${error?.message || ''}`);
      throw new BadGatewayException(
        'Không thể soạn bài viết lúc này. Vui lòng thử lại sau.',
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
        'Không thể gợi ý đề bài viết từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('speaking/ai/suggest-practice-set')
  @ApiOperation({
    summary:
      'Gợi ý bộ luyện nói nháp, cần Admin xem lại; track (tuỳ chọn) là mã lĩnh vực đang bật',
  })
  @ApiResponse({
    status: 201,
    description: '{ title, description, level, track }',
  })
  @ApiResponse({
    status: 400,
    description: 'Lĩnh vực không tồn tại hoặc đã tắt',
  })
  async suggestSpeakingPracticeSet(@Body() dto: SuggestSpeakingPracticeSetDto) {
    try {
      const track = await this.speakingTrackContext(dto.track);
      return await this.aiService.suggestSpeakingPracticeSet({
        topic: dto.topic,
        level: dto.level,
        ...track,
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
  @ApiOperation({
    summary:
      'Gợi ý câu luyện nói nháp từ ngữ cảnh bộ luyện; track (tuỳ chọn) là mã lĩnh vực đang bật',
  })
  @ApiResponse({
    status: 400,
    description: 'Lĩnh vực không tồn tại hoặc đã tắt',
  })
  async suggestSpeakingExercises(@Body() dto: SuggestSpeakingExercisesDto) {
    try {
      const track = await this.speakingTrackContext(dto.track);
      return await this.aiService.suggestSpeakingExercises({
        practiceSetTitle: dto.practiceSetTitle,
        practiceSetDescription: dto.practiceSetDescription,
        level: dto.level,
        ...track,
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
  @ApiOperation({
    summary:
      'Soạn bộ luyện nói cùng các câu luyện nháp, chỉ loại bài không cần ảnh hay thông tin dùng chung; track (tuỳ chọn) là mã lĩnh vực đang bật',
  })
  @ApiResponse({
    status: 201,
    description:
      '{ practiceSet: { title, description, level, track }, exercises[] }',
  })
  @ApiResponse({
    status: 400,
    description:
      'Lĩnh vực không tồn tại hoặc đã tắt; hoặc taskType là DESCRIBE_PICTURE / RESPOND_USING_INFORMATION',
  })
  async suggestSpeakingFullDraft(@Body() dto: SuggestSpeakingFullDraftDto) {
    try {
      const track = await this.speakingTrackContext(dto.track);
      return await this.aiService.suggestSpeakingFullDraft({
        topic: dto.topic,
        level: dto.level,
        ...track,
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
        'Không thể soạn bộ luyện nói từ AI lúc này. Vui lòng thử lại sau.',
      );
    }
  }

  @Post('listening/ai/full-draft')
  @ApiOperation({
    summary:
      'Soạn bài Listening gồm nội dung và câu hỏi nháp; mode DIALOGUE, DICTATION hoặc COMPREHENSION',
  })
  @ApiResponse({
    status: 201,
    description:
      '{ title, description, level, mode, sentences[]? (DICTATION: 10-30 câu tiếng Anh, questions rỗng), turns? (DIALOGUE), questions[]: { prompt, options[4], correctIndex, explanation, explanationEn?, audioText? (COMPREHENSION: câu nghe riêng của từng câu), turns? (COMPREHENSION, khi là đoạn trao đổi: 2-3 lượt { speaker: A|B, text }) } }',
  })
  @ApiResponse({
    status: 502,
    description: 'AI không soạn được bản nháp hợp lệ',
  })
  async suggestListeningFullDraft(@Body() dto: SuggestListeningFullDraftDto) {
    try {
      return await this.aiService.suggestListeningFullDraft({
        topic: dto.topic,
        level: dto.level,
        mode: dto.mode,
        count: dto.count || 5,
        sourceText: dto.sourceText,
        brief: dto.brief,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(
        `AI Listening full draft failed: ${error?.message || ''}`,
      );
      throw new BadGatewayException(
        'Không thể soạn bài nghe lúc này. Vui lòng thử lại sau.',
      );
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
        brief: dto.brief,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`AI Reading full draft failed: ${error?.message || ''}`);
      throw new BadGatewayException(
        'Không thể soạn bài đọc lúc này. Vui lòng thử lại sau.',
      );
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
      const avoid = dictationAvoidList(dto.avoid);
      const draft = await this.aiService.suggestDictationLines({
        topic: dto.topic,
        level: dto.level,
        count: dto.count || 20,
        sourceText: dto.sourceText,
        avoid,
        brief: dto.brief,
      });
      return {
        ...draft,
        // A sentence the lesson already has is never offered again.
        sentences: withoutAvoided(
          normalizeDictationSentences(draft.sentences),
          avoid,
        ),
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`AI dictation failed: ${error?.message || ''}`);
      throw new BadGatewayException(
        'Không thể soạn câu nghe chép lúc này. Vui lòng thử lại sau.',
      );
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
        avoid: aiAvoidList(dto.avoid),
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
  @ApiOperation({ summary: 'Soạn chủ đề ngữ pháp cùng câu hỏi nháp' })
  @ApiResponse({
    status: 502,
    description:
      'AI không trả lời, hoặc trả bản nháp thiếu lý thuyết hay viết tiếng Việt không dấu.',
  })
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
      // The model answered, but with a draft the editor cannot use: say why.
      if (error instanceof GrammarDraftRejected)
        throw new BadGatewayException(error.message);
      throw new BadGatewayException(
        'Không thể soạn chủ đề ngữ pháp lúc này. Vui lòng thử lại sau.',
      );
    }
  }
}
