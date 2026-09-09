import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class VocabService {
  private readonly logger = new Logger(VocabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private isMissingCollocations(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2022' &&
      String(error).toLowerCase().includes('collocations')
    );
  }

  private async emitVocabLearned(userId: number): Promise<void> {
    await this.eventEmitter.emitAsync('vocab.learned', {
      userId,
      count: 1,
      source: 'vocabulary_review',
    });
  }

  private async recordMasteryActivity(
    userId: number,
    wordId: number,
  ): Promise<void> {
    try {
      await this.prisma.learningActivity.create({
        data: {
          userId,
          type: 'VOCABULARY_MASTERED',
          title: 'Học từ vựng',
          detail: 'Đã ghi nhớ một từ vựng mới.',
          sourceType: 'VOCAB_WORD',
          sourceId: String(wordId),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Could not record vocabulary activity for user ${userId}, word ${wordId}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async getTopics(userId?: number) {
    const topics = await this.prisma.vocabTopic.findMany({
      include: {
        _count: { select: { words: true } },
      },
      orderBy: { id: 'asc' },
    });

    // Fetch user progress if userId is provided
    const userProgressMap: Record<
      number,
      { mastered: number; starred: number; needReview: number }
    > = {};
    if (userId) {
      let userProgresses: Array<{
        isMastered: boolean;
        isStarred: boolean;
        word: { topicId: number };
      }>;
      try {
        userProgresses = await this.prisma.userVocabWordProgress.findMany({
          where: { userId },
          include: { word: true },
        });
      } catch (error) {
        if (!this.isMissingCollocations(error)) throw error;
        userProgresses = await this.prisma.userVocabWordProgress.findMany({
          where: { userId },
          select: {
            isMastered: true,
            isStarred: true,
            word: { select: { topicId: true } },
          },
        });
      }

      userProgresses.forEach((p) => {
        const topicId = p.word.topicId;
        if (!userProgressMap[topicId]) {
          userProgressMap[topicId] = { mastered: 0, starred: 0, needReview: 0 };
        }
        if (p.isMastered) {
          userProgressMap[topicId].mastered += 1;
        } else {
          userProgressMap[topicId].needReview += 1;
        }
        if (p.isStarred) userProgressMap[topicId].starred += 1;
      });
    }

    // Group by category
    const categoriesMap: Record<string, any[]> = {};
    topics.forEach((t) => {
      const cat = t.categoryName || '600 TỪ VỰNG TOEIC';
      if (!categoriesMap[cat]) categoriesMap[cat] = [];
      const prog = userProgressMap[t.id] || {
        mastered: 0,
        starred: 0,
        needReview: 0,
      };
      categoriesMap[cat].push({
        id: t.id,
        title: t.title,
        categoryName: t.categoryName,
        totalWords: t.totalWords,
        learnedCount: prog.mastered,
        needReviewCount: prog.needReview,
        isPro: t.isPro,
      });
    });

    const categories = Object.keys(categoriesMap).map((catName) => ({
      name: catName,
      count: categoriesMap[catName].length,
      topics: categoriesMap[catName],
    }));

    const allQuizzes = topics.map((t) => {
      const prog = userProgressMap[t.id] || {
        mastered: 0,
        starred: 0,
        needReview: 0,
      };
      return {
        id: t.id,
        title: t.title,
        categoryName: t.categoryName,
        totalWords: t.totalWords,
        learnedCount: prog.mastered,
        needReviewCount: prog.needReview,
        isPro: t.isPro,
      };
    });

    return {
      categories,
      topics: allQuizzes,
    };
  }

  async getTopicDetails(topicId: number, userId?: number) {
    let topic: {
      id: number;
      title: string;
      categoryName: string;
      words: Array<{
        id: number;
        word: string;
        pos: string;
        ipaUs: string | null;
        ipaUk: string | null;
        meaning: string;
        audioUs: string | null;
        audioUk: string | null;
        exampleEn: string | null;
        exampleVi: string | null;
        order: number;
        collocations?: unknown;
      }>;
    } | null;
    try {
      topic = await this.prisma.vocabTopic.findUnique({
        where: { id: topicId },
        include: { words: { orderBy: { order: 'asc' } } },
      });
    } catch (error) {
      if (!this.isMissingCollocations(error)) throw error;
      topic = await this.prisma.vocabTopic.findUnique({
        where: { id: topicId },
        select: {
          id: true,
          title: true,
          categoryName: true,
          words: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              word: true,
              pos: true,
              ipaUs: true,
              ipaUk: true,
              meaning: true,
              audioUs: true,
              audioUk: true,
              exampleEn: true,
              exampleVi: true,
              order: true,
            },
          },
        },
      });
    }

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    const userProgressMap: Record<
      number,
      { isStarred: boolean; isMastered: boolean }
    > = {};
    if (userId) {
      let progresses: Array<{
        wordId: number;
        isStarred: boolean;
        isMastered: boolean;
      }>;
      try {
        progresses = await this.prisma.userVocabWordProgress.findMany({
          where: { userId, word: { topicId } },
        });
      } catch (error) {
        if (!this.isMissingCollocations(error)) throw error;
        progresses = await this.prisma.userVocabWordProgress.findMany({
          where: { userId, word: { topicId } },
          select: { wordId: true, isStarred: true, isMastered: true },
        });
      }
      progresses.forEach((p) => {
        userProgressMap[p.wordId] = {
          isStarred: p.isStarred,
          isMastered: p.isMastered,
        };
      });
    }

    const words = topic.words.map((w) => {
      const prog = userProgressMap[w.id] || {
        isStarred: false,
        isMastered: false,
      };
      return {
        id: w.id,
        word: w.word,
        pos: w.pos,
        ipaUs: w.ipaUs,
        ipaUk: w.ipaUk,
        meaning: w.meaning,
        audioUs: w.audioUs,
        audioUk: w.audioUk,
        exampleEn: w.exampleEn,
        exampleVi: w.exampleVi,
        collocations: w.collocations,
        isStarred: prog.isStarred,
        isMastered: prog.isMastered,
      };
    });

    return {
      topicId: topic.id,
      title: topic.title,
      categoryName: topic.categoryName,
      totalWords: words.length,
      words,
    };
  }

  async toggleStar(userId: number, wordId: number) {
    const existing = await this.prisma.userVocabWordProgress.findUnique({
      where: { userId_wordId: { userId, wordId } },
    });

    if (existing) {
      const updated = await this.prisma.userVocabWordProgress.update({
        where: { id: existing.id },
        data: { isStarred: !existing.isStarred },
      });
      return { isStarred: updated.isStarred };
    } else {
      const created = await this.prisma.userVocabWordProgress.create({
        data: { userId, wordId, isStarred: true },
      });
      return { isStarred: created.isStarred };
    }
  }

  private calculateNextReviewAt(reviewCount: number, isCorrect: boolean): Date {
    const now = Date.now();
    if (!isCorrect) {
      return new Date(now + 10 * 60 * 1000); // 10 minutes
    }
    if (reviewCount <= 1) {
      return new Date(now + 24 * 60 * 60 * 1000); // 1 day
    }
    if (reviewCount === 2) {
      return new Date(now + 3 * 24 * 60 * 60 * 1000); // 3 days
    }
    return new Date(now + 7 * 24 * 60 * 60 * 1000); // 7 days
  }

  async setMastered(userId: number, wordId: number, isMastered: boolean) {
    const existing = await this.prisma.userVocabWordProgress.findUnique({
      where: { userId_wordId: { userId, wordId } },
    });

    const nextReviewAt = isMastered
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 10 * 60 * 1000);

    if (existing) {
      const updated = await this.prisma.userVocabWordProgress.update({
        where: { id: existing.id },
        data: {
          isMastered,
          nextReviewAt,
          remindedAt: null,
          lastReviewedAt: new Date(),
        },
      });
      if (updated.isMastered && !existing.isMastered) {
        await this.recordMasteryActivity(userId, wordId);
        await this.emitVocabLearned(userId);
      }
      return {
        isMastered: updated.isMastered,
        nextReviewAt: updated.nextReviewAt,
      };
    } else {
      const created = await this.prisma.userVocabWordProgress.create({
        data: {
          userId,
          wordId,
          isMastered,
          nextReviewAt,
          remindedAt: null,
          lastReviewedAt: new Date(),
        },
      });
      if (created.isMastered) {
        await this.recordMasteryActivity(userId, wordId);
        await this.emitVocabLearned(userId);
      }
      return {
        isMastered: created.isMastered,
        nextReviewAt: created.nextReviewAt,
      };
    }
  }

  async submitReview(userId: number, wordId: number, isCorrect: boolean) {
    const existing = await this.prisma.userVocabWordProgress.findUnique({
      where: { userId_wordId: { userId, wordId } },
    });

    const newReviewCount = (existing?.reviewCount || 0) + 1;
    const isMastered = isCorrect
      ? existing?.isMastered || newReviewCount >= 2
      : false;
    const nextReviewAt = this.calculateNextReviewAt(newReviewCount, isCorrect);

    if (existing) {
      const updated = await this.prisma.userVocabWordProgress.update({
        where: { id: existing.id },
        data: {
          reviewCount: newReviewCount,
          isMastered,
          lastReviewedAt: new Date(),
          nextReviewAt,
          remindedAt: null,
        },
      });
      if (updated.isMastered && !existing.isMastered) {
        await this.recordMasteryActivity(userId, wordId);
        await this.emitVocabLearned(userId);
      }
      return updated;
    } else {
      const created = await this.prisma.userVocabWordProgress.create({
        data: {
          userId,
          wordId,
          reviewCount: 1,
          isMastered: isCorrect,
          lastReviewedAt: new Date(),
          nextReviewAt,
          remindedAt: null,
        },
      });
      if (created.isMastered) {
        await this.recordMasteryActivity(userId, wordId);
        await this.emitVocabLearned(userId);
      }
      return created;
    }
  }

  /**
   * Phase 4: Interactive vocabulary dictionary lookup backed by local VocabWord.
   * Normalizes punctuation, checks exact matches first, then common inflections.
   * Invalid input is rejected, while a valid but uncatalogued word returns an
   * empty result so the speaking popup can fall back to direct practice.
   */
  async lookupWord(rawWord: string) {
    if (
      !rawWord ||
      typeof rawWord !== 'string' ||
      rawWord.trim().length === 0
    ) {
      throw new BadRequestException('Word is required for dictionary lookup');
    }

    // Normalize lowercase and strip surrounding punctuation/symbols
    const cleanWord = rawWord
      .trim()
      .toLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

    if (!cleanWord) {
      throw new BadRequestException(
        'A valid word is required for dictionary lookup',
      );
    }

    const selectFields = {
      id: true,
      word: true,
      pos: true,
      ipaUs: true,
      ipaUk: true,
      meaning: true,
      exampleEn: true,
      exampleVi: true,
      audioUs: true,
      audioUk: true,
      collocations: true,
    };
    const selectFieldsWithoutCollocations = {
      id: true,
      word: true,
      pos: true,
      ipaUs: true,
      ipaUk: true,
      meaning: true,
      exampleEn: true,
      exampleVi: true,
      audioUs: true,
      audioUk: true,
    };

    // 1. Try exact word match first
    let exactMatches;
    try {
      exactMatches =
        (await this.prisma.vocabWord.findMany({
          where: { word: { equals: cleanWord, mode: 'insensitive' } },
          take: 5,
          select: selectFields,
        })) ?? [];
    } catch (error) {
      if (!this.isMissingCollocations(error)) throw error;
      exactMatches =
        (await this.prisma.vocabWord.findMany({
          where: { word: { equals: cleanWord, mode: 'insensitive' } },
          take: 5,
          select: selectFieldsWithoutCollocations,
        })) ?? [];
    }

    if (exactMatches.length > 0) {
      return {
        query: cleanWord,
        canonicalWord: exactMatches[0].word,
        isInflectionMatch: false,
        matches: exactMatches,
      };
    }

    // 2. Try common English inflections (plural, past tense, continuous, adverbs)
    const candidates = this.generateInflectionCandidates(cleanWord);
    if (candidates.length > 0) {
      let inflectionMatches;
      try {
        inflectionMatches =
          (await this.prisma.vocabWord.findMany({
            where: { word: { in: candidates, mode: 'insensitive' } },
            take: 5,
            select: selectFields,
          })) ?? [];
      } catch (error) {
        if (!this.isMissingCollocations(error)) throw error;
        inflectionMatches =
          (await this.prisma.vocabWord.findMany({
            where: { word: { in: candidates, mode: 'insensitive' } },
            take: 5,
            select: selectFieldsWithoutCollocations,
          })) ?? [];
      }

      if (inflectionMatches.length > 0) {
        return {
          query: cleanWord,
          canonicalWord: inflectionMatches[0].word,
          isInflectionMatch: true,
          matches: inflectionMatches,
        };
      }
    }

    return {
      query: cleanWord,
      canonicalWord: null,
      isInflectionMatch: false,
      matches: [],
    };
  }

  /**
   * Generates candidate lemma stems for common English inflections.
   */
  private generateInflectionCandidates(word: string): string[] {
    const candidates = new Set<string>();

    const irregularLemmas: Record<string, string> = {
      went: 'go',
      gone: 'go',
      was: 'be',
      were: 'be',
      had: 'have',
      did: 'do',
      saw: 'see',
      took: 'take',
      made: 'make',
    };
    if (irregularLemmas[word]) candidates.add(irregularLemmas[word]);

    // -ies -> -y (e.g. companies -> company)
    if (word.endsWith('ies') && word.length > 4) {
      candidates.add(word.slice(0, -3) + 'y');
    }

    // -es -> base / -e (e.g. boxes -> box, matches -> match)
    if (word.endsWith('es') && word.length > 3) {
      candidates.add(word.slice(0, -2));
      candidates.add(word.slice(0, -1));
      candidates.add(word.slice(0, -2) + 'e');
    }

    // -s -> base (e.g. meetings -> meeting)
    if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) {
      candidates.add(word.slice(0, -1));
    }

    // -ing -> base, base+e, or dedup consonant (e.g. meeting -> meet, making -> make, running -> run)
    if (word.endsWith('ing') && word.length > 4) {
      const base = word.slice(0, -3);
      candidates.add(base);
      candidates.add(base + 'e');
      if (base.endsWith('i')) candidates.add(`${base.slice(0, -1)}y`);
      if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) {
        candidates.add(base.slice(0, -1));
      }
    }

    // -ed -> base, base+e, or dedup consonant (e.g. walked -> walk, closed -> close, stopped -> stop)
    if (word.endsWith('ed') && word.length > 3) {
      const base = word.slice(0, -2);
      candidates.add(base);
      candidates.add(word.slice(0, -1)); // just remove 'd'
      candidates.add(`${base}e`);
      if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) {
        candidates.add(base.slice(0, -1));
      }
    }

    // -ly -> base (e.g. quickly -> quick)
    if (word.endsWith('ly') && word.length > 3) {
      candidates.add(word.slice(0, -2));
      candidates.add(word.slice(0, -2) + 'le');
    }

    // -er / -est (e.g. faster -> fast, fastest -> fast)
    if (word.endsWith('er') && word.length > 3) {
      candidates.add(word.slice(0, -2));
      candidates.add(word.slice(0, -1));
    }
    if (word.endsWith('est') && word.length > 4) {
      candidates.add(word.slice(0, -3));
      candidates.add(word.slice(0, -2));
    }

    candidates.delete(word);
    return Array.from(candidates);
  }
}
