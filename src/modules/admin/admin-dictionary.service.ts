import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DictionaryEntrySource,
  DictionaryEntryStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertNotANumber,
  entryDataFromWord,
  headwordOf,
  posOf,
} from '../vocab/dictionary-entry';
import {
  CreateDictionaryEntryDto,
  UpdateDictionaryEntryDto,
} from './dto/admin-dictionary.dto';

export type DictionaryListQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: string;
  source?: string;
  pos?: string;
  /** ipa | audio | example: entries still missing that field. */
  missing?: string;
};

const MISSING_FIELD = {
  ipa: 'ipaUs',
  audio: 'audioUs',
  example: 'exampleEn',
} as const;

const isStatus = (value?: string): value is DictionaryEntryStatus =>
  Object.values(DictionaryEntryStatus).includes(value as DictionaryEntryStatus);

const isSource = (value?: string): value is DictionaryEntrySource =>
  Object.values(DictionaryEntrySource).includes(value as DictionaryEntrySource);

/** The list filters as a Prisma where; an unknown filter value is ignored. */
export function dictionaryListWhere(
  query: DictionaryListQuery,
): Prisma.DictionaryEntryWhereInput {
  const and: Prisma.DictionaryEntryWhereInput[] = [];
  const q = query.q?.trim();
  if (q)
    and.push({
      OR: [
        { headword: { contains: headwordOf(q) } },
        { meaningVi: { contains: q, mode: 'insensitive' } },
      ],
    });
  if (isStatus(query.status)) and.push({ status: query.status });
  if (isSource(query.source)) and.push({ source: query.source });
  if (query.pos?.trim()) and.push({ pos: posOf(query.pos) });
  const field =
    MISSING_FIELD[query.missing as keyof typeof MISSING_FIELD] ?? null;
  if (field) and.push({ OR: [{ [field]: null }, { [field]: '' }] });
  return and.length ? { AND: and } : {};
}

/**
 * The dictionary store as admins see it (F13): every entry decks link and
 * every lookup reads, with a review queue for entries that came from an
 * external dictionary.
 */
@Injectable()
export class AdminDictionaryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: DictionaryListQuery) {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Math.floor(Number(query.pageSize) || 20)),
    );
    const where = dictionaryListWhere(query);
    const [rows, total, byStatus] = await Promise.all([
      this.prisma.dictionaryEntry.findMany({
        where,
        orderBy: [{ headword: 'asc' }, { pos: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { deckWords: true } } },
      }),
      this.prisma.dictionaryEntry.count({ where }),
      this.prisma.dictionaryEntry.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);
    const statusCounts = Object.fromEntries(
      Object.values(DictionaryEntryStatus).map((status) => [
        status,
        byStatus.find((row) => row.status === status)?._count._all ?? 0,
      ]),
    );
    const items = rows.map(({ _count, ...entry }) => ({
      ...entry,
      usedInDecks: _count.deckWords,
    }));
    return { items, total, page, pageSize, statusCounts };
  }

  /** One entry and the decks that use it. */
  async get(id: number) {
    const entry = await this.prisma.dictionaryEntry.findUnique({
      where: { id },
      include: {
        deckWords: {
          orderBy: { topicId: 'asc' },
          select: {
            id: true,
            topic: {
              select: { id: true, title: true, publicationStatus: true },
            },
          },
        },
      },
    });
    if (!entry) throw new NotFoundException('Mục từ điển không tồn tại');
    const { deckWords, ...rest } = entry;
    return {
      ...rest,
      decks: deckWords.map((row) => ({ deckWordId: row.id, ...row.topic })),
    };
  }

  async create(dto: CreateDictionaryEntryDto, adminId: number) {
    assertNotANumber(dto.word);
    const headword = headwordOf(dto.word);
    const pos = posOf(dto.pos);
    await this.assertFree(headword, pos);
    return this.prisma.dictionaryEntry.create({
      data: {
        ...(entryDataFromWord(dto) as Prisma.DictionaryEntryCreateInput),
        headword,
        displayWord: dto.word.trim(),
        pos,
        meaningVi: dto.meaning.trim(),
        source: DictionaryEntrySource.CURATED,
        status: DictionaryEntryStatus.APPROVED,
        reviewedAt: new Date(),
        reviewedBy: adminId,
      },
    });
  }

  /**
   * Edits apply to every deck and lookup using the entry. What learners
   * studied (the word and its meaning) does not change under them.
   */
  async update(id: number, dto: UpdateDictionaryEntryDto) {
    const entry = await this.findOrThrow(id);
    if (dto.word !== undefined) assertNotANumber(dto.word);
    const headword =
      dto.word !== undefined ? headwordOf(dto.word) : entry.headword;
    const pos = dto.pos !== undefined ? posOf(dto.pos) : entry.pos;
    const isWordChanged = headword !== entry.headword || pos !== entry.pos;
    const isMeaningChanged =
      dto.meaning !== undefined &&
      dto.meaning.trim() !== entry.meaningVi.trim();
    if (isWordChanged) await this.assertFree(headword, pos);
    if (isWordChanged || isMeaningChanged) {
      const studied = await this.prisma.userVocabWordProgress.findFirst({
        where: { word: { entryId: id } },
      });
      if (studied)
        throw new ConflictException(
          'Học viên đã học từ này, không thể đổi từ hoặc nghĩa.',
        );
    }
    return this.prisma.dictionaryEntry.update({
      where: { id },
      data: entryDataFromWord(dto),
    });
  }

  approve(id: number, adminId: number) {
    return this.review(id, DictionaryEntryStatus.APPROVED, adminId);
  }

  /** A rejected entry never answers a lookup; one a deck uses stays. */
  async reject(id: number, adminId: number) {
    const used = await this.prisma.vocabWord.count({ where: { entryId: id } });
    if (used)
      throw new ConflictException(
        `Từ này đang nằm trong ${used} bộ flashcard; gỡ khỏi bộ trước khi loại.`,
      );
    return this.review(id, DictionaryEntryStatus.REJECTED, adminId);
  }

  async remove(id: number) {
    await this.findOrThrow(id);
    const used = await this.prisma.vocabWord.count({ where: { entryId: id } });
    if (used)
      throw new ConflictException(
        `Từ này đang nằm trong ${used} bộ flashcard; gỡ khỏi bộ trước khi xóa.`,
      );
    return this.prisma.dictionaryEntry.delete({ where: { id } });
  }

  private async review(
    id: number,
    status: DictionaryEntryStatus,
    adminId: number,
  ) {
    await this.findOrThrow(id);
    return this.prisma.dictionaryEntry.update({
      where: { id },
      data: { status, reviewedAt: new Date(), reviewedBy: adminId },
    });
  }

  private async findOrThrow(id: number) {
    const entry = await this.prisma.dictionaryEntry.findUnique({
      where: { id },
    });
    if (!entry) throw new NotFoundException('Mục từ điển không tồn tại');
    return entry;
  }

  private async assertFree(headword: string, pos: string) {
    const taken = await this.prisma.dictionaryEntry.findUnique({
      where: { headword_pos: { headword, pos } },
    });
    if (taken)
      throw new ConflictException(
        `"${taken.displayWord}" (${pos}) đã có trong kho từ điển.`,
      );
  }
}
