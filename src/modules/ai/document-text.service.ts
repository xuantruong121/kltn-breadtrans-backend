import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

/** Reads the text of an uploaded document. Nothing is stored. */
@Injectable()
export class DocumentTextService {
  private readonly logger = new Logger(DocumentTextService.name);

  async extractTextFromBuffer(
    buffer: Buffer,
    mimetype: string,
    filename: string,
  ): Promise<string> {
    const lowerName = filename.toLowerCase();

    try {
      if (mimetype === 'application/pdf' || lowerName.endsWith('.pdf')) {
        this.logger.log(
          `Extracting text from PDF: ${filename} (${buffer.length} bytes)`,
        );
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        const text = String(result?.text || '').trim();
        await parser.destroy().catch(() => {});
        if (!text) {
          throw new BadRequestException(
            'File PDF không có nội dung văn bản (có thể là file scan hoặc ảnh).',
          );
        }
        return text;
      }

      if (
        mimetype ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        lowerName.endsWith('.docx')
      ) {
        this.logger.log(`Extracting text from DOCX: ${filename}`);
        const result = await mammoth.extractRawText({ buffer });
        return String(result?.value || '').trim();
      }

      // Default plain text
      return buffer.toString('utf-8').trim();
    } catch (error: any) {
      this.logger.error(
        `Error extracting text from file ${filename}: ${error.message}`,
      );
      throw new BadRequestException(
        `Không thể trích xuất văn bản từ file: ${error.message}`,
      );
    }
  }
}
