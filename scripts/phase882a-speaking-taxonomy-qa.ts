import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';

const api = 'http://127.0.0.1:3001';
const prefix = `qa-taxonomy-${Date.now()}`;
const code = `QA_TAXONOMY_${Date.now()}`;
const password = `Taxonomy!${randomUUID()}`;
const prisma = new PrismaClient();

const unwrap = <T>(value: any) => (value?.data ?? value) as T;

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
  return {
    status: response.status,
    data: text ? unwrap<T>(JSON.parse(text)) : null,
  };
}

async function expectStatus<T>(
  path: string,
  expected: number,
  method = 'GET',
  body?: unknown,
  token?: string,
) {
  const result = await request<T>(path, method, body, token);
  if (result.status !== expected) {
    throw new Error(
      `${method} ${path} expected ${expected}, got ${result.status}: ${JSON.stringify(result.data)}`,
    );
  }
  return result.data as T;
}

async function cleanup() {
  await prisma.speakingExercise.deleteMany({
    where: { title: { startsWith: prefix } },
  });
  await prisma.speakingPracticeSet.deleteMany({
    where: { title: { startsWith: prefix } },
  });
  await prisma.speakingCategory.deleteMany({
    where: { code: { startsWith: code } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}

async function main() {
  await cleanup();
  const admin = await prisma.user.create({
    data: {
      email: `${prefix}-admin@breadtrans.qa`,
      password: await bcrypt.hash(password, 10),
      role: Role.ADMIN,
    },
  });
  const login = await expectStatus<{ access_token: string }>(
    '/auth/login',
    200,
    'POST',
    { email: admin.email, password },
  );
  const token = login.access_token;

  const seeded = await expectStatus<any[]>(
    '/admin/skill-content/speaking/categories?scope=practiceSet',
    200,
    'GET',
    undefined,
    token,
  );
  if (!seeded.some((category) => category.code === 'GENERAL')) {
    throw new Error('Seeded GENERAL taxonomy is missing');
  }

  const created = await expectStatus<any>(
    '/admin/skill-content/speaking/categories',
    201,
    'POST',
    {
      code,
      name: 'QA Taxonomy',
      description: 'Synthetic taxonomy fixture',
      allowPracticeSet: true,
      allowExercise: true,
    },
    token,
  );
  const categoryId = created.id as number;
  await expectStatus(
    '/admin/skill-content/speaking/categories',
    409,
    'POST',
    { code, name: 'QA Taxonomy Duplicate' },
    token,
  );
  await expectStatus(
    `/admin/skill-content/speaking/categories/${categoryId}/deactivate`,
    201,
    'POST',
    undefined,
    token,
  );
  const activeCategories = await expectStatus<any[]>(
    '/admin/skill-content/speaking/categories?scope=practiceSet',
    200,
    'GET',
    undefined,
    token,
  );
  if (activeCategories.some((category) => category.code === code)) {
    throw new Error('Inactive taxonomy remained in active authoring scope');
  }
  await expectStatus(
    `/admin/skill-content/speaking/categories/${categoryId}/activate`,
    201,
    'POST',
    undefined,
    token,
  );

  const set = await expectStatus<any>(
    '/admin/skill-content/speaking',
    201,
    'POST',
    {
      title: `${prefix}-set`,
      description: 'Synthetic taxonomy parent',
      category: code,
      level: 'A1-B1',
    },
    token,
  );
  const exercise = await expectStatus<any>(
    `/admin/skill-content/speaking/${set.id}/exercises`,
    201,
    'POST',
    {
      title: `${prefix}-exercise`,
      targetText: 'I practise English every day.',
      category: code,
      difficulty: 'BEGINNER',
    },
    token,
  );
  if (set.categoryId !== categoryId || exercise.categoryId !== categoryId) {
    throw new Error('Taxonomy foreign keys were not persisted on parent/child');
  }
  await expectStatus(
    `/admin/skill-content/speaking/categories/${categoryId}`,
    409,
    'DELETE',
    undefined,
    token,
  );

  const unused = await expectStatus<any>(
    '/admin/skill-content/speaking/categories',
    201,
    'POST',
    { name: `${prefix}-unused`, code: `${code}_UNUSED` },
    token,
  );
  await expectStatus(
    `/admin/skill-content/speaking/categories/${unused.id}`,
    200,
    'DELETE',
    undefined,
    token,
  );

  console.log(
    JSON.stringify(
      {
        prefix,
        flags: {
          SPEAKING_TAXONOMY_SEED_PASS: true,
          SPEAKING_TAXONOMY_CRUD_PASS: true,
          SPEAKING_TAXONOMY_DUPLICATE_GUARD_PASS: true,
          SPEAKING_TAXONOMY_INACTIVE_SCOPE_PASS: true,
          SPEAKING_TAXONOMY_PARENT_CHILD_FK_PASS: true,
          SPEAKING_TAXONOMY_DELETE_SAFETY_PASS: true,
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
