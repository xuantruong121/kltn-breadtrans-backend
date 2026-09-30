import { Injectable, Logger } from '@nestjs/common';
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
  async runCleanup() {
    this.logger.log('Starting queued R2 audio TTL cleanup job...');

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
          NOT: { audioUrl: { startsWith: '[archived' } },
        },
        select: {
          id: true,
          audioUrl: true,
          audioKey: true,
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
        const key =
          sub.audioKey ||
          (sub.audioUrl ? this.extractKeyFromUrl(sub.audioUrl) : null);
        if (key) {
          await this.r2Service.deleteFile(key);
        }

        // Cập nhật URL trong DB đánh dấu đã lưu trữ/dọn dẹp
        await this.prisma.speakingSubmission.update({
          where: { id: sub.id },
          data: { audioUrl: '[archived_after_90d]', audioKey: null },
        });

        deletedCount++;
      }

      this.logger.log(
        `Successfully cleaned up ${deletedCount} expired audio file(s) from Cloudflare R2.`,
      );

      // Also clean up orphan speaking upload intents
      await this.cleanupOrphanUploadIntents();
    } catch (error) {
      this.logger.error('Failed to cleanup expired R2 audio files', error);
      throw error;
    }
  }

  /**
   * Phase 2: Dọn dẹp các upload intents mồ côi (chưa hoàn tất và đã hết hạn)
   * và xóa các file rác tạm trong R2 thuộc prefix speaking/pending.
   * Đảm bảo:
   * - Tuyệt đối không xóa audio thuộc bài nộp hợp lệ (đã finalized hoặc có submissionId).
   * - Bounded batches (take: 100).
   * - Trả về structured counts: intentsInspected, objectsDeleted, recordsExpired, failures.
   */
  async cleanupOrphanUploadIntents(batchSize: number = 100): Promise<{
    intentsInspected: number;
    objectsDeleted: number;
    recordsExpired: number;
    staleRecoveredToPending: number;
    staleReconciledToFinalized: number;
    failures: number;
  }> {
    const counts = {
      intentsInspected: 0,
      objectsDeleted: 0,
      recordsExpired: 0,
      staleRecoveredToPending: 0,
      staleReconciledToFinalized: 0,
      failures: 0,
    };

    const now = new Date();
    const rawLease = Number(
      process.env.SPEAKING_FINALIZATION_LEASE_MS || 60000,
    );
    const leaseMs = Math.min(
      Math.max(isNaN(rawLease) ? 60000 : rawLease, 15000),
      300000,
    );
    const staleThreshold = new Date(now.getTime() - leaseMs);

    try {
      // 1. Reconcile stale FINALIZING intents whose lease has expired
      const staleFinalizingIntents =
        await this.prisma.speakingUploadIntent.findMany({
          where: {
            status: 'FINALIZING',
            finalizationStartedAt: { lt: staleThreshold },
          },
          take: batchSize,
        });

      for (const stale of staleFinalizingIntents) {
        counts.intentsInspected++;
        try {
          // Check if submission already exists for this intent
          let linkedSubId = stale.submissionId;
          if (!linkedSubId) {
            const sub = await this.prisma.speakingSubmission.findFirst({
              where: { audioKey: stale.objectKey },
              select: { id: true },
            });
            if (sub) linkedSubId = sub.id;
          }

          if (linkedSubId) {
            // Reconcile to FINALIZED
            const res = await this.prisma.speakingUploadIntent.updateMany({
              where: {
                id: stale.id,
                status: 'FINALIZING',
              },
              data: {
                status: 'FINALIZED',
                submissionId: linkedSubId,
                finalizationToken: null,
                finalizationStartedAt: null,
              },
            });
            if (res.count > 0) {
              counts.staleReconciledToFinalized++;
            }
            continue;
          }

          // No submission exists
          if (stale.expiresAt < now) {
            // Claim directly to EXPIRED for cleanup
            const claim = await this.prisma.speakingUploadIntent.updateMany({
              where: {
                id: stale.id,
                status: 'FINALIZING',
                finalizationToken: stale.finalizationToken,
              },
              data: {
                status: 'EXPIRED',
                finalizationToken: null,
                finalizationStartedAt: null,
              },
            });
            if (claim.count > 0) {
              counts.recordsExpired++;
              const exists = await this.r2Service.objectExists(stale.objectKey);
              if (exists) {
                await this.r2Service.deleteFile(stale.objectKey);
                counts.objectsDeleted++;
              }
            }
          } else {
            // Intent is still unexpired: safely revert to PENDING
            const reset = await this.prisma.speakingUploadIntent.updateMany({
              where: {
                id: stale.id,
                status: 'FINALIZING',
                finalizationToken: stale.finalizationToken,
              },
              data: {
                status: 'PENDING',
                finalizationToken: null,
                finalizationStartedAt: null,
              },
            });
            if (reset.count > 0) {
              counts.staleRecoveredToPending++;
            }
          }
        } catch (staleErr) {
          counts.failures++;
          this.logger.error(
            `Failed to reconcile stale intent ${stale.id}: ${staleErr}`,
          );
        }
      }

      // 2. Clean up ordinary expired or invalid intents
      const expiredIntents = await this.prisma.speakingUploadIntent.findMany({
        where: {
          OR: [
            { status: 'PENDING', expiresAt: { lt: now } },
            { status: 'EXPIRED' },
            { status: 'INVALID' },
          ],
        },
        take: batchSize,
        orderBy: { createdAt: 'asc' },
      });

      for (const intent of expiredIntents) {
        counts.intentsInspected++;
        try {
          // Invariant: NEVER delete audio belonging to a valid finalized submission
          if (intent.submissionId) {
            continue;
          }

          // Double check whether a submission references this objectKey
          const existingSub = await this.prisma.speakingSubmission.findFirst({
            where: { audioKey: intent.objectKey },
            select: { id: true },
          });

          if (existingSub) {
            this.logger.warn(
              `Intent ${intent.id} has objectKey ${intent.objectKey} tied to submission #${existingSub.id}. Skipping deletion.`,
            );
            await this.prisma.speakingUploadIntent.update({
              where: { id: intent.id },
              data: { status: 'FINALIZED', submissionId: existingSub.id },
            });
            continue;
          }

          // Cleanup claim rule: if PENDING, must atomically claim PENDING -> EXPIRED first
          if (intent.status === 'PENDING') {
            const claimResult =
              await this.prisma.speakingUploadIntent.updateMany({
                where: {
                  id: intent.id,
                  status: 'PENDING',
                  expiresAt: { lt: now },
                },
                data: { status: 'EXPIRED' },
              });
            if (claimResult.count === 0) {
              // Another concurrent request claimed or finalized it
              continue;
            }
            counts.recordsExpired++;
          }

          // Safe to delete temporary object from storage
          const exists = await this.r2Service.objectExists(intent.objectKey);
          if (exists) {
            await this.r2Service.deleteFile(intent.objectKey);
            counts.objectsDeleted++;
          }
        } catch (itemErr) {
          counts.failures++;
          this.logger.error(
            `Failed to cleanup orphan intent ${intent.id}: ${itemErr}`,
          );
        }
      }

      this.logger.log(
        `Orphan intent cleanup completed: inspected=${counts.intentsInspected}, deleted=${counts.objectsDeleted}, expired=${counts.recordsExpired}, staleToPending=${counts.staleRecoveredToPending}, staleToFinalized=${counts.staleReconciledToFinalized}, failures=${counts.failures}`,
      );
    } catch (err) {
      this.logger.error('Error during cleanupOrphanUploadIntents', err);
    }

    return counts;
  }

  // Backward-compatible admin entry point. Automated execution uses the queue.
  async cleanupOldSpeakingAudioFiles() {
    return this.runCleanup();
  }
}
