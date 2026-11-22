import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from './r2.service';
import {
  CONTENT_R2_RETRY_SET,
  type ContentFileOwner,
  contentKeyOwner,
  ownedContentKey,
  storedObjectKey,
} from './content-files.logic';

/** A stored key or URL, and the content item it came from. */
export type ContentFile = {
  owner: ContentFileOwner;
  stored: string | null | undefined;
};

/**
 * Deletes the R2 files of a deleted content item (bug 2026-11-22). Called
 * after the database delete has committed. Best effort: it never throws, and a
 * failed delete is queued in CONTENT_R2_RETRY_SET for the weekly R2 cleanup.
 */
@Injectable()
export class ContentFilesService {
  private readonly logger = new Logger(ContentFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * Deletes each file the server wrote under its owner's own prefix
   * (ownedContentKey). Anything else is left alone, and so is a key that a
   * row still points at (an exam copy shares its Speaking reference audio).
   */
  async removeFiles(files: ContentFile[]) {
    const result = { deleted: 0, inUse: 0, queued: 0 };
    const base = this.r2.getPublicUrl();
    const keys = [
      ...new Set(
        files
          .map((f) => ownedContentKey(f.owner, storedObjectKey(f.stored, base)))
          .filter((k): k is string => !!k),
      ),
    ];
    if (!keys.length) return result;
    let inUse: Set<string>;
    try {
      inUse = await this.stillReferenced(keys);
    } catch (error) {
      // No answer from the database: the retry checks again later.
      this.logger.warn(`content_files_check_failed: ${String(error)}`);
      await this.queue(keys);
      return { ...result, queued: keys.length };
    }
    result.inUse = inUse.size;
    await Promise.all(
      keys
        .filter((key) => !inUse.has(key))
        .map(async (key) => {
          try {
            await this.r2.deleteFile(key);
            result.deleted += 1;
          } catch {
            await this.queue([key]);
            result.queued += 1;
          }
        }),
    );
    this.logger.log(`content_files_removed ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * Retries the queued keys, each one validated again: a key that is not a
   * content file, whose owner still exists, or that a row still points at is
   * dropped from the queue without a delete.
   */
  async retryFailed() {
    const result = { deleted: 0, dropped: 0, failed: 0 };
    const keys = await this.redis
      .smembers(CONTENT_R2_RETRY_SET)
      .catch(() => [] as string[]);
    for (const key of keys) {
      try {
        const owner = contentKeyOwner(key);
        if (
          !owner ||
          (await this.ownerExists(owner)) ||
          (await this.stillReferenced([key])).size > 0
        ) {
          await this.redis.srem(CONTENT_R2_RETRY_SET, key);
          result.dropped += 1;
          continue;
        }
        await this.r2.deleteFile(key);
        await this.redis.srem(CONTENT_R2_RETRY_SET, key);
        result.deleted += 1;
      } catch {
        // Still failing: kept for the next run.
        result.failed += 1;
      }
    }
    if (keys.length)
      this.logger.log(`content_files_retried ${JSON.stringify(result)}`);
    return result;
  }

  private async queue(keys: string[]) {
    await this.redis.sadd(CONTENT_R2_RETRY_SET, ...keys).catch(() => 0);
  }

  private async ownerExists(owner: ContentFileOwner) {
    const count =
      owner.kind === 'listening-quiz'
        ? await this.prisma.quiz.count({ where: { id: owner.quizId } })
        : owner.kind === 'listening-question'
          ? await this.prisma.question.count({
              where: { id: owner.questionId },
            })
          : await this.prisma.speakingExercise.count({
              where: { id: owner.exerciseId },
            });
    return count > 0;
  }

  /** The keys that a remaining asset, artifact, clip or exercise still uses. */
  private async stillReferenced(keys: string[]): Promise<Set<string>> {
    const assets = await this.prisma.quizAudioAsset.findMany({
      where: { key: { in: keys } },
      select: { key: true },
    });
    const artifacts = await this.prisma.listeningAudioArtifact.findMany({
      where: { r2Key: { in: keys } },
      select: { r2Key: true },
    });
    const clips = await this.prisma.listeningDiagnosticClip.findMany({
      where: { key: { in: keys } },
      select: { key: true },
    });
    // A Speaking reference audio is stored as a key or as its public URL.
    const exercises = await this.prisma.speakingExercise.findMany({
      where: { OR: keys.map((key) => ({ audioUrl: { endsWith: key } })) },
      select: { audioUrl: true },
    });
    const used = new Set<string>([
      ...assets.map((r) => r.key),
      ...artifacts.map((r) => r.r2Key ?? ''),
      ...clips.map((r) => r.key),
    ]);
    return new Set(
      keys.filter(
        (key) =>
          used.has(key) ||
          exercises.some((r) => (r.audioUrl ?? '').endsWith(key)),
      ),
    );
  }
}
