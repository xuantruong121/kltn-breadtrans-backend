import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseFilePipe,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateSuggestionDto } from './dto/create-suggestion.dto';
import { SuggestionQueryDto } from './dto/suggestion-query.dto';
import { SuggestionService } from './suggestion.service';
import { UploadService } from '../upload/upload.service';
import { assertValidContentImageUpload } from '../upload/content-image-validation';

@ApiTags('suggestions')
@Controller('suggestions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SuggestionController {
  constructor(
    private readonly service: SuggestionService,
    private readonly uploadService: UploadService,
  ) {}

  @Post('attachments')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Tải tệp đính kèm an toàn cho đề xuất' })
  async uploadAttachment(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ) {
    const mimeType = file.mimetype.toLowerCase();
    const allowedTypes = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ]);
    if (!allowedTypes.has(mimeType)) {
      throw new BadRequestException(
        'Chỉ hỗ trợ PNG, JPG, WEBP, PDF, DOC, DOCX hoặc TXT.',
      );
    }
    if (mimeType.startsWith('image/')) {
      assertValidContentImageUpload(file);
    }
    const result = await this.uploadService.uploadFile(file);
    return {
      url: result.url,
      name: file.originalname,
      type: file.mimetype.toLowerCase().startsWith('image/') ? 'IMAGE' : 'FILE',
    };
  }

  @Post()
  @ApiOperation({ summary: 'Học viên gửi đề xuất hoặc góp ý' })
  create(
    @Request() req: { user: { id: number } },
    @Body() dto: CreateSuggestionDto,
  ) {
    return this.service.create(req.user.id, dto);
  }
  @Get('me')
  @ApiOperation({ summary: 'Học viên xem đề xuất của mình' })
  listMine(
    @Request() req: { user: { id: number } },
    @Query() query: SuggestionQueryDto,
  ) {
    return this.service.listMine(req.user.id, query);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Học viên xem chi tiết đề xuất của mình' })
  getMine(
    @Request() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.getMine(req.user.id, id);
  }
}
