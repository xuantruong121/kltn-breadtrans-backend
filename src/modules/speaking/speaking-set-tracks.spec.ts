import { Role } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UploadService } from '../upload/upload.service';
import { SpeakingService } from './speaking.service';

/** The learner Speaking catalog names each set's Lĩnh vực (2026-11-21). */
describe('SpeakingService set summaries carry their tracks', () => {
  const track = (
    code: string,
    name: string,
    sortOrder: number,
    isActive = true,
  ) => ({ trackRef: { code, name, sortOrder, isActive } });
  const exercise = (id: number, practiceSet: unknown) => ({
    id,
    title: `Exercise ${id}`,
    targetText: 'Hello.',
    imageUrl: null,
    audioUrl: null,
    isPremiumContent: false,
    difficulty: 'BEGINNER',
    category: 'GENERAL',
    categoryId: null,
    categoryTaxonomy: null,
    stimulus: null,
    order: id,
    practiceSetId: (practiceSet as { id?: string } | null)?.id ?? null,
    practiceSet,
  });
  const set = {
    id: 'practice-question-response-b1-b2',
    title: 'Phản hồi câu hỏi',
    description: 'Học tập và công việc',
    category: 'GENERAL',
    level: 'B1-B2',
    scope: 'SKILL_PRACTICE',
    categoryTaxonomy: { code: 'GENERAL', name: 'Chung' },
    tracks: [
      track('HOSPITALITY_TOURISM', 'Nhà hàng – Khách sạn – Du lịch', 40, false),
      track('STUDENT_ACADEMIC', 'Sinh viên – Học thuật', 50),
      track('OFFICE_BUSINESS', 'Văn phòng – Kinh doanh', 20),
    ],
  };
  const prisma = {
    speakingExercise: {
      findMany: jest
        .fn()
        .mockResolvedValue([exercise(1, set), exercise(2, set)]),
    },
    speakingSubmission: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new SpeakingService(
    prisma as unknown as PrismaService,
    {} as AiService,
    {} as UploadService,
    {} as any,
  );

  it('lists active tracks only, in the admin order', async () => {
    const [first, second] = await service.findAllExercises(
      undefined,
      7,
      Role.STUDENT,
    );
    const expected = [
      {
        code: 'OFFICE_BUSINESS',
        name: 'Văn phòng – Kinh doanh',
        sortOrder: 20,
      },
      {
        code: 'STUDENT_ACADEMIC',
        name: 'Sinh viên – Học thuật',
        sortOrder: 50,
      },
    ];
    expect(first.practiceSet.tracks).toEqual(expected);
    expect(second.practiceSet.tracks).toEqual(expected);
    // The old label stays for now.
    expect(first.practiceSet.categoryLabel).toBe('Chung');
  });

  it('reads the tags from the set itself', async () => {
    await service.findAllExercises(undefined, 7, Role.STUDENT);
    const include = prisma.speakingExercise.findMany.mock.calls[0][0].include;
    expect(include.practiceSet.include.tracks).toEqual({
      select: {
        trackRef: {
          select: { code: true, name: true, sortOrder: true, isActive: true },
        },
      },
    });
  });
});
