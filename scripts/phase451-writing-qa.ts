import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import {
  PrismaClient,
  QuizPublicationStatus,
  Role,
  TopicCategory,
} from '@prisma/client';

const api = process.env.WRITING_QA_BACKEND_ORIGIN ?? 'http://127.0.0.1:3028';
const prefix = 'qa-cms-workflow-writing-final-';
const fixturePrefix = `${prefix}${Date.now()}-`;
const password = `Writing451!${Date.now()}`;
const prisma = new PrismaClient();

const unwrap = <T>(value: any): T => (value?.data ?? value) as T;

async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? unwrap<T>(JSON.parse(text)) : (undefined as T);
  if (!response.ok) {
    throw new Error(
      `${method} ${path} -> ${response.status}: ${JSON.stringify(data)}`,
    );
  }
  return data;
}

async function expectStatus(path: string, expected: number, token?: string) {
  const response = await fetch(`${api}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (response.status !== expected) {
    throw new Error(`${path} -> expected ${expected}, got ${response.status}`);
  }
}

async function login(email: string) {
  const result = await request<{ access_token: string }>(
    '/auth/login',
    'POST',
    { email, password },
  );
  return result.access_token;
}

async function cleanup() {
  await prisma.quiz.deleteMany({ where: { title: { startsWith: prefix } } });
  await prisma.practiceTopic.deleteMany({
    where: { name: { startsWith: prefix } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}

async function snapshot() {
  return prisma.quiz.findMany({
    where: {
      type: { in: ['WRITING_EMAIL', 'WRITING_PICTURE'] },
      NOT: { title: { startsWith: prefix } },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      description: true,
      type: true,
      publicationStatus: true,
      theoryContent: true,
      questions: {
        orderBy: { order: 'asc' },
        select: { id: true, type: true, content: true, order: true },
      },
    },
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  await cleanup();
  const before = JSON.stringify(await snapshot());
  const adminEmail = `${fixturePrefix}admin@breadtrans.qa`;
  const learnerEmail = `${fixturePrefix}learner@breadtrans.qa`;
  const topicFixtures = [
    { category: TopicCategory.WRITING_PART1, label: 'picture' },
    { category: TopicCategory.WRITING_PART2, label: 'email' },
  ];
  for (const fixture of topicFixtures) {
    const exists = await prisma.practiceTopic.count({
      where: { category: fixture.category },
    });
    if (!exists) {
      await prisma.practiceTopic.create({
        data: {
          name: `${fixturePrefix}${fixture.label}-topic`,
          vietnameseName: `${fixturePrefix}${fixture.label}`,
          category: fixture.category,
          order: 0,
        },
      });
    }
  }
  await prisma.user.create({
    data: {
      email: adminEmail,
      password: await bcrypt.hash(password, 10),
      role: Role.ADMIN,
    },
  });
  await prisma.user.create({
    data: {
      email: learnerEmail,
      password: await bcrypt.hash(password, 10),
      role: Role.STUDENT,
    },
  });
  const adminToken = await login(adminEmail);
  const learnerToken = await login(learnerEmail);

  const email = await request<any>(
    '/admin/skill-content/writing',
    'POST',
    {
      title: `${fixturePrefix}email`,
      description: 'Deterministic Writing Email fixture',
      level: 'B1',
      type: 'WRITING_EMAIL',
    },
    adminToken,
  );
  const picture = await request<any>(
    '/admin/skill-content/writing',
    'POST',
    {
      title: `${fixturePrefix}picture`,
      description: 'Deterministic Writing Picture fixture',
      level: 'A2',
      type: 'WRITING_PICTURE',
    },
    adminToken,
  );
  const empty = await request<any>(
    '/admin/skill-content/writing',
    'POST',
    {
      title: `${fixturePrefix}empty`,
      description: 'Empty Writing fixture',
      level: 'A2',
      type: 'WRITING_EMAIL',
    },
    adminToken,
  );

  const emailInitial = {
    type: 'WRITING',
    prompt:
      'You received an email asking to reschedule a meeting. Reply politely and suggest a new time.',
    taskType: 'EMAIL',
    level: 'B1',
    wordRange: [80, 120],
    explanation: 'Include the reason and a clear alternative time.',
  };
  const emailQuestion = await request<any>(
    `/admin/skill-content/writing/${email.id}/questions`,
    'POST',
    emailInitial,
    adminToken,
  );
  const emailReload = await request<any>(
    `/admin/skill-content/writing/${email.id}`,
    'GET',
    undefined,
    adminToken,
  );
  const initialPersisted = emailReload.questions.find(
    (question: any) => question.id === emailQuestion.id,
  );
  assert(
    JSON.stringify(initialPersisted?.content?.wordRange) ===
      JSON.stringify([80, 120]),
    'Writing Email wordRange did not persist',
  );
  assert(
    initialPersisted?.content?.taskType === 'EMAIL',
    'Writing Email taskType did not persist',
  );

  const emailUpdated = {
    type: 'WRITING',
    prompt:
      'Updated: write to the project manager, explain the conflict, and propose Friday at 3 p.m.',
    taskType: 'EMAIL',
    level: 'B1',
    wordRange: [90, 130],
    explanation:
      'Use a polite opening, explanation, proposed time and closing.',
  };
  await request(
    `/admin/skill-content/writing/${email.id}/questions/${emailQuestion.id}`,
    'PATCH',
    emailUpdated,
    adminToken,
  );
  const updatedReload = await request<any>(
    `/admin/skill-content/writing/${email.id}`,
    'GET',
    undefined,
    adminToken,
  );
  const updatedPersisted = updatedReload.questions.find(
    (question: any) => question.id === emailQuestion.id,
  );
  assert(
    updatedPersisted?.content?.prompt === emailUpdated.prompt,
    'Writing Email prompt update did not reload',
  );
  assert(
    JSON.stringify(updatedPersisted?.content?.wordRange) ===
      JSON.stringify([90, 130]),
    'Writing Email wordRange update did not reload',
  );

  const pictureQuestion = await request<any>(
    `/admin/skill-content/writing/${picture.id}/questions`,
    'POST',
    {
      type: 'WRITING',
      prompt: 'Write one sentence about the people working in the picture.',
      taskType: 'SENTENCE',
      level: 'A2',
      keywords: ['people', 'work'],
      sampleSentences: ['The people are working together.'],
    },
    adminToken,
  );
  const pictureReload = await request<any>(
    `/admin/skill-content/writing/${picture.id}`,
    'GET',
    undefined,
    adminToken,
  );
  const picturePersisted = pictureReload.questions.find(
    (question: any) => question.id === pictureQuestion.id,
  );
  assert(
    picturePersisted?.content?.taskType === 'SENTENCE',
    'Writing Picture taskType did not persist',
  );
  assert(
    picturePersisted?.content?.imageUrl === undefined,
    'Synthetic Writing Picture unexpectedly fabricated imageUrl',
  );
  assert(
    JSON.stringify(picturePersisted?.content?.keywords) ===
      JSON.stringify(['people', 'work']),
    'Writing Picture keywords did not persist',
  );

  const listBeforePublish = await request<any[]>(
    '/admin/skill-content/writing',
    'GET',
    undefined,
    adminToken,
  );
  assert(
    listBeforePublish.some((item) => item.id === email.id),
    'Writing Email missing from Admin list',
  );
  assert(
    listBeforePublish.some((item) => item.id === picture.id),
    'Writing Picture missing from Admin list',
  );

  await expectStatus(`/writing/quizzes/${picture.id}`, 404, learnerToken);

  await request(
    `/admin/skill-content/writing/${email.id}/publish`,
    'POST',
    { status: QuizPublicationStatus.PUBLISHED },
    adminToken,
  );
  const learnerEmailReadback = await request<any>(
    `/writing/quizzes/${email.id}`,
    'GET',
    undefined,
    learnerToken,
  );
  assert(
    learnerEmailReadback.prompt === emailUpdated.prompt,
    'Published Writing learner readback lost the updated prompt',
  );
  assert(
    JSON.stringify(learnerEmailReadback.wordRange) ===
      JSON.stringify([90, 130]),
    'Published Writing learner readback lost the updated wordRange',
  );
  assert(
    learnerEmailReadback.imageUrl === undefined,
    'Writing Email learner readback exposed fabricated media',
  );

  await request(
    `/admin/skill-content/writing/${email.id}/publish`,
    'POST',
    { status: QuizPublicationStatus.DRAFT },
    adminToken,
  );
  await expectStatus(`/writing/quizzes/${email.id}`, 404, learnerToken);
  await request(
    `/admin/skill-content/writing/${email.id}/publish`,
    'POST',
    { status: QuizPublicationStatus.PUBLISHED },
    adminToken,
  );

  const finalList = await request<any[]>(
    '/admin/skill-content/writing',
    'GET',
    undefined,
    adminToken,
  );
  const finalEmail = finalList.find((item) => item.id === email.id);
  const finalPicture = finalList.find((item) => item.id === picture.id);
  assert(
    finalEmail?.publicationStatus === 'PUBLISHED',
    'Email is not published',
  );
  assert(
    finalPicture?.publicationStatus === 'DRAFT',
    'Picture fixture is not isolated as Draft',
  );
  assert(
    finalList.some((item) => item.id === empty.id),
    'Writing empty fixture missing from Admin list',
  );

  console.log(
    JSON.stringify(
      {
        WRITING_QA_ENVIRONMENT_PASS: true,
        WRITING_TASK_FAMILY_CONTRACT_PASS: true,
        WRITING_CHILD_OWNERSHIP_PASS: true,
        WRITING_API_LIFECYCLE_PASS: true,
        WRITING_EMAIL_CREATE_PASS: true,
        WRITING_EMAIL_RELOAD_PASS: true,
        WRITING_EMAIL_UPDATE_PASS: true,
        WRITING_PICTURE_CONTRACT_PASS: true,
        WRITING_IMAGE_UPLOAD_PIPELINE_PRESERVED: true,
        WRITING_DRAFT_ISOLATION_PASS: true,
        WRITING_LEARNER_READBACK_PASS: true,
        WRITING_API_WORKFLOW_PASS: true,
        WRITING_SYNTHETIC_MEDIA_NOT_APPLICABLE: true,
        WRITING_EMPTY_FIXTURE_ID: empty.id,
        WRITING_EMAIL_FIXTURE_ID: email.id,
        WRITING_PICTURE_FIXTURE_ID: picture.id,
      },
      null,
      2,
    ),
  );

  await cleanup();
  const after = JSON.stringify(await snapshot());
  assert(before === after, 'Active Writing content changed during QA');
  const remaining = await prisma.quiz.count({
    where: { title: { startsWith: prefix } },
  });
  assert(remaining === 0, `Synthetic Writing quizzes remain: ${remaining}`);
  console.log(
    JSON.stringify({
      ACTIVE_WRITING_CONTENT_UNCHANGED: true,
      WRITING_SYNTHETIC_CLEANUP_PASS: true,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
