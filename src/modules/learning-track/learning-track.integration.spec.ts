import { ConflictException } from '@nestjs/common';
import { QuizPublicationStatus, Role } from '@prisma/client';

import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { PrismaService } from '../../prisma/prisma.service';
import { SkillCmsService } from '../content/skill-cms.service';
import { LearningTrackService } from './learning-track.service';

/**
 * The foreign keys behind Lĩnh vực (migration 20261121120000): a track in
 * use cannot be deleted, and a speaking set takes its tags with it.
 */
describeWithIsolatedDatabase('learning tracks on the database', () => {
  let prisma: PrismaService;
  let tracks: LearningTrackService;
  let skills: SkillCmsService;
  const admin = { id: 1, role: Role.ADMIN };
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const setId = `qa-track-set-${suffix}`;
  let code = '';
  let learnerId = 0;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    tracks = new LearningTrackService(prisma);
    skills = new SkillCmsService(prisma);
    code = (await tracks.create({ name: `QA lĩnh vực ${suffix}` })).code;
    const category = await prisma.speakingCategory.findUniqueOrThrow({
      where: { code: 'GENERAL' },
    });
    await prisma.speakingPracticeSet.create({
      data: {
        id: setId,
        title: `QA track set ${suffix}`,
        description: '',
        category: 'GENERAL',
        categoryId: category.id,
        level: 'B1',
        scope: 'SKILL_PRACTICE',
        publicationStatus: QuizPublicationStatus.DRAFT,
      },
    });
  });

  afterAll(async () => {
    await prisma.speakingPracticeSet.deleteMany({ where: { id: setId } });
    if (learnerId) await prisma.user.deleteMany({ where: { id: learnerId } });
    await prisma.learningTrack.deleteMany({ where: { code } });
    await prisma.$disconnect();
  });

  it('tags a set with no exercise, then refuses to delete the track (409)', async () => {
    await expect(
      skills.setTracks('speaking', setId, [code], admin),
    ).resolves.toEqual({ tracks: [code] });
    const [row] = (await tracks.listForAdmin()).filter((t) => t.code === code);
    expect(row.usage.speaking).toBe(1);

    await expect(tracks.remove(code)).rejects.toBeInstanceOf(ConflictException);
    // The foreign key is the last guard, whatever the service checks.
    await expect(
      prisma.learningTrack.delete({ where: { code } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.learningTrack.count({ where: { code } })).toBe(1);
  });

  it('refuses to delete a track a learner chose (409)', async () => {
    learnerId = (
      await prisma.user.create({
        data: {
          email: `qa_track_${suffix}@breadtrans.local`,
          role: Role.STUDENT,
          learnerProfile: { create: { track: code } },
        },
      })
    ).id;
    await expect(tracks.remove(code)).rejects.toBeInstanceOf(ConflictException);
    await prisma.user.delete({ where: { id: learnerId } });
    learnerId = 0;
  });

  it('never deletes GENERAL', async () => {
    await expect(tracks.remove('GENERAL')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      await prisma.learningTrack.count({ where: { code: 'GENERAL' } }),
    ).toBe(1);
  });

  it('deleting a speaking set removes its tags, and the track can go', async () => {
    expect(await prisma.speakingSetTrack.count({ where: { setId } })).toBe(1);
    await expect(
      skills.deleteContent('speaking', setId, admin),
    ).resolves.toEqual({ id: setId, deleted: true });
    expect(await prisma.speakingSetTrack.count({ where: { setId } })).toBe(0);

    await expect(tracks.remove(code)).resolves.toEqual({
      code,
      deleted: true,
    });
    expect(await prisma.learningTrack.count({ where: { code } })).toBe(0);
  });
});
