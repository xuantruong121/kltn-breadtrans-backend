const { PrismaClient } = require('@prisma/client');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

async function main() {
  console.log('--- STARTING CONTAINER RUNTIME BULLMQ JOB TEST ---');
  const prisma = new PrismaClient();
  const redisConnection = new IORedis(
    process.env.REDIS_URL || 'redis://:redis_test_pw@redis:6379',
    {
      maxRetriesPerRequest: null,
    },
  );

  const queue = new Queue('breadtrans-speaking-assessment', {
    connection: redisConnection,
  });

  try {
    // 1. Ensure test user and exercise exist
    let user = await prisma.user.findFirst({
      where: { email: 'worker-test@breadtrans.com' },
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: 'worker-test@breadtrans.com',
          role: 'STUDENT',
        },
      });
      console.log(`Created test user #${user.id}`);
    }

    let exercise = await prisma.speakingExercise.findFirst({
      where: { title: 'Worker Runtime Test Exercise' },
    });
    if (!exercise) {
      exercise = await prisma.speakingExercise.create({
        data: {
          title: 'Worker Runtime Test Exercise',
          targetText:
            'Hello world, this is a live container verification test.',
          difficulty: 'BEGINNER',
        },
      });
      console.log(`Created test exercise #${exercise.id}`);
    }

    // 2. Create a PENDING submission
    const submission = await prisma.speakingSubmission.create({
      data: {
        userId: user.id,
        exerciseId: exercise.id,
        status: 'PENDING',
        audioKey: 'mock-sample-key',
        audioUrl: 'https://cdn.breadtrans.com/sample.wav',
        durationMs: 2500,
        audioMimeType: 'audio/wav',
        submittedAt: new Date(),
      },
    });
    console.log(`Created PENDING submission #${submission.id}`);

    // 3. Enqueue job into BullMQ using exact production custom job ID format
    const jobId = `speaking-assessment-${submission.id}`;
    const jobPayload = {
      submissionId: submission.id,
      traceId: `container-trace-${Date.now()}`,
    };

    console.log(`Enqueuing BullMQ job: ${jobId}...`);
    const job = await queue.add('assess-speaking', jobPayload, {
      jobId,
      removeOnComplete: true,
      removeOnFail: false,
    });
    console.log(`Job enqueued with ID: ${job.id}`);

    // 4. Poll database for terminal status (Worker container is actively running)
    const startTime = Date.now();
    let updatedSub = null;
    while (Date.now() - startTime < 30000) {
      updatedSub = await prisma.speakingSubmission.findUnique({
        where: { id: submission.id },
      });

      console.log(
        `[${Math.round((Date.now() - startTime) / 1000)}s] Submission #${submission.id} status: ${updatedSub.status}, workerId: ${updatedSub.workerId}`,
      );

      if (updatedSub.status === 'COMPLETED' || updatedSub.status === 'FAILED') {
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!updatedSub || updatedSub.status !== 'COMPLETED') {
      throw new Error(
        `Worker did not complete submission in time! Final status: ${updatedSub?.status}`,
      );
    }

    console.log(
      'SUCCESS! Container speaking-worker consumed job and completed evaluation:',
    );
    console.log(`- Final Status: ${updatedSub.status}`);
    console.log(`- Worker Token: ${updatedSub.workerId}`);
    console.log(`- Overall Score: ${updatedSub.overallScore}`);
    console.log(`- Provider: ${updatedSub.provider}`);
    console.log(`- Processed At: ${updatedSub.processedAt}`);
  } finally {
    await queue.close();
    await redisConnection.quit();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
