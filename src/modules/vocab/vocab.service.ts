import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class VocabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

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
      const userProgresses = await this.prisma.userVocabWordProgress.findMany({
        where: { userId },
        include: { word: true },
      });

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
      const prog = userProgressMap[t.id] || { mastered: 0, starred: 0, needReview: 0 };
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
      const prog = userProgressMap[t.id] || { mastered: 0, starred: 0, needReview: 0 };
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
    const topic = await this.prisma.vocabTopic.findUnique({
      where: { id: topicId },
      include: {
        words: { orderBy: { order: 'asc' } },
      },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    const userProgressMap: Record<
      number,
      { isStarred: boolean; isMastered: boolean }
    > = {};
    if (userId) {
      const progresses = await this.prisma.userVocabWordProgress.findMany({
        where: { userId, word: { topicId } },
      });
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

  async setMastered(userId: number, wordId: number, isMastered: boolean) {
    const existing = await this.prisma.userVocabWordProgress.findUnique({
      where: { userId_wordId: { userId, wordId } },
    });

    if (existing) {
      const updated = await this.prisma.userVocabWordProgress.update({
        where: { id: existing.id },
        data: { isMastered },
      });
      if (updated.isMastered && !existing.isMastered) {
        this.eventEmitter.emit('vocab.learned', { userId, count: 1 });
      }
      return { isMastered: updated.isMastered };
    } else {
      const created = await this.prisma.userVocabWordProgress.create({
        data: { userId, wordId, isMastered },
      });
      if (created.isMastered) {
        this.eventEmitter.emit('vocab.learned', { userId, count: 1 });
      }
      return { isMastered: created.isMastered };
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

    if (existing) {
      return this.prisma.userVocabWordProgress.update({
        where: { id: existing.id },
        data: {
          reviewCount: newReviewCount,
          isMastered,
          lastReviewedAt: new Date(),
        },
      });
    } else {
      return this.prisma.userVocabWordProgress.create({
        data: {
          userId,
          wordId,
          reviewCount: 1,
          isMastered: isCorrect,
          lastReviewedAt: new Date(),
        },
      });
    }
  }
}
