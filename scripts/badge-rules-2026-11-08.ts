/**
 * Owner decision 2026-11-08: the badge rules were too easy and are now those
 * of src/modules/gamification/badge-rules.logic.ts. Badges already granted
 * under the old rules are taken back when the learner does not meet the new
 * one, and the eight Badge rows get the new description and criteria.
 *
 * The facts come from GamificationService.badgeFacts, the same function the
 * app uses, so the script and the app cannot disagree on who qualifies.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/badge-rules-2026-11-08.ts <dryrun|apply> --target <url|env:DATABASE_URL>
 * dryrun writes nothing. apply needs BADGE_RULES_AUTHORIZED=revoke and runs in
 * one transaction. Take a backup (npm run db:backup) before apply on kltn_db.
 */
import { PrismaClient } from '@prisma/client';

import {
  BADGE_DESCRIPTIONS,
  qualifyingBadges,
} from '../src/modules/gamification/badge-rules.logic';
import { GamificationService } from '../src/modules/gamification/gamification.service';

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const mode = process.argv[2];
  const i = process.argv.indexOf('--target');
  const target = i > 0 ? process.argv[i + 1] : undefined;
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url || !['dryrun', 'apply'].includes(mode ?? ''))
    throw new Error('usage: <dryrun|apply> --target <url|env:DATABASE_URL>');
  if (mode === 'apply' && process.env.BADGE_RULES_AUTHORIZED !== 'revoke')
    throw new Error('REFUSED: BADGE_RULES_AUTHORIZED=revoke not set');

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const where = new URL(url);
    console.log(
      `TARGET=${where.hostname}:${where.port}${where.pathname} MODE=${mode}`,
    );
    // badgeFacts reads through Prisma only; events and Redis are not used.
    const service = new GamificationService(prisma, {} as never, {} as never);

    const held = await prisma.userBadge.findMany({
      select: { id: true, userId: true, badge: { select: { name: true } } },
      orderBy: [{ userId: 'asc' }, { badgeId: 'asc' }],
    });
    const users = [...new Set(held.map((h) => h.userId))];
    const qualifies = new Map<number, Set<string>>();
    for (const userId of users) {
      qualifies.set(
        userId,
        new Set(qualifyingBadges(await service.badgeFacts(userId))),
      );
    }

    const revoke = held.filter(
      (h) =>
        h.badge.name in BADGE_DESCRIPTIONS &&
        !qualifies.get(h.userId)!.has(h.badge.name),
    );
    const perBadge = new Map<string, { held: number; revoked: number }>();
    for (const h of held) {
      const row = perBadge.get(h.badge.name) ?? { held: 0, revoked: 0 };
      row.held += 1;
      perBadge.set(h.badge.name, row);
    }
    for (const r of revoke) perBadge.get(r.badge.name)!.revoked += 1;

    console.log(`USERS_WITH_BADGES=${users.length}`);
    console.log(`USER_BADGES_HELD=${held.length}`);
    console.log(`USER_BADGES_TO_REVOKE=${revoke.length}`);
    for (const [name, row] of perBadge)
      console.log(
        `  ${name}: held ${row.held}, revoke ${row.revoked}, keep ${row.held - row.revoked}${name in BADGE_DESCRIPTIONS ? '' : ' (not one of the eight, left alone)'}`,
      );
    for (const r of revoke)
      console.log(`  revoke userId=${r.userId} badge="${r.badge.name}"`);

    const badges = await prisma.badge.findMany({
      where: { name: { in: Object.keys(BADGE_DESCRIPTIONS) } },
      select: { id: true, name: true, description: true },
    });
    const descriptionChanges = badges.filter(
      (b) => b.description !== BADGE_DESCRIPTIONS[b.name].description,
    );
    console.log(`BADGE_DESCRIPTIONS_TO_UPDATE=${descriptionChanges.length}`);
    for (const b of descriptionChanges)
      console.log(
        `  ${b.name}: "${b.description}" -> "${BADGE_DESCRIPTIONS[b.name].description}"`,
      );

    if (mode === 'dryrun') {
      console.log('WRITES=0 (dryrun)');
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const b of badges)
        await tx.badge.update({
          where: { id: b.id },
          data: {
            description: BADGE_DESCRIPTIONS[b.name].description,
            criteria: BADGE_DESCRIPTIONS[b.name].criteria as never,
          },
        });
      const deleted = await tx.userBadge.deleteMany({
        where: { id: { in: revoke.map((r) => r.id) } },
      });
      if (deleted.count !== revoke.length)
        throw new Error(
          `ABORT: deleted ${deleted.count}, expected ${revoke.length}`,
        );
    });
    console.log(
      `APPLIED badges_updated=${badges.length} user_badges_revoked=${revoke.length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
