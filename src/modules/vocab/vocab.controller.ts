import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
  Body,
  Query,
} from '@nestjs/common';
import { VocabService } from './vocab.service';
import { isSrsGrade } from './srs.logic';
import { parseReviewEvidence } from './review-grade.logic';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';

@ApiTags('Vocab')
@Controller('vocab')
export class VocabController {
  constructor(private readonly vocabService: VocabService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('lookup')
  @ApiOperation({
    summary: 'Tra cứu từ vựng nhanh với dữ liệu curated và fallback dictionary',
    description:
      'Ưu tiên VocabWord curated, sau đó cache Redis và external dictionary fallback.',
  })
  @ApiQuery({ name: 'word', required: true, description: 'Từ cần tra cứu' })
  lookupWord(@Query('word') word: string, @Request() req: any) {
    return this.vocabService.lookupWord(word, req.user?.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('lookup/details')
  @ApiOperation({
    summary: 'Bổ sung IPA và các loại từ từ nguồn từ điển mở rộng',
    description:
      'Được gọi sau tra cứu local để cập nhật progressive, không chặn kết quả ban đầu.',
  })
  @ApiQuery({ name: 'word', required: true, description: 'Từ cần tra cứu' })
  lookupWordDetails(@Query('word') word: string, @Request() req: any) {
    return this.vocabService.lookupExtendedWord(word, req.user?.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('saved')
  @ApiOperation({ summary: 'Lấy danh sách từ vựng cá nhân đã lưu' })
  listSavedWords(@Request() req: any) {
    return this.vocabService.listSavedWords(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('saved')
  @ApiOperation({ summary: 'Lưu một từ vào từ vựng cá nhân' })
  saveWord(@Body('word') word: string, @Request() req: any) {
    return this.vocabService.saveWord(req.user.id, word);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete('saved/:id')
  @ApiOperation({ summary: 'Xóa từ khỏi từ vựng cá nhân của chính mình' })
  removeSavedWord(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.vocabService.removeSavedWord(req.user.id, id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('topics')
  @ApiOperation({ summary: 'Lấy danh sách các chủ đề từ vựng TOEIC' })
  getTopics(@Request() req: any) {
    const userId = req?.user?.id;
    return this.vocabService.getTopics(userId);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('topics/:id')
  @ApiOperation({ summary: 'Lấy chi tiết 1 chủ đề từ vựng và danh sách từ' })
  getTopicDetails(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    const userId = req?.user?.id;
    return this.vocabService.getTopicDetails(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('words/:id/star')
  @ApiOperation({ summary: 'Đánh dấu Yêu thích / Bỏ yêu thích từ vựng' })
  toggleStar(@Param('id', ParseIntPipe) wordId: number, @Request() req: any) {
    return this.vocabService.toggleStar(req.user.id, wordId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('words/:id/master')
  @ApiOperation({ summary: 'Đánh dấu Đã thuộc / Bỏ thuộc từ vựng' })
  setMastered(
    @Param('id', ParseIntPipe) wordId: number,
    @Body('isMastered') isMastered: boolean,
    @Request() req: any,
  ) {
    return this.vocabService.setMastered(req.user.id, wordId, isMastered);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('words/:id/review')
  @ApiOperation({
    summary: 'Cập nhật tiến độ ôn tập SRS sau khi học/làm trắc nghiệm',
    description:
      'Phòng flashcard gửi `evidence` (kết quả trắc nghiệm, gõ từ, số gợi ý, phát âm, nút Đã nhớ); máy chủ tự xếp mức nhớ và trả về `grade`. `grade` hoặc `isCorrect` vẫn được nhận cho các nơi gọi cũ.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        evidence: {
          type: 'object',
          properties: {
            quiz: { enum: ['CORRECT', 'WRONG', 'SKIPPED'] },
            typing: { enum: ['CORRECT', 'WRONG', 'SKIPPED'] },
            typingHints: { type: 'integer', minimum: 0, maximum: 50 },
            speaking: { enum: ['PASSED', 'FAILED', 'UNAVAILABLE', 'SKIPPED'] },
            quickCheck: { type: 'boolean' },
          },
        },
        grade: { enum: ['AGAIN', 'HARD', 'GOOD', 'EASY'] },
        isCorrect: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Tiến độ mới của từ, kèm `grade` và `xpEarned`.',
  })
  @ApiResponse({ status: 400, description: 'Kết quả các bước không hợp lệ.' })
  submitReview(
    @Param('id', ParseIntPipe) wordId: number,
    @Body('isCorrect') isCorrect: boolean,
    @Body('grade') grade: unknown,
    @Body('evidence') rawEvidence: unknown,
    @Request() req: any,
  ) {
    if (grade !== undefined && grade !== null && !isSrsGrade(grade)) {
      throw new BadRequestException(
        'grade phải là AGAIN, HARD, GOOD hoặc EASY',
      );
    }
    const evidence =
      rawEvidence === undefined || rawEvidence === null
        ? undefined
        : parseReviewEvidence(rawEvidence);
    if (evidence === null) {
      throw new BadRequestException('Kết quả các bước học không hợp lệ.');
    }
    return this.vocabService.submitReview(
      req.user.id,
      wordId,
      isCorrect,
      isSrsGrade(grade) ? grade : undefined,
      evidence,
    );
  }
}
