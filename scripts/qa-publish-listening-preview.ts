import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { R2Service } from '../src/modules/upload/r2.service';
import { UploadService } from '../src/modules/upload/upload.service';
import { ListeningAudioAuthoringService } from '../src/modules/quiz/listening-audio-authoring.service';

const quizId = Number(process.argv[2]);
const artifactId = Number(process.argv[3]);
const actorId = 17;

async function main() {
  if (!Number.isInteger(quizId) || !Number.isInteger(artifactId)) {
    throw new Error('Usage: qa-publish-listening-preview.ts <quizId> <artifactId>');
  }
  const prisma = new PrismaClient() as unknown as PrismaService;
  const service = new ListeningAudioAuthoringService(
    prisma,
    new UploadService(new R2Service()),
  );
  const client = prisma as unknown as PrismaClient;
  try {
    const artifact = await client.listeningAudioArtifact.findFirstOrThrow({
      where: { id: artifactId, quizId, status: 'PREVIEW_READY' },
      select: { id: true, version: true, status: true },
    });
    await service.approve(quizId, artifact.id, actorId);
    const published = await service.publish(quizId, artifact.id, actorId);
    console.log(JSON.stringify({
      quizId,
      artifactId: published.id,
      version: published.version,
      status: published.status,
      PUBLISH_EXISTING_PREVIEW_PASS: published.status === 'PUBLISHED',
    }));
  } finally {
    await client.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
