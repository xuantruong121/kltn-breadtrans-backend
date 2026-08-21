import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from './r2.service';

@Injectable()
export class R2CleanupService {
  private readonly logger = new Logger(R2CleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2Service: R2Service,
  ) {}

  /**
   * Trích xuất object key từ URL Cloudflare R2
   */
  private extractKeyFromUrl(url: string): string | null {
    if (!url || url.startsWith('[archived')) return null;
    try {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const parsed = new URL(url);
        return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      }
      if (url.includes('speaking_audio/')) {
        return url.substring(url.indexOf('speaking_audio/'));
      }
      return url;
    } catch {
      return null;
    }
  }

  /**
   * Cron job tự động dọn dẹp các file audio ghi âm học sinh cũ hơn 90 ngày.
   * Chạy vào lúc 03:00 sáng mỗi Chủ Nhật hàng tuần.
   * Giúp tiết kiệm chi phí lưu trữ Cloudflare R2 theo chính sách TTL.
   */
  @Cron(CronExpression.EVERY_WEEK)
  async cleanupOldSpeakingAudioFiles() {
    this.logger.log('Starting automated R2 audio TTL cleanup job...');

    const retentionDays = 90;
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - retentionDays);

    try {
      // Tìm các bài nộp phát âm đã lưu quá 90 ngày và chưa bị dọn dẹp
      const oldSubmissions = await this.prisma.speakingSubmission.findMany({
        where: {
          submittedAt: {
            lt: thresholdDate,
          },
          audioUrl: {
            not: '',
          },
        },
        select: {
          id: true,
          audioUrl: true,
        },
        take: 100, // Batch xử lý 100 file mỗi lần để tránh nghẽn I/O
      });

      if (oldSubmissions.length === 0) {
        this.logger.log(
          `No speaking audio files older than ${retentionDays} days found to cleanup.`,
        );
        return;
      }

      this.logger.log(
        `Found ${oldSubmissions.length} audio file(s) older than ${retentionDays} days. Deleting from R2...`,
      );

      let deletedCount = 0;
      for (const sub of oldSubmissions) {
        const key = this.extractKeyFromUrl(sub.audioUrl);
        if (key) {
          await this.r2Service.deleteFile(key);
        }

        // Cập nhật URL trong DB đánh dấu đã lưu trữ/dọn dẹp
        await this.prisma.speakingSubmission.update({
          where: { id: sub.id },
          data: { audioUrl: '[archived_after_90d]' },
        });

        deletedCount++;
      }

      this.logger.log(
        `Successfully cleaned up ${deletedCount} expired audio file(s) from Cloudflare R2.`,
      );
    } catch (error) {
      this.logger.error('Failed to cleanup expired R2 audio files', error);
    }
  }
}
