import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { R2Service } from '../src/modules/upload/r2.service';
import { UploadService } from '../src/modules/upload/upload.service';
import { ListeningAudioAuthoringService } from '../src/modules/quiz/listening-audio-authoring.service';

async function main() {
  const prisma = new PrismaService();
  const service = new ListeningAudioAuthoringService(
    prisma,
    new UploadService(new R2Service()),
  );
  try {
    const actorId = 1; // local development admin@breadtrans.com
    for (const quizId of [23, 24, 25]) {
      const validation = await service.validateContent(quizId);
      console.log(
        `VALID quiz=${quizId} turns=${validation.turns} speakers=${validation.speakers.join(',')} hash=${validation.synthesisHash}`,
      );
      const generated = await service.generatePreview(quizId, actorId);
      console.log(
        `GENERATED quiz=${quizId} artifact=${generated.id} version=${generated.version} status=${generated.status} reused=${'reused' in generated && Boolean(generated.reused)}`,
      );
      const approved = await service.approve(quizId, generated.id, actorId);
      console.log(`APPROVED quiz=${quizId} artifact=${approved.id}`);
      const published = await service.publish(quizId, generated.id, actorId);
      console.log(
        `PUBLISHED quiz=${quizId} artifact=${published.id} version=${published.version} key=${published.r2Key}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
