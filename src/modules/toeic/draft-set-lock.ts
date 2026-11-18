import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, QuizPublicationStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export const EXAM_SET_NOT_DRAFT =
  'Đề không ở trạng thái bản nháp. Hãy chuyển đề về bản nháp rồi mới sửa.';

/** The exam left Draft between the early check and the write. */
export class ExamNotDraftException extends ConflictException {}

/**
 * Runs exam content writes with the exam set row locked and the exam still a
 * draft (audit 2026-11-18). The draft checks ran before the writes: a publish
 * in between (it locks this row too) had its content changed under learners.
 * A publish now waits for the write, or the write sees the exam left Draft
 * and gets 409. The exam set and its exam must both still be drafts.
 */
export async function inDraftSet<T>(
  prisma: PrismaService,
  setId: number,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  message = EXAM_SET_NOT_DRAFT,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ToeicExamSet" WHERE id = ${setId} FOR UPDATE`;
    const set = await tx.toeicExamSet.findUnique({
      where: { id: setId },
      select: {
        publicationStatus: true,
        genericExam: { select: { publicationStatus: true } },
      },
    });
    if (!set)
      throw new NotFoundException(`Đề thi với ID ${setId} không tồn tại`);
    const draft = QuizPublicationStatus.DRAFT;
    if (
      set.publicationStatus !== draft ||
      (set.genericExam && set.genericExam.publicationStatus !== draft)
    )
      throw new ExamNotDraftException(message);
    return work(tx);
  });
}

/**
 * The same for the Speaking and Writing sections of an exam, which have no
 * exam set (2026-11-18): the exam row is locked and must still be a draft.
 * Publish locks this row before it reads the content again, so it waits for
 * the write and checks it, or the write waits and gets 409. READ COMMITTED on
 * purpose: FOR UPDATE then reads the committed row, where SERIALIZABLE would
 * fail with a serialization error.
 */
export async function inDraftExam<T>(
  prisma: PrismaService,
  examId: number,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  message = EXAM_SET_NOT_DRAFT,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Exam" WHERE id = ${examId} FOR UPDATE`;
    const exam = await tx.exam.findUnique({
      where: { id: examId },
      select: { publicationStatus: true },
    });
    if (!exam) throw new NotFoundException(`Exam ${examId} không tồn tại`);
    if (exam.publicationStatus !== QuizPublicationStatus.DRAFT)
      throw new ExamNotDraftException(message);
    return work(tx);
  });
}
