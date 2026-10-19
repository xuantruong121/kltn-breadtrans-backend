import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateSpeakingCategoryDto,
  UpdateSpeakingCategoryDto,
} from './speaking-category.dto';

export type SpeakingCategoryScope = 'practiceSet' | 'exercise';

const LEGACY_LABELS: Record<string, string> = {
  GENERAL: 'Chung',
  TOEIC: 'TOEIC',
  BUSINESS: 'Công việc',
  ACADEMIC: 'Học thuật',
  DAILY_LIFE: 'Đời sống hằng ngày',
};

function stripDiacritics(value: string) {
  return value
    .replace(/[Đđ]/g, (char) => (char === 'Đ' ? 'D' : 'd'))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizeSpeakingCategoryCode(value: string) {
  const normalized = stripDiacritics(value.trim())
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized)
    throw new BadRequestException('Mã phân loại không được để trống');
  return normalized;
}

function normalizeSpeakingCategoryName(value: string) {
  return stripDiacritics(value.trim())
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ');
}

@Injectable()
export class SpeakingCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeWhere(scope?: SpeakingCategoryScope) {
    if (scope === 'practiceSet') return { allowPracticeSet: true };
    if (scope === 'exercise') return { allowExercise: true };
    return {};
  }

  async list(
    options: {
      includeInactive?: boolean;
      scope?: SpeakingCategoryScope;
    } = {},
  ) {
    return this.prisma.speakingCategory.findMany({
      where: {
        ...(options.includeInactive ? {} : { isActive: true }),
        ...this.scopeWhere(options.scope),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { practiceSets: true, exercises: true } } },
    });
  }

  async getByCode(
    code: string,
    scope: SpeakingCategoryScope,
    options: { allowInactive?: boolean } = {},
  ) {
    const normalizedCode = normalizeSpeakingCategoryCode(code);
    const category = await this.prisma.speakingCategory.findFirst({
      where: {
        code: normalizedCode,
        ...(options.allowInactive ? {} : { isActive: true }),
        ...this.scopeWhere(scope),
      },
    });
    if (!category) {
      throw new BadRequestException(
        `Phân loại Speaking không tồn tại, đã tắt hoặc không dùng được cho ${scope === 'practiceSet' ? 'bộ luyện' : 'câu luyện'}`,
      );
    }
    return category;
  }

  async getDefault(scope: SpeakingCategoryScope) {
    const category = await this.prisma.speakingCategory.findFirst({
      where: { isActive: true, ...this.scopeWhere(scope) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (!category) {
      throw new BadRequestException(
        `Chưa có phân loại Speaking hoạt động cho ${scope === 'practiceSet' ? 'bộ luyện' : 'câu luyện'}`,
      );
    }
    return category;
  }

  async getById(id: number) {
    const category = await this.prisma.speakingCategory.findUnique({
      where: { id },
    });
    if (!category)
      throw new NotFoundException('Không tìm thấy phân loại Speaking');
    return category;
  }

  async create(dto: CreateSpeakingCategoryDto) {
    const code = normalizeSpeakingCategoryCode(dto.code || dto.name);
    const name = dto.name.trim();
    const nameNormalized = normalizeSpeakingCategoryName(name);
    try {
      return await this.prisma.speakingCategory.create({
        data: {
          code,
          name,
          nameNormalized,
          description: dto.description?.trim() || undefined,
          allowPracticeSet: dto.allowPracticeSet ?? true,
          allowExercise: dto.allowExercise ?? false,
          sortOrder: dto.sortOrder ?? 100,
        },
        include: {
          _count: { select: { practiceSets: true, exercises: true } },
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException(
          'Mã hoặc tên phân loại Speaking đã tồn tại',
        );
      }
      throw error;
    }
  }

  async update(id: number, dto: UpdateSpeakingCategoryDto) {
    const current = await this.getById(id);
    const usage = await this.prisma.speakingCategory.findUnique({
      where: { id },
      include: { _count: { select: { practiceSets: true, exercises: true } } },
    });
    if (!usage)
      throw new NotFoundException('Không tìm thấy phân loại Speaking');

    const isUsed = usage._count.practiceSets > 0 || usage._count.exercises > 0;
    const code =
      dto.code === undefined
        ? current.code
        : normalizeSpeakingCategoryCode(dto.code);
    if (code !== current.code) {
      throw new ConflictException(
        isUsed
          ? 'Không thể đổi mã phân loại đã được nội dung sử dụng'
          : 'Mã phân loại Speaking là bất biến sau khi tạo',
      );
    }
    const name = dto.name?.trim() ?? current.name;
    const nameNormalized = normalizeSpeakingCategoryName(name);
    try {
      return await this.prisma.speakingCategory.update({
        where: { id },
        data: {
          code,
          name,
          nameNormalized,
          description:
            dto.description === undefined
              ? undefined
              : dto.description.trim() || null,
          isActive: dto.isActive,
          allowPracticeSet: dto.allowPracticeSet,
          allowExercise: dto.allowExercise,
          sortOrder: dto.sortOrder,
        },
        include: {
          _count: { select: { practiceSets: true, exercises: true } },
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException(
          'Mã hoặc tên phân loại Speaking đã tồn tại',
        );
      }
      throw error;
    }
  }

  async remove(id: number) {
    const current = await this.getById(id);
    const usage = await this.prisma.speakingCategory.findUnique({
      where: { id },
      include: { _count: { select: { practiceSets: true, exercises: true } } },
    });
    if (!usage)
      throw new NotFoundException('Không tìm thấy phân loại Speaking');
    if (usage._count.practiceSets || usage._count.exercises) {
      throw new ConflictException(
        'Phân loại đã dùng không được xoá; hãy tắt hoạt động',
      );
    }
    return this.prisma.speakingCategory.delete({ where: { id: current.id } });
  }

  static labelForLegacyCode(code?: string | null) {
    const normalized = code?.trim().toUpperCase();
    return (
      (normalized && LEGACY_LABELS[normalized]) || code || 'Chưa phân loại'
    );
  }
}
