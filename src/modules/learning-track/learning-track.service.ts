import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LearningTrack } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateLearningTrackDto,
  UpdateLearningTrackDto,
} from './dto/learning-track.dto';
import {
  buildTrackUsage,
  EMPTY_USAGE,
  GENERAL_TRACK,
  isPermutation,
  newTrackCode,
  newTrackSortOrder,
  normalizeTrackCode,
  normalizeTrackName,
  sortOrderAt,
  trackChangeRefusal,
  type TrackUsage,
} from './learning-track.logic';

const ORDER = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }];

const prismaCode = (error: unknown) => (error as { code?: string })?.code;

const duplicateError = (error: unknown) =>
  new ConflictException(
    String((error as { meta?: { target?: unknown } })?.meta?.target).includes(
      'nameNormalized',
    )
      ? 'Tên lĩnh vực đã có.'
      : 'Mã lĩnh vực đã có.',
  );

const IN_USE =
  'Lĩnh vực đang được gắn cho bài hoặc được học viên chọn nên không xoá được; hãy tắt lĩnh vực này.';

/** Lĩnh vực: the list learners choose from and admins manage. */
@Injectable()
export class LearningTrackService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active tracks, for onboarding, the goal editor and tag pickers. */
  listActive() {
    return this.prisma.learningTrack.findMany({
      where: { isActive: true },
      orderBy: ORDER,
      select: { code: true, name: true, description: true, sortOrder: true },
    });
  }

  /** Every track with its usage per skill and its learners. */
  async listForAdmin() {
    const [tracks, quizTags, speakingSets, learners] = await Promise.all([
      this.prisma.learningTrack.findMany({ orderBy: ORDER }),
      this.prisma.contentTrackTag.findMany({
        where: { contentType: 'QUIZ' },
        select: { contentId: true, track: true },
      }),
      this.prisma.speakingSetTrack.groupBy({
        by: ['track'],
        _count: { _all: true },
      }),
      this.prisma.learnerProfile.groupBy({
        by: ['track'],
        _count: { _all: true },
      }),
    ]);
    const quizIds = [...new Set(quizTags.map((tag) => tag.contentId))];
    const quizzes = quizIds.length
      ? await this.prisma.quiz.findMany({
          where: { id: { in: quizIds } },
          select: { id: true, type: true },
        })
      : [];
    const typeOf = new Map(quizzes.map((quiz) => [quiz.id, quiz.type]));
    const usage = buildTrackUsage({
      codes: tracks.map((track) => track.code),
      quizTags: quizTags.map((tag) => ({
        track: tag.track,
        quizType: typeOf.get(tag.contentId) ?? null,
      })),
      speakingSets: speakingSets.map((row) => ({
        track: row.track,
        count: row._count._all,
      })),
      learners: learners.map((row) => ({
        track: row.track,
        count: row._count._all,
      })),
    });
    return tracks.map((track) =>
      this.adminView(track, usage.get(track.code) ?? EMPTY_USAGE),
    );
  }

  async create(dto: CreateLearningTrackDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Tên lĩnh vực không được trống.');
    const code = newTrackCode(name, dto.code);
    if (!code)
      throw new BadRequestException(
        'Mã lĩnh vực chỉ gồm chữ không dấu, số và dấu gạch dưới, tối đa 40 ký tự.',
      );
    const placement = newTrackSortOrder(
      await this.prisma.learningTrack.findMany({
        select: { code: true, sortOrder: true },
      }),
    );
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const track = await tx.learningTrack.create({
          data: {
            code,
            name,
            nameNormalized: normalizeTrackName(name),
            description: dto.description?.trim() || null,
            sortOrder: placement.sortOrder,
          },
        });
        if (placement.generalSortOrder !== undefined)
          await tx.learningTrack.update({
            where: { code: GENERAL_TRACK },
            data: { sortOrder: placement.generalSortOrder },
          });
        return track;
      });
      return this.adminView(created, EMPTY_USAGE);
    } catch (error) {
      if (prismaCode(error) === 'P2002') throw duplicateError(error);
      throw error;
    }
  }

  /** Name and description. The code never changes. */
  async update(code: string, dto: UpdateLearningTrackDto) {
    const track = await this.find(code);
    if (dto.code !== undefined && normalizeTrackCode(dto.code) !== track.code)
      throw new ConflictException(trackChangeRefusal(track.code, 'changeCode'));
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name)
      throw new BadRequestException('Tên lĩnh vực không được trống.');
    try {
      await this.prisma.learningTrack.update({
        where: { code: track.code },
        data: {
          ...(name ? { name, nameNormalized: normalizeTrackName(name) } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description.trim() || null }
            : {}),
        },
      });
    } catch (error) {
      if (prismaCode(error) === 'P2002') throw duplicateError(error);
      throw error;
    }
    return this.adminRow(track.code);
  }

  /** Sets the order of every track: 10, 20, 30, ... */
  async reorder(codes: string[]) {
    const tracks = await this.prisma.learningTrack.findMany({
      select: { code: true },
    });
    if (
      !isPermutation(
        tracks.map((track) => track.code),
        codes,
      )
    )
      throw new BadRequestException(
        'Danh sách sắp xếp phải có mọi lĩnh vực, mỗi lĩnh vực đúng một lần.',
      );
    await this.prisma.$transaction(
      codes.map((code, index) =>
        this.prisma.learningTrack.update({
          where: { code },
          data: { sortOrder: sortOrderAt(index) },
        }),
      ),
    );
    return this.listForAdmin();
  }

  /**
   * A deactivated track is no longer offered for new choices or tags; the
   * choices and tags already made stay, and recommendations still use them.
   */
  async setActive(code: string, isActive: boolean) {
    const track = await this.find(code);
    const refusal = isActive
      ? null
      : trackChangeRefusal(track.code, 'deactivate');
    if (refusal) throw new ConflictException(refusal);
    await this.prisma.learningTrack.update({
      where: { code: track.code },
      data: { isActive },
    });
    return this.adminRow(track.code);
  }

  /**
   * Only an unused track can go. The foreign keys stay the last guard: a tag
   * or a choice saved after the check makes the delete fail (P2003).
   */
  async remove(code: string) {
    const track = await this.find(code);
    const refusal = trackChangeRefusal(track.code, 'delete');
    if (refusal) throw new ConflictException(refusal);
    const [learners, tags, sets] = await Promise.all([
      this.prisma.learnerProfile.count({ where: { track: track.code } }),
      this.prisma.contentTrackTag.count({ where: { track: track.code } }),
      this.prisma.speakingSetTrack.count({ where: { track: track.code } }),
    ]);
    if (learners + tags + sets > 0) throw new ConflictException(IN_USE);
    try {
      await this.prisma.learningTrack.delete({ where: { code: track.code } });
    } catch (error) {
      if (prismaCode(error) === 'P2003') throw new ConflictException(IN_USE);
      if (prismaCode(error) === 'P2025')
        throw new NotFoundException('Không tìm thấy lĩnh vực.');
      throw error;
    }
    return { code: track.code, deleted: true };
  }

  private async find(code: string) {
    const track = await this.prisma.learningTrack.findUnique({
      where: { code },
    });
    if (!track) throw new NotFoundException('Không tìm thấy lĩnh vực.');
    return track;
  }

  private async adminRow(code: string) {
    const row = (await this.listForAdmin()).find(
      (track) => track.code === code,
    );
    if (!row) throw new NotFoundException('Không tìm thấy lĩnh vực.');
    return row;
  }

  private adminView(track: LearningTrack, usage: TrackUsage) {
    return {
      code: track.code,
      name: track.name,
      description: track.description,
      sortOrder: track.sortOrder,
      isActive: track.isActive,
      isSystem: track.code === GENERAL_TRACK,
      usage: { ...usage },
    };
  }
}
