import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { PrismaClient, QuizPublicationStatus, Role } from '@prisma/client';

const api = process.env.READING_QA_BACKEND_ORIGIN ?? 'http://127.0.0.1:3018';
const prefix = 'qa-cms-workflow-reading-final-';
const run = Date.now();
const fixturePrefix = `${prefix}${run}-`;
const password = `Reading451!${run}`;
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
  if (!response.ok)
    throw new Error(
      `${method} ${path} -> ${response.status}: ${JSON.stringify(data)}`,
    );
  return data;
}

async function status(path: string, token?: string) {
  const response = await fetch(`${api}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    data: text ? unwrap<any>(JSON.parse(text)) : null,
  };
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
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}

async function snapshot() {
  return prisma.quiz.findMany({
    where: {
      type: 'BILINGUAL_READING',
      NOT: { title: { startsWith: prefix } },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      publicationStatus: true,
      theoryContent: true,
      questions: {
        orderBy: { order: 'asc' },
        select: { id: true, type: true, content: true },
      },
    },
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function contentKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const result: string[] = [];
  const walk = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) return item.forEach(walk);
    for (const [key, nested] of Object.entries(item)) {
      result.push(key);
      walk(nested);
    }
  };
  walk(value);
  return result;
}

async function main() {
  await cleanup();
  const before = await snapshot();
  const adminEmail = `${fixturePrefix}admin@breadtrans.qa`;
  const learnerEmail = `${fixturePrefix}learner@breadtrans.qa`;
  await Promise.all([
    prisma.user.create({
      data: {
        email: adminEmail,
        password: await bcrypt.hash(password, 10),
        role: Role.ADMIN,
      },
    }),
    prisma.user.create({
      data: {
        email: learnerEmail,
        password: await bcrypt.hash(password, 10),
        role: Role.STUDENT,
      },
    }),
  ]);
  const adminToken = await login(adminEmail);
  const learnerToken = await login(learnerEmail);
  const passage =
    'Urban gardens turn unused rooftops into productive green spaces. They provide fresh vegetables for nearby residents and help cool buildings during hot weather.';
  const updatedPassage =
    'Updated urban gardens turn unused rooftops into productive green spaces. They provide fresh vegetables for nearby residents and help cool buildings during hot weather.';

  const published = await request<any>(
    '/admin/skill-content/reading',
    'POST',
    {
      title: `${fixturePrefix}published`,
      description: 'Published Reading fixture',
      level: 'A2',
      passage,
    },
    adminToken,
  );
  const draft = await request<any>(
    '/admin/skill-content/reading',
    'POST',
    {
      title: `${fixturePrefix}draft`,
      description: 'Draft Reading fixture',
      level: 'A2',
      passage,
    },
    adminToken,
  );
  await request<any>(
    '/admin/skill-content/reading',
    'POST',
    {
      title: `${fixturePrefix}empty`,
      description: 'Empty Reading fixture',
      level: 'A2',
      passage: '',
    },
    adminToken,
  );

  const initialContent = {
    text: 'What is one benefit of urban gardens?',
    passage,
    options: [
      'They remove all traffic.',
      'They provide fresh vegetables.',
      'They increase building height.',
      'They close rooftops.',
    ],
    correctIndex: 1,
    explanation: 'The passage says urban gardens provide fresh vegetables.',
    questionType: 'MAIN_IDEA',
  };
  const question = await request<any>(
    `/admin/skill-content/reading/${published.id}/questions`,
    'POST',
    { type: 'MULTIPLE_CHOICE', content: initialContent, order: 0 },
    adminToken,
  );
  const adminReload = await request<any>(
    `/admin/skill-content/reading/${published.id}`,
    'GET',
    undefined,
    adminToken,
  );
  const persisted = adminReload.questions.find(
    (item: any) => item.id === question.id,
  );
  assert(
    persisted?.content?.passage === passage,
    'Reading passage did not persist',
  );
  assert(
    persisted?.content?.questionType === 'MAIN_IDEA',
    'Reading questionType did not persist',
  );
  assert(
    JSON.stringify(persisted?.content?.options) ===
      JSON.stringify(initialContent.options),
    'Reading options did not persist',
  );
  assert(
    persisted?.content?.correctIndex === 1,
    'Reading correctIndex did not persist',
  );
  assert(
    persisted?.content?.explanation === initialContent.explanation,
    'Reading explanation did not persist',
  );

  await request(
    `/admin/skill-content/reading/${published.id}`,
    'PATCH',
    {
      title: published.title,
      description: published.description,
      level: 'A2',
      passage: updatedPassage,
    },
    adminToken,
  );
  const passageReload = await request<any>(
    `/admin/skill-content/reading/${published.id}`,
    'GET',
    undefined,
    adminToken,
  );
  assert(
    passageReload.passage === updatedPassage,
    'Updated passage did not reload',
  );

  const updatedContent = {
    text: 'Which detail is stated about urban gardens?',
    passage: updatedPassage,
    options: [
      'They provide fresh vegetables.',
      'They replace every park.',
      'They make buildings taller.',
      'They require no space.',
    ],
    correctIndex: 0,
    explanation: 'The updated question is answered directly by the passage.',
    questionType: 'DETAIL',
  };
  await request(
    `/admin/skill-content/reading/${published.id}/questions/${question.id}`,
    'PATCH',
    { type: 'MULTIPLE_CHOICE', content: updatedContent, order: 0 },
    adminToken,
  );
  const questionReload = await request<any>(
    `/admin/skill-content/reading/${published.id}`,
    'GET',
    undefined,
    adminToken,
  );
  const updated = questionReload.questions.find(
    (item: any) => item.id === question.id,
  );
  assert(
    updated?.content?.text === updatedContent.text,
    'Reading question text did not update',
  );
  assert(
    updated?.content?.passage === updatedPassage,
    'Reading question passage did not update',
  );
  assert(
    updated?.content?.questionType === 'DETAIL',
    'Reading questionType did not update',
  );
  assert(
    updated?.content?.correctIndex === 0,
    'Reading correctIndex did not update',
  );
  assert(
    updated?.content?.explanation === updatedContent.explanation,
    'Reading explanation did not update',
  );

  await request(
    `/admin/skill-content/reading/${published.id}/publish`,
    'POST',
    { status: QuizPublicationStatus.PUBLISHED },
    adminToken,
  );
  const listed = await request<any[]>(
    '/admin/skill-content/reading',
    'GET',
    undefined,
    adminToken,
  );
  assert(
    listed.some(
      (item: any) =>
        item.id === published.id && item.publicationStatus === 'PUBLISHED',
    ),
    'Published Reading missing from admin list',
  );
  assert(
    listed.some(
      (item: any) => item.id === draft.id && item.publicationStatus === 'DRAFT',
    ),
    'Draft Reading missing from admin list',
  );
  await request(
    `/admin/skill-content/reading/${published.id}/publish`,
    'POST',
    { status: QuizPublicationStatus.DRAFT },
    adminToken,
  );
  await request(
    `/admin/skill-content/reading/${published.id}/publish`,
    'POST',
    { status: QuizPublicationStatus.PUBLISHED },
    adminToken,
  );

  const draftLearner = await status(`/quizzes/${draft.id}`, learnerToken);
  assert(
    [403, 404].includes(draftLearner.status),
    `Draft leaked to learner: ${draftLearner.status}`,
  );
  const learnerQuiz = await request<any>(
    `/quizzes/${published.id}`,
    'GET',
    undefined,
    learnerToken,
  );
  const learnerQuestion = learnerQuiz.questions?.[0]?.content ?? {};
  const forbidden = ['correct', 'correctAnswer', 'correctIndex', 'explanation'];
  assert(
    !contentKeys(learnerQuestion).some((key) => forbidden.includes(key)),
    'Learner Reading payload leaked answer metadata',
  );

  const wrong = await request<any>(
    `/quizzes/${published.id}/submit`,
    'POST',
    {
      answers: [
        { questionId: question.id, answer: 'They make buildings taller.' },
      ],
      clientAttemptId: randomUUID(),
    },
    learnerToken,
  );
  assert(
    wrong.results?.[0]?.isCorrect === false,
    'Wrong Reading answer was graded as correct',
  );
  const correct = await request<any>(
    `/quizzes/${published.id}/submit`,
    'POST',
    {
      answers: [{ questionId: question.id, answer: updatedContent.options[0] }],
      clientAttemptId: randomUUID(),
    },
    learnerToken,
  );
  assert(
    correct.results?.[0]?.isCorrect === true,
    'Correct Reading answer was not graded as correct',
  );

  const after = await snapshot();
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    'Active Reading snapshot changed',
  );
  console.log(
    JSON.stringify(
      {
        READING_QA_ENVIRONMENT_PASS: true,
        READING_CHILD_OWNERSHIP_PASS: true,
        READING_API_LIFECYCLE_PASS: true,
        READING_PASSAGE_CREATE_PASS: true,
        READING_PASSAGE_UPDATE_PASS: true,
        READING_QUESTION_PERSISTENCE_PASS: true,
        READING_QUESTION_UPDATE_PASS: true,
        READING_API_WORKFLOW_PASS: true,
        READING_DRAFT_ISOLATION_PASS: true,
        READING_ANSWER_SECURITY_PASS: true,
        READING_GRADING_PASS: true,
        ACTIVE_READING_CONTENT_UNCHANGED: true,
      },
      null,
      2,
    ),
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
