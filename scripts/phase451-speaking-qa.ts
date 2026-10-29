import './qa/qa-legacy-guard';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';

const api = 'http://127.0.0.1:3001';
const prefix = `qa-cms-workflow-speaking-final-${Date.now()}`;
const password = `Phase451!${randomUUID()}`;
const prisma = new PrismaClient();

const unwrap = <T>(value: any) => (value?.data ?? value) as T;

async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string,
): Promise<T> {
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

async function cleanup() {
  await prisma.speakingPracticeSet.deleteMany({
    where: { title: { startsWith: prefix } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}

async function main() {
  await cleanup();
  const admin = await prisma.user.create({
    data: {
      email: `${prefix}@breadtrans.qa`,
      password: await bcrypt.hash(password, 10),
      role: Role.ADMIN,
    },
  });
  const login = await request<{ access_token: string }>('/auth/login', 'POST', {
    email: admin.email,
    password,
  });
  const token = login.access_token;

  const draft = await request<any>(
    '/admin/skill-content/speaking',
    'POST',
    {
      title: `${prefix}-draft`,
      description: 'Draft fixture',
      category: 'DAILY_LIFE',
      level: 'INTERMEDIATE',
    },
    token,
  );
  const exercise = await request<any>(
    `/admin/skill-content/speaking/${draft.id}/exercises`,
    'POST',
    {
      title: 'Full category persistence',
      targetText: 'Please introduce yourself.',
      category: 'BUSINESS',
      difficulty: 'INTERMEDIATE',
    },
    token,
  );
  const updated = await request<any>(
    `/admin/skill-content/speaking/${draft.id}/exercises/${exercise.id}`,
    'PATCH',
    {
      title: 'Updated exercise',
      targetText: 'Please introduce yourself in a formal setting.',
      category: 'ACADEMIC',
      difficulty: 'ADVANCED',
    },
    token,
  );
  if (updated.category !== 'ACADEMIC' || updated.difficulty !== 'ADVANCED')
    throw new Error('Child override did not persist');

  await request(
    `/admin/skill-content/speaking/${draft.id}/publish`,
    'POST',
    { status: 'PUBLISHED' },
    token,
  );
  await request(
    `/admin/skill-content/speaking/${draft.id}/publish`,
    'POST',
    { status: 'DRAFT' },
    token,
  );
  const reloaded = await request<any>(
    `/admin/skill-content/speaking/${draft.id}`,
    'GET',
    undefined,
    token,
  );
  const persisted = reloaded.exercises.find(
    (item: any) => item.id === exercise.id,
  );
  if (
    persisted?.category !== 'ACADEMIC' ||
    persisted?.difficulty !== 'ADVANCED'
  )
    throw new Error('Reload lost child override');

  const list = await request<any[]>(
    '/admin/skill-content/speaking',
    'GET',
    undefined,
    token,
  );
  if (
    !list.some(
      (item) => item.id === draft.id && item.publicationStatus === 'DRAFT',
    )
  )
    throw new Error('Draft missing from admin list');
  console.log(
    JSON.stringify(
      { prefix, speakingApiWorkflow: true, exerciseId: exercise.id },
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
