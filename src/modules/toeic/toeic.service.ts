import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptMode } from '@prisma/client';
import { SpeakingService } from '../speaking/speaking.service';

const TOEIC_DURATION_SECONDS = 120 * 60; // 120 minutes = 7200 seconds

@Injectable()
export class ToeicService {
  constructor(
    private prisma: PrismaService,
    private speakingService: SpeakingService,
  ) {}

  async getExams() {
    return this.prisma.toeicExamSet.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getExamDetails(examId: number, includeAnswers = false) {
    const exam = await this.prisma.toeicExamSet.findUnique({
      where: { id: examId },
      include: {
        groups: {
          include: {
            questions: includeAnswers
              ? { orderBy: { questionNumber: 'asc' } }
              : {
                  select: {
                    id: true,
                    groupId: true,
                    questionNumber: true,
                    text: true,
                    options: true,
                  },
                  orderBy: { questionNumber: 'asc' },
                },
          },
          orderBy: { groupOrder: 'asc' },
        },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (includeAnswers) return exam;

    // Listening transcripts are assessment data. Keep them server-side so a
    // student can hear the prompt without seeing the answer script.
    return {
      ...exam,
      groups: exam.groups.map((group) => ({
        ...group,
        passageText: group.part <= 4 ? null : group.passageText,
      })),
    };
  }

  async getBundle(quizId: number, includeAnswers = false) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new NotFoundException('TOEIC bundle not found');

    const metadata = (quiz.bilingualContent ?? {}) as Record<string, unknown>;
    if (metadata.examFormat !== 'FOUR_SKILL' || metadata.isBundle !== true) {
      throw new BadRequestException('Quiz này không phải gói TOEIC 4 kỹ năng');
    }

    const examSetId = Number(metadata.listeningReadingExamSetId);
    const speakingWritingQuizId = Number(metadata.speakingWritingQuizId);
    if (
      !Number.isInteger(examSetId) ||
      !Number.isInteger(speakingWritingQuizId)
    ) {
      throw new BadRequestException(
        'Gói TOEIC chưa liên kết đủ các bài thành phần',
      );
    }

    const [listeningReading, speakingWriting] = await Promise.all([
      this.getExamDetails(examSetId, includeAnswers),
      this.prisma.quiz.findUnique({
        where: { id: speakingWritingQuizId },
        include: { questions: { orderBy: { order: 'asc' } } },
      }),
    ]);
    if (!speakingWriting)
      throw new NotFoundException('Bài Speaking/Writing không tồn tại');

    return {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      bilingualContent: quiz.bilingualContent,
      listeningReading,
      speakingWriting: {
        id: speakingWriting.id,
        title: speakingWriting.title,
        description: speakingWriting.description,
        questions: includeAnswers
          ? speakingWriting.questions
          : speakingWriting.questions.map((question) => {
              const content =
                question.content && typeof question.content === 'object'
                  ? { ...(question.content as Record<string, unknown>) }
                  : question.content;
              if (content && typeof content === 'object') {
                delete (content as Record<string, unknown>).correct;
                delete (content as Record<string, unknown>).correctAnswer;
                delete (content as Record<string, unknown>).explanation;
              }
              return { ...question, content };
            }),
      },
    };
  }

  async generateGroupAudio(groupId: number, accent: 'US' | 'UK', rate: number) {
    const group = await this.prisma.toeicQuestionGroup.findUnique({
      where: { id: groupId },
      select: {
        part: true,
        audioUrl: true,
        passageText: true,
        questions: { select: { options: true }, take: 1 },
      },
    });
    if (!group) throw new NotFoundException('TOEIC question group not found');
    if (group.audioUrl) {
      const response = await fetch(group.audioUrl);
      if (response.ok) return Buffer.from(await response.arrayBuffer());
    }
    let audioText = group.passageText;
    if (group.part === 1) {
      const options = group.questions[0]?.options;
      if (
        !Array.isArray(options) ||
        !options.every((option) => typeof option === 'string')
      ) {
        throw new ServiceUnavailableException(
          'Câu Part 1 chưa có nội dung audio',
        );
      }
      audioText = options
        .map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`)
        .join(' ');
    }
    if (!audioText) {
      throw new ServiceUnavailableException('Nhóm câu hỏi này chưa có audio');
    }
    return this.speakingService.generateTts(audioText, accent, rate);
  }

  async startAttempt(userId: number, examId: number, mode: AttemptMode) {
    return this.prisma.toeicAttempt.create({
      data: {
        userId,
        examId,
        mode,
        startedAt: new Date(),
      },
    });
  }

  async getRemainingTime(attemptId: number, userId: number, role?: string) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (role !== 'ADMIN' && attempt.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền truy cập bài thi này');
    }
    if (attempt.submittedAt) return { remaining: 0 };

    const deadline =
      attempt.startedAt.getTime() + TOEIC_DURATION_SECONDS * 1000;
    const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    return { remaining };
  }

  async saveAnswers(
    attemptId: number,
    userId: number,
    answers: Record<string, number>,
  ) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền chỉnh sửa bài thi này');
    }
    if (attempt.submittedAt) {
      throw new BadRequestException(
        'Bài thi đã nộp, không thể lưu câu trả lời mới',
      );
    }

    const deadline =
      attempt.startedAt.getTime() + TOEIC_DURATION_SECONDS * 1000;
    if (Date.now() > deadline) {
      throw new BadRequestException(
        'Thời gian làm bài thi đã kết thúc (quá 120 phút)',
      );
    }

    const updatePromises = Object.entries(answers).map(([qId, sIdx]) =>
      this.prisma.toeicAttemptAnswer.upsert({
        where: {
          attemptId_questionId: {
            attemptId,
            questionId: parseInt(qId),
          },
        },
        update: { selectedIndex: sIdx },
        create: {
          attemptId,
          questionId: parseInt(qId),
          selectedIndex: sIdx,
        },
      }),
    );
    await Promise.all(updatePromises);
    return { success: true };
  }

  async submitAttempt(attemptId: number, userId: number) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
      include: { answers: { include: { question: true } } },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền nộp bài thi này');
    }
    if (attempt.submittedAt) {
      return attempt;
    }

    const deadline =
      attempt.startedAt.getTime() + TOEIC_DURATION_SECONDS * 1000;
    const isOvertime = Date.now() > deadline;
    const submittedAt = isOvertime ? new Date(deadline) : new Date();

    let listeningScore = 0;
    let readingScore = 0;
    let correctListening = 0;
    let correctReading = 0;

    attempt.answers.forEach((ans) => {
      if (ans.selectedIndex === ans.question.correctIndex) {
        if (ans.question.questionNumber <= 100) correctListening++;
        else correctReading++;
      }
    });

    listeningScore = Math.min(495, Math.max(5, correctListening * 5));
    readingScore = Math.min(495, Math.max(5, correctReading * 5));

    return this.prisma.toeicAttempt.update({
      where: { id: attemptId },
      data: {
        submittedAt,
        listeningScore,
        readingScore,
        totalScore: listeningScore + readingScore,
      },
    });
  }

  async getResult(attemptId: number, userId: number, role?: string) {
    const attempt = await this.prisma.toeicAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: { include: { groups: { include: { questions: true } } } },
        answers: { include: { question: true } },
      },
    });
    if (!attempt) throw new NotFoundException('Result not found');
    if (role !== 'ADMIN' && role !== 'TEACHER' && attempt.userId !== userId) {
      throw new ForbiddenException(
        'Bạn không có quyền xem kết quả bài thi này',
      );
    }

    // Auto-Finalize: Nếu quá hạn 120 phút mà chưa submit, tự động finalize ngay
    const deadline =
      attempt.startedAt.getTime() + TOEIC_DURATION_SECONDS * 1000;
    if (!attempt.submittedAt) {
      if (Date.now() > deadline) {
        let listeningScore = 0;
        let readingScore = 0;
        let correctListening = 0;
        let correctReading = 0;

        attempt.answers.forEach((ans) => {
          if (ans.selectedIndex === ans.question.correctIndex) {
            if (ans.question.questionNumber <= 100) correctListening++;
            else correctReading++;
          }
        });

        listeningScore = Math.min(495, Math.max(5, correctListening * 5));
        readingScore = Math.min(495, Math.max(5, correctReading * 5));

        await this.prisma.toeicAttempt.updateMany({
          where: { id: attemptId, submittedAt: null },
          data: {
            submittedAt: new Date(deadline),
            listeningScore,
            readingScore,
            totalScore: listeningScore + readingScore,
          },
        });

        return this.prisma.toeicAttempt.findUnique({
          where: { id: attemptId },
          include: {
            exam: { include: { groups: { include: { questions: true } } } },
            answers: true,
          },
        });
      } else {
        throw new BadRequestException('Bài thi đang diễn ra, chưa nộp bài');
      }
    }

    return attempt;
  }
}
