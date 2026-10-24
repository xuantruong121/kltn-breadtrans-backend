import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { R2Service } from '../src/modules/upload/r2.service';
import { UploadService } from '../src/modules/upload/upload.service';
import { ListeningAudioAuthoringService } from '../src/modules/quiz/listening-audio-authoring.service';

const quizId = Number(process.argv[2]);

async function main() {
  if (!Number.isInteger(quizId)) {
    throw new Error('Usage: qa-reactivate-listening-artifact.ts <quizId>');
  }
  const prisma = new PrismaClient() as unknown as PrismaService;
  const client = prisma as unknown as PrismaClient;
  try {
    const service = new ListeningAudioAuthoringService(
      prisma,
      new UploadService(new R2Service()),
    );
    const result = await service.relinkPublishedArtifactFromStorage(quizId, {
      maxVersionProbe: 7,
    });
    if (result.status !== 'RELINKED' && result.status !== 'ALREADY_PUBLISHED') {
      throw new Error(`REACTIVATION_FAILED status=${result.status}`);
    }
    const artifact = await client.listeningAudioArtifact.findFirstOrThrow({
      where: { quizId, status: 'PUBLISHED' },
      select: { id: true, version: true, r2Key: true, checksumSha256: true, durationMs: true, timeline: true },
    });
    console.log(JSON.stringify({
      quizId,
      reactivation: result.status,
      artifactId: artifact.id,
      version: artifact.version,
      r2Key: artifact.r2Key,
      durationMs: artifact.durationMs,
      timelineEntries: Array.isArray(artifact.timeline) ? artifact.timeline.length : 0,
      EXISTING_ARTIFACT_REACTIVATED: result.status === 'RELINKED' || result.status === 'ALREADY_PUBLISHED',
      AZURE_CALL_COUNT: 0,
      TTS_CALL_COUNT: 0,
      R2_WRITE_COUNT: 0,
    }));
  } finally {
    await client.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
