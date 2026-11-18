import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { AiGenerationJobStatus, Prisma, Role } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from '../upload/r2.service';
import { forgetAuthUser } from '../auth/auth-user-cache';
import { AuthSessionStore } from '../auth/session-store';
import { assertKeepsAnAdmin } from '../admin/admin-roster';
import {
  KEPT_TABLES,
  type KeptTable,
  R2_RETRY_SET,
  SCRUBBED_RECIPIENT,
  hasKeptRecords,
  shellEmail,
  storageKeyOf,
} from './account-deletion.logic';

export type PurgeOutcome = 'DELETED' | 'ANONYMIZED';
/** The job found the account no longer due (cancelled meanwhile): kept. */
export type PurgeResult = PurgeOutcome | 'SKIPPED';

/**
 * Deletes accounts whose grace period has ended (owner 2026-11-16), and the
 * admin "Xoá" uses the same path. Personal and learning data goes for real;
 * orders, payments and the ledger move to an anonymous shell first (soft-delete
 * rule). Files in R2 are deleted after the database commit; a failed file is
 * retried by the next run.
 */
@Injectable()
export class AccountPurgeService {
  private readonly logger = new Logger(AccountPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /** Every account due at `now`, at most `limit` per run. */
  async runDue(now = new Date(), limit = 50) {
    const retried = await this.retryFiles();
    const due = await this.prisma.user.findMany({
      where: { deletionScheduledAt: { lte: now }, anonymizedAt: null },
      select: { id: true },
      orderBy: { deletionScheduledAt: 'asc' },
      take: limit,
    });
    const result = {
      deleted: 0,
      anonymized: 0,
      skipped: 0,
      failed: 0,
      filesRetried: retried,
    };
    for (const { id } of due) {
      try {
        // The list may be stale by now: a learner who cancels while earlier
        // accounts are purged must be kept (audit A1, 2026-11-18).
        const outcome = await this.purgeUser(id, now, { onlyIfDue: true });
        if (outcome === 'DELETED') result.deleted += 1;
        else if (outcome === 'SKIPPED') result.skipped += 1;
        else result.anonymized += 1;
      } catch (error) {
        result.failed += 1;
        this.logger.error(`account_purge_failed user=${id}: ${String(error)}`);
      }
    }
    if (due.length) this.logger.log(`account_purge ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * Deletes one account now: hard delete, or anonymous shell when records must
   * stay. With `onlyIfDue` (the scheduled job) an account whose deletion was
   * cancelled, or moved later, is left alone: the check runs under the row
   * lock, so a cancel committed before it always wins.
   */
  async purgeUser(
    userId: number,
    now?: Date,
    options?: { onlyIfDue?: false },
  ): Promise<PurgeOutcome>;
  async purgeUser(
    userId: number,
    now: Date,
    options: { onlyIfDue: true },
  ): Promise<PurgeResult>;
  async purgeUser(
    userId: number,
    now = new Date(),
    options: { onlyIfDue?: boolean } = {},
  ): Promise<PurgeResult> {
    const files = await this.filesOf(userId);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          id: number;
          role: Role;
          anonymizedAt: Date | null;
          deletionScheduledAt: Date | null;
        }>
      >`
        SELECT id, role, "anonymizedAt", "deletionScheduledAt" FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (!locked.length)
        throw new NotFoundException('Người dùng không tồn tại');
      // A shell already holds only kept records: nothing personal left.
      if (locked[0].anonymizedAt)
        throw new BadRequestException('Tài khoản này đã được ẩn danh.');
      const scheduled = locked[0].deletionScheduledAt;
      if (
        options.onlyIfDue &&
        (!scheduled || scheduled.getTime() > now.getTime())
      )
        return 'SKIPPED' as const;
      // The last admin is never purged (audit A9, 2026-11-18).
      if (locked[0].role === Role.ADMIN) await assertKeepsAnAdmin(tx, userId);

      // Exam links to the learner's submissions have a Restrict key: first.
      await tx.toeicAssessmentSpeakingSubmission.deleteMany({
        where: { speakingSubmission: { userId } },
      });
      await tx.toeicAssessmentWritingSubmission.deleteMany({
        where: { submission: { userId } },
      });
      await tx.gameBattle.updateMany({
        where: { winnerUserId: userId },
        data: { winnerUserId: null },
      });

      const counts = await this.keptCounts(tx, userId);
      // An admin's AI exam jobs keep their creator by a Restrict key: the
      // purge failed on them (audit A9 follow-up, 2026-11-18). They are the exam
      // history, so they move to the shell like orders.
      const aiJobs = await tx.aiGenerationJob.count({
        where: { createdByAdminId: userId },
      });
      let result: PurgeOutcome = 'DELETED';
      if (hasKeptRecords(counts) || aiJobs > 0) {
        const shell = await tx.user.create({
          data: {
            email: shellEmail(userId, now),
            password: null,
            anonymizedAt: now,
          },
          select: { id: true },
        });
        const to = { userId: shell.id };
        const where = { userId };
        await tx.subscription.updateMany({ where, data: to });
        await tx.planPurchase.updateMany({ where, data: to });
        await tx.payOSPaymentIntent.updateMany({ where, data: to });
        await tx.marketOrder.updateMany({ where, data: to });
        await tx.marketPhysicalRedemption.updateMany({
          where,
          data: { ...to, ...SCRUBBED_RECIPIENT },
        });
        await tx.banhTransaction.updateMany({ where, data: to });
        await tx.promoRedemption.updateMany({ where, data: to });
        await tx.currencyTransaction.updateMany({ where, data: to });
        if (aiJobs > 0) {
          // Nobody is left to review a job still running: it stops at the
          // worker's next check, as a cancel does.
          await tx.aiGenerationJob.updateMany({
            where: {
              createdByAdminId: userId,
              status: {
                in: [
                  AiGenerationJobStatus.QUEUED,
                  AiGenerationJobStatus.PROCESSING,
                ],
              },
            },
            data: {
              status: AiGenerationJobStatus.CANCELLED,
              errorSummary: 'Tài khoản người tạo đã bị xoá.',
            },
          });
          await tx.aiGenerationJob.updateMany({
            where: { createdByAdminId: userId },
            data: { createdByAdminId: shell.id },
          });
        }
        result = 'ANONYMIZED';
      }
      // Everything else of the learner cascades with the account.
      await tx.user.delete({ where: { id: userId } });
      return result;
    });
    if (outcome === 'SKIPPED') {
      this.logger.log(`account_purge_skipped user=${userId}: no longer due`);
      return outcome;
    }

    forgetAuthUser(userId);
    await new AuthSessionStore(this.redis).revokeAll(userId).catch(() => 0);
    await this.deleteFiles(files);
    this.logger.log(
      `account_purged user=${userId} outcome=${outcome} files=${files.length}`,
    );
    return outcome;
  }

  private async keptCounts(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<Record<KeptTable, number>> {
    const where = { userId };
    const [a, b, c, d, e, f, g, h] = await Promise.all([
      tx.subscription.count({ where }),
      tx.planPurchase.count({ where }),
      tx.payOSPaymentIntent.count({ where }),
      tx.marketOrder.count({ where }),
      tx.marketPhysicalRedemption.count({ where }),
      tx.banhTransaction.count({ where }),
      tx.promoRedemption.count({ where }),
      tx.currencyTransaction.count({ where }),
    ]);
    const values = [a, b, c, d, e, f, g, h];
    return Object.fromEntries(
      KEPT_TABLES.map((t, i) => [t, values[i]]),
    ) as Record<KeptTable, number>;
  }

  /** R2 keys of the learner's own files: recordings, uploads, avatar, attachments. */
  async filesOf(userId: number): Promise<string[]> {
    const base = this.r2.getPublicUrl();
    const [speaking, intents, diagnostic, toeicSw, profile, attachments] =
      await Promise.all([
        this.prisma.speakingSubmission.findMany({
          where: { userId },
          select: { audioKey: true },
        }),
        this.prisma.speakingUploadIntent.findMany({
          where: { userId },
          select: { objectKey: true },
        }),
        this.prisma.diagnosticSpeakingResponse.findMany({
          where: { userId },
          select: { audioKey: true },
        }),
        this.prisma.toeicSpeakingWritingSubmission.findMany({
          where: { userId },
          select: { audioUrl: true },
        }),
        this.prisma.profile.findUnique({
          where: { userId },
          select: { avatar: true },
        }),
        this.prisma.suggestionAttachment.findMany({
          where: { suggestion: { userId } },
          select: { url: true },
        }),
      ]);
    const refs = [
      ...speaking.map((r) => r.audioKey),
      ...intents.map((r) => r.objectKey),
      ...diagnostic.map((r) => r.audioKey),
      ...toeicSw.map((r) => r.audioUrl),
      profile?.avatar,
      ...attachments.map((r) => r.url),
    ];
    return [
      ...new Set(
        refs
          .map((ref) => storageKeyOf(ref, base))
          .filter((k): k is string => !!k),
      ),
    ];
  }

  private async deleteFiles(keys: string[]) {
    for (const key of keys) {
      try {
        await this.r2.deleteFile(key);
      } catch {
        await this.redis.sadd(R2_RETRY_SET, key).catch(() => 0);
      }
    }
  }

  private async retryFiles(): Promise<number> {
    const keys = await this.redis
      .smembers(R2_RETRY_SET)
      .catch(() => [] as string[]);
    let done = 0;
    for (const key of keys) {
      try {
        await this.r2.deleteFile(key);
        await this.redis.srem(R2_RETRY_SET, key);
        done += 1;
      } catch {
        // Still failing: kept for the next run.
      }
    }
    return done;
  }
}
