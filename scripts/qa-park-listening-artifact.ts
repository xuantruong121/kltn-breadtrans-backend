import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const quizId = Number(process.argv[2]);
const artifactId = Number(process.argv[3]);

async function main() {
  if (!Number.isInteger(quizId) || !Number.isInteger(artifactId)) {
    throw new Error('Usage: qa-park-listening-artifact.ts <quizId> <artifactId>');
  }

  const prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`listening_publish:${quizId}`}))
      `;
      const artifact = await tx.listeningAudioArtifact.findFirstOrThrow({
        where: { id: artifactId, quizId, status: 'PUBLISHED' },
        select: {
          id: true,
          version: true,
          status: true,
          r2Key: true,
          checksumSha256: true,
          durationMs: true,
          timeline: true,
        },
      });
      const parked = await tx.listeningAudioArtifact.update({
        where: { id: artifact.id },
        data: { status: 'STALE' },
        select: { id: true, version: true, status: true, r2Key: true, checksumSha256: true, durationMs: true, timeline: true },
      });
      return { before: artifact, after: parked };
    });

    console.log(JSON.stringify({
      quizId,
      artifactId,
      beforeStatus: result.before.status,
      afterStatus: result.after.status,
      preserved: {
        r2Key: result.after.r2Key === result.before.r2Key,
        checksumSha256: result.after.checksumSha256 === result.before.checksumSha256,
        durationMs: result.after.durationMs === result.before.durationMs,
        timeline: JSON.stringify(result.after.timeline) === JSON.stringify(result.before.timeline),
      },
      artifactParkedToStale: result.after.status === 'STALE',
    }));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
