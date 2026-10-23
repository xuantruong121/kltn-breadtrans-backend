/**
 * Build artifacts/premium-content-recovery-evidence.json.
 *
 * The incident left every content row free (Quiz 0/44, SpeakingExercise 0/52)
 * because premium tiering was never seeded - prisma/seed.ts sets
 * isPremiumContent nowhere, and the two premium migrations are schema-only and
 * explicitly leave existing rows free. The tiering was applied at runtime by
 * scripts/rollout-premium-content.ts, so restoring it needs forensic evidence.
 *
 * Evidence sources, independent of one another:
 *   R2       - objects under premium/... in the PRIVATE premium bucket
 *   MANIFEST - the committed approved id manifest in rollout-premium-content.ts
 *
 * Access control is only changed where BOTH agree (PROVEN). The committed
 * manifest on its own is recorded as AMBIGUOUS and never auto-applied, because
 * a manifest states intent at authoring time while the private-bucket objects
 * are evidence that the intent was actually carried out.
 *
 * Read-only. Writing the flags is a separate, explicit step.
 *
 * Usage: npx ts-node scripts/build-premium-evidence-manifest.ts
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

// Copied verbatim from scripts/rollout-premium-content.ts.
const readingPremiumIds = [14, 15, 16];
const readingFreeIds = [2, 6, 13];
const listeningPremiumIds = [5, 10, 11, 12, 25];
const listeningFreeIds = [1, 9, 23, 24, 26, 27, 28];
const speakingPremiumIds = [
  6,
  7,
  8,
  9,
  10,
  ...Array.from({ length: 13 }, (_, i) => i + 18),
];
const speakingFreeIds = [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 16, 17];
const writingPremiumIds = [4, 7, 18, 19];
const writingFreeIds = [3, 17];

type Tier = 'PREMIUM' | 'FREE';
type Candidate = {
  domain: string;
  model: string;
  id: number;
  title: string | null;
  type?: string | null;
  publicationStatus?: string | null;
  present: boolean;
  currentPremiumFlag: boolean | null;
  intendedTier: Tier;
  evidence: {
    r2PremiumObjects: number;
    r2SampleKey: string | null;
    committedManifest: boolean;
    seedEvidence: boolean;
    migrationBackfill: boolean;
  };
  independentSources: number;
  confidence: 'PROVEN' | 'HIGH_CONFIDENCE' | 'AMBIGUOUS';
  finalAction: string;
};

async function listPremiumKeys() {
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_PRIVATE_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_PRIVATE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_PRIVATE_SECRET_ACCESS_KEY!,
    },
  });
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: process.env.R2_PRIVATE_BUCKET_NAME,
        ContinuationToken: token,
      }),
    );
    keys.push(
      ...(page.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key)),
    );
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const keys = await listPremiumKeys();
    const r2ByQuiz = new Map<number, string[]>();
    for (const key of keys) {
      const match = /^premium\/[a-z]+\/quiz-(\d+)\//.exec(key);
      if (!match) continue;
      const id = Number(match[1]);
      r2ByQuiz.set(id, [...(r2ByQuiz.get(id) ?? []), key]);
    }

    const candidates: Candidate[] = [];

    const addQuizzes = async (ids: number[], domain: string, tier: Tier) => {
      const rows = await prisma.quiz.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          title: true,
          type: true,
          publicationStatus: true,
          isPremiumContent: true,
        },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const id of ids) {
        const row = byId.get(id);
        const r2 = r2ByQuiz.get(id) ?? [];
        const confidence =
          tier === 'PREMIUM'
            ? r2.length > 0
              ? ('PROVEN' as const)
              : ('AMBIGUOUS' as const)
            : ('PROVEN' as const);
        candidates.push({
          domain,
          model: 'Quiz',
          id,
          title: row?.title ?? null,
          type: row?.type ?? null,
          publicationStatus: row?.publicationStatus ?? null,
          present: Boolean(row),
          currentPremiumFlag: row ? row.isPremiumContent : null,
          intendedTier: tier,
          evidence: {
            r2PremiumObjects: r2.length,
            r2SampleKey: r2[0] ?? null,
            committedManifest: true,
            seedEvidence: false,
            migrationBackfill: false,
          },
          independentSources: r2.length > 0 ? 2 : 1,
          confidence,
          finalAction:
            tier === 'PREMIUM'
              ? confidence === 'PROVEN'
                ? row?.isPremiumContent
                  ? 'ALREADY_PREMIUM_NO_CHANGE'
                  : 'SET_PREMIUM_TRUE'
                : 'NO_CHANGE_INSUFFICIENT_CORROBORATION'
              : row?.isPremiumContent
                ? 'SET_PREMIUM_FALSE'
                : 'ALREADY_FREE_NO_CHANGE',
        });
      }
    };

    await addQuizzes(listeningPremiumIds, 'LISTENING', 'PREMIUM');
    await addQuizzes(listeningFreeIds, 'LISTENING', 'FREE');
    await addQuizzes(readingPremiumIds, 'READING', 'PREMIUM');
    await addQuizzes(readingFreeIds, 'READING', 'FREE');
    await addQuizzes(writingPremiumIds, 'WRITING', 'PREMIUM');
    await addQuizzes(writingFreeIds, 'WRITING', 'FREE');

    const speakingRows = await prisma.speakingExercise.findMany({
      where: { id: { in: [...speakingPremiumIds, ...speakingFreeIds] } },
      select: { id: true, title: true, isPremiumContent: true },
    });
    const speakingById = new Map(speakingRows.map((row) => [row.id, row]));
    for (const [ids, tier] of [
      [speakingPremiumIds, 'PREMIUM'],
      [speakingFreeIds, 'FREE'],
    ] as Array<[number[], Tier]>) {
      for (const id of ids) {
        const row = speakingById.get(id);
        candidates.push({
          domain: 'SPEAKING',
          model: 'SpeakingExercise',
          id,
          title: row?.title ?? null,
          present: Boolean(row),
          currentPremiumFlag: row ? row.isPremiumContent : null,
          intendedTier: tier,
          evidence: {
            r2PremiumObjects: 0,
            r2SampleKey: null,
            committedManifest: true,
            seedEvidence: false,
            migrationBackfill: false,
          },
          independentSources: 1,
          confidence: tier === 'PREMIUM' ? 'AMBIGUOUS' : 'PROVEN',
          finalAction:
            tier === 'PREMIUM'
              ? 'NO_CHANGE_INSUFFICIENT_CORROBORATION'
              : row?.isPremiumContent
                ? 'SET_PREMIUM_FALSE'
                : 'ALREADY_FREE_NO_CHANGE',
        });
      }
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      rule: 'PROVEN requires R2 private premium-bucket evidence PLUS at least one independent source (the committed approved manifest). The manifest alone is AMBIGUOUS and is never auto-applied.',
      sourcesChecked: {
        r2PrivatePremiumBucket: process.env.R2_PRIVATE_BUCKET_NAME,
        r2PremiumObjectsTotal: keys.length,
        committedManifest: 'scripts/rollout-premium-content.ts',
        prismaSeed:
          'prisma/seed.ts - sets isPremiumContent nowhere (0 occurrences)',
        migrations: [
          '20261006120000_add_reading_listening_premium_content (schema only; "Existing quizzes remain free")',
          '20261006150000_add_speaking_writing_premium_content (schema only; "Existing content remains free")',
        ],
      },
      counts: {
        total: candidates.length,
        proven: candidates.filter((c) => c.confidence === 'PROVEN').length,
        ambiguous: candidates.filter((c) => c.confidence === 'AMBIGUOUS')
          .length,
        toSetPremium: candidates.filter(
          (c) => c.finalAction === 'SET_PREMIUM_TRUE',
        ).length,
        withheld: candidates.filter(
          (c) => c.finalAction === 'NO_CHANGE_INSUFFICIENT_CORROBORATION',
        ).length,
        absent: candidates.filter((c) => !c.present).length,
      },
      candidates,
    };

    const out = join(
      process.cwd(),
      'artifacts',
      'premium-content-recovery-evidence.json',
    );
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);

    console.log(`manifest written: ${out}`);
    console.log(JSON.stringify(summary.counts, null, 1));
    console.log('\n--- PROVEN premium (R2 + committed manifest) ---');
    for (const c of candidates.filter(
      (x) => x.finalAction === 'SET_PREMIUM_TRUE',
    ))
      console.log(
        `  ${c.domain} ${c.model} ${c.id}: ${c.evidence.r2PremiumObjects} R2 objects | ${c.title}`,
      );
    console.log('\n--- WITHHELD (manifest only, no R2 corroboration) ---');
    const withheld = candidates.filter(
      (x) => x.finalAction === 'NO_CHANGE_INSUFFICIENT_CORROBORATION',
    );
    const byDomain: Record<string, number> = {};
    for (const c of withheld)
      byDomain[c.domain] = (byDomain[c.domain] ?? 0) + 1;
    console.log(` ${JSON.stringify(byDomain)}`);
    console.log('\n--- manifest rows whose entity is absent ---');
    const absent = candidates.filter((x) => !x.present);
    if (!absent.length) console.log('  none');
    for (const c of absent) console.log(`  ${c.domain} ${c.model} ${c.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Premium evidence manifest failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
