import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { R2Service } from '../src/modules/upload/r2.service';
import { UploadService } from '../src/modules/upload/upload.service';
import { ListeningAudioAuthoringService } from '../src/modules/quiz/listening-audio-authoring.service';

const quizId = Number(process.argv[2]);

async function main() {
  if (!Number.isInteger(quizId)) throw new Error('Usage: qa-listening-forensic.ts <quizId>');
  const prisma = new PrismaClient();
  const upload = new UploadService(new R2Service());
  const authoring = new ListeningAudioAuthoringService(prisma as any, upload);
  try {
    const [quiz, artifacts, questions, canonical] = await Promise.all([
      prisma.quiz.findUniqueOrThrow({ where: { id: quizId }, select: { id: true, title: true, type: true, isPremiumContent: true, publicationStatus: true } }),
      prisma.listeningAudioArtifact.findMany({ where: { quizId }, orderBy: { version: 'asc' }, select: { id: true, version: true, status: true, r2Key: true, r2Url: true, checksumSha256: true, durationMs: true, timeline: true, synthesisHash: true, contentHash: true, provider: true, locale: true, accent: true, voiceRegistryVersion: true, outputFormat: true } }),
      prisma.question.findMany({ where: { quizId }, orderBy: { order: 'asc' }, select: { id: true, order: true, content: true, audioAssets: { orderBy: { version: 'asc' }, select: { version: true, key: true, durationMs: true, isActive: true } } } }),
      authoring.validateContent(quizId),
    ]);
    const historical = await Promise.all(artifacts.filter((item) => item.r2Key).map(async (item) => {
      try {
        return { version: item.version, key: item.r2Key, head: await upload.headObject(item.r2Key!) };
      } catch (error) {
        return { version: item.version, key: item.r2Key, headError: error instanceof Error ? error.message : String(error) };
      }
    }));
    const turns = questions.map((question) => {
      const content = question.content as Record<string, unknown>;
      return {
        id: question.id,
        order: question.order,
        type: content.practiceKind ?? content.questionType ?? null,
        turnId: content.targetTurnId ?? null,
        speaker: content.speakerId ?? null,
        transcriptSegments: Array.isArray(content.transcriptSegments)
          ? content.transcriptSegments.map((segment: Record<string, unknown>) => ({
              turnId: segment.turnId ?? null,
              speaker: segment.speaker ?? segment.speakerId ?? null,
              voiceKey: segment.voiceKey ?? null,
              hasText: typeof segment.text === 'string' && segment.text.length > 0,
            }))
          : [],
        audioAssets: question.audioAssets,
      };
    });
    console.log(JSON.stringify({ quiz, canonical, artifacts, historical, questionCount: questions.length, turns }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
