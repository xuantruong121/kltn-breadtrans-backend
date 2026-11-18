import { PracticeSkill } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { PLACEMENT_THRESHOLDS } from './placement.logic';
import { applyDiagnosticPlacement } from './placement.store';

/**
 * The Entry Diagnostic's placement writing a skill level while progress or a
 * gate test opens a higher one (audit C6, 2026-11-18). Placement read the
 * row, then wrote max(what it read, its level): a level opened in between
 * was lowered. Progress already wrote under the lock
 * learner-progress:<user>:<skill>; placement did not take it.
 */
describeWithIsolatedDatabase(
  'placement versus a level opened meanwhile',
  () => {
    let prisma: PrismaService;
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const userIds: number[] = [];

    beforeAll(async () => {
      prisma = new PrismaService();
      await prisma.$connect();
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    });

    it('a level opened while placement runs is not lowered', async () => {
      const user = await prisma.user.create({
        data: { email: `placement_race_${suffix}@breadtrans.local` },
      });
      userIds.push(user.id);
      const skill: PracticeSkill = 'SPEAKING';
      await prisma.learnerSkillLevel.create({
        data: {
          userId: user.id,
          skill,
          level: 'BASIC',
          unlockedLevel: 'BASIC',
          ability: 0,
        },
      });

      // Another writer (progress, a gate test) opens INTERMEDIATE under the
      // shared lock, starting right after placement reads the row.
      let opener: Promise<unknown> | undefined;
      const openIntermediate = () =>
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`learner-progress:${user.id}:${skill}`}, 0))`;
          await tx.learnerSkillLevel.update({
            where: { userId_skill: { userId: user.id, skill } },
            data: { unlockedLevel: 'INTERMEDIATE', level: 'INTERMEDIATE' },
          });
        });
      const wrapSkillLevels = <T extends object>(client: T): T =>
        new Proxy(client, {
          get(target, prop) {
            const value = (target as Record<string | symbol, unknown>)[prop];
            if (prop === 'learnerSkillLevel') {
              const d = value as Record<string, (...a: unknown[]) => unknown>;
              return new Proxy(d, {
                get(delegate, method) {
                  const fn = delegate[method as string];
                  if (method !== 'findUnique' || typeof fn !== 'function')
                    return typeof fn === 'function' ? fn.bind(delegate) : fn;
                  return async (...args: unknown[]) => {
                    const row = await fn.apply(delegate, args);
                    if (!opener) {
                      opener = openIntermediate();
                      // Give the opener the time to commit if nothing holds it.
                      await new Promise((r) => setTimeout(r, 300));
                    }
                    return row;
                  };
                },
              });
            }
            if (prop === '$transaction' && typeof value === 'function')
              return (cb: (tx: object) => unknown, ...rest: unknown[]) =>
                (value as (...a: unknown[]) => Promise<unknown>).call(
                  target,
                  (tx: object) => cb(wrapSkillLevels(tx)),
                  ...rest,
                );
            return typeof value === 'function'
              ? (value as (...a: unknown[]) => unknown).bind(target)
              : value;
          },
        });

      await applyDiagnosticPlacement(wrapSkillLevels(prisma), user.id, 1, {
        SPEAKING: { state: 'COMPLETE', score: PLACEMENT_THRESHOLDS.BASIC },
      });
      await opener;

      const row = await prisma.learnerSkillLevel.findUniqueOrThrow({
        where: { userId_skill: { userId: user.id, skill } },
      });
      expect(row.unlockedLevel).toBe('INTERMEDIATE');
    });
  },
);
