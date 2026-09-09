import {
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
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
  })
  submitReview(
    @Param('id', ParseIntPipe) wordId: number,
    @Body('isCorrect') isCorrect: boolean,
    @Request() req: any,
  ) {
    return this.vocabService.submitReview(req.user.id, wordId, isCorrect);
  }
}
