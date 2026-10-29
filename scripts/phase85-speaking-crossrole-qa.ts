import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';

const api = 'http://127.0.0.1:3001';
const prefix = `qa-crossrole-speaking-${Date.now()}`;
const password = `Phase85!${randomUUID()}`;
const prisma = new PrismaClient();

const unwrap = <T>(value: any) => (value?.data ?? value) as T;

async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: T }> {
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
  return { status: response.status, data };
}

async function expectOk<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
) {
  const result = await request<T>(path, method, body, token);
  if (result.status < 200 || result.status >= 300)
    throw new Error(
      `${method} ${path} -> ${result.status}: ${JSON.stringify(result.data)}`,
    );
  return result.data;
}

async function cleanup() {
  await prisma.speakingPracticeSet.deleteMany({
    where: { title: { startsWith: prefix } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}

async function main() {
  await cleanup();
  const [admin, learner] = await Promise.all([
    prisma.user.create({
      data: {
        email: `${prefix}-admin@breadtrans.qa`,
        password: await bcrypt.hash(password, 10),
        role: Role.ADMIN,
      },
    }),
    prisma.user.create({
      data: {
        email: `${prefix}-learner@breadtrans.qa`,
        password: await bcrypt.hash(password, 10),
        role: Role.STUDENT,
      },
    }),
  ]);

  const adminLogin = await expectOk<{ access_token: string }>(
    '/auth/login',
    'POST',
    { email: admin.email, password },
  );
  const learnerLogin = await expectOk<{ access_token: string }>(
    '/auth/login',
    'POST',
    { email: learner.email, password },
  );
  const adminToken = adminLogin.access_token;
  const learnerToken = learnerLogin.access_token;

  const set = await expectOk<any>(
    '/admin/skill-content/speaking',
    'POST',
    {
      title: `${prefix}-set`,
      description: 'Cross-role lifecycle fixture',
      category: 'DAILY_LIFE',
      level: 'BEGINNER',
    },
    adminToken,
  );
  const first = await expectOk<any>(
    `/admin/skill-content/speaking/${set.id}/exercises`,
    'POST',
    {
      title: `${prefix}-first`,
      targetText: 'Please introduce yourself.',
      category: 'DAILY_LIFE',
      difficulty: 'BEGINNER',
    },
    adminToken,
  );

  await expectOk(
    `/admin/skill-content/speaking/${set.id}/publish`,
    'POST',
    { status: 'PUBLISHED' },
    adminToken,
  );
  const visibleAfterFirstPublish = await expectOk<any[]>(
    '/speaking/exercises',
    'GET',
    undefined,
    learnerToken,
  );
  if (!visibleAfterFirstPublish.some((item) => item.id === first.id))
    throw new Error('Published Speaking child is missing for learner');

  const second = await expectOk<any>(
    `/admin/skill-content/speaking/${set.id}/exercises`,
    'POST',
    {
      title: `${prefix}-second`,
      targetText: 'Tell me about your daily routine.',
      category: 'DAILY_LIFE',
      difficulty: 'BEGINNER',
    },
    adminToken,
  );
  const adminDetail = await expectOk<any>(
    `/admin/skill-content/speaking/${set.id}`,
    'GET',
    undefined,
    adminToken,
  );
  const secondInAdmin = adminDetail.exercises.find(
    (item: any) => item.id === second.id,
  );
  if (secondInAdmin?.publicationStatus !== 'DRAFT')
    throw new Error('New Speaking child was not created as DRAFT');

  const learnerBeforeRepublish = await request<any>(
    `/speaking/exercises/${second.id}`,
    'GET',
    undefined,
    learnerToken,
  );
  if (learnerBeforeRepublish.status !== 404)
    throw new Error(
      `Draft Speaking child leaked to learner: ${learnerBeforeRepublish.status}`,
    );

  await expectOk(
    `/admin/skill-content/speaking/${set.id}/publish`,
    'POST',
    { status: 'DRAFT' },
    adminToken,
  );
  await expectOk(
    `/admin/skill-content/speaking/${set.id}/publish`,
    'POST',
    { status: 'PUBLISHED' },
    adminToken,
  );
  const learnerAfterRepublish = await expectOk<any>(
    `/speaking/exercises/${second.id}`,
    'GET',
    undefined,
    learnerToken,
  );
  if (learnerAfterRepublish.id !== second.id)
    throw new Error('Republished Speaking child is missing for learner');

  await expectOk(
    `/admin/skill-content/speaking/${set.id}/publish`,
    'POST',
    { status: 'DRAFT' },
    adminToken,
  );
  const learnerAfterUnpublish = await request<any>(
    `/speaking/exercises/${first.id}`,
    'GET',
    undefined,
    learnerToken,
  );
  if (learnerAfterUnpublish.status !== 404)
    throw new Error(
      `Unpublished Speaking parent still exposes learner detail: ${learnerAfterUnpublish.status}`,
    );

  console.log(
    JSON.stringify(
      {
        prefix,
        speakingCrossRole: {
          firstPublished: true,
          newChildDraftHidden: true,
          republishPropagatesToChild: true,
          parentUnpublishHidesChildren: true,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
