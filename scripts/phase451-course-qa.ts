import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';

const api = 'http://127.0.0.1:3001';
const prefix = `qa-cms-workflow-course-final-${Date.now()}-${randomUUID().slice(0, 8)}`;
const password = `Phase451!${randomUUID()}`;
const prisma = new PrismaClient();

const unwrap = <T>(value: unknown) =>
  ((value as { data?: T } | null)?.data ?? value) as T;

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
  await prisma.course.deleteMany({ where: { title: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}

async function main() {
  await cleanup();
  const protectedBefore = await prisma.course.findMany({
    where: { id: { in: [1, 8, 12] } },
    select: { id: true, title: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });
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

  const course = await request<any>(
    '/admin/courses',
    'POST',
    {
      title: `${prefix}-course`,
      description: 'Synthetic Course workflow fixture',
      level: 'BEGINNER',
    },
    token,
  );
  if (course.status !== 'DRAFT') throw new Error('New Course is not DRAFT');
  const listAfterCreate = await request<any[]>(
    '/admin/courses',
    'GET',
    undefined,
    token,
  );
  if (
    !listAfterCreate.some(
      (item) => item.id === course.id && item.status === 'DRAFT',
    )
  )
    throw new Error('Draft Course missing from Admin list');

  const lessonA = await request<any>(
    `/admin/courses/${course.id}/studio/lessons`,
    'POST',
    {
      title: `${prefix}-lesson-a`,
      slug: `${prefix}-lesson-a`,
      summary: 'Lesson A summary',
      learningObjectives: ['Understand the Course fixture'],
    },
    token,
  );
  const lessonB = await request<any>(
    `/admin/courses/${course.id}/studio/lessons`,
    'POST',
    {
      title: `${prefix}-lesson-b`,
      slug: `${prefix}-lesson-b`,
      summary: 'Lesson B summary',
      learningObjectives: ['Verify lesson ordering'],
    },
    token,
  );
  let studio = await request<any>(
    `/admin/courses/${course.id}/studio`,
    'GET',
    undefined,
    token,
  );
  if (
    studio.lessons.length !== 2 ||
    studio.lessons[0].id !== lessonA.id ||
    studio.lessons[1].id !== lessonB.id ||
    studio.lessons.some((lesson: any) => lesson.status !== 'DRAFT')
  )
    throw new Error('Lesson creation or default ordering failed');
  await request(
    `/admin/courses/${course.id}/studio/lessons/reorder`,
    'PATCH',
    { ids: [lessonB.id, lessonA.id] },
    token,
  );
  studio = await request<any>(
    `/admin/courses/${course.id}/studio`,
    'GET',
    undefined,
    token,
  );
  if (
    studio.lessons[0].id !== lessonB.id ||
    studio.lessons[1].id !== lessonA.id
  )
    throw new Error('Lesson reorder did not persist');

  const section = await request<any>(
    `/admin/courses/${course.id}/studio/lessons/${lessonA.id}/sections`,
    'POST',
    {
      type: 'THEORY',
      heading: 'Initial fixture section',
      content: { text: 'Initial section content' },
      isRequired: true,
    },
    token,
  );
  await request(
    `/admin/courses/${course.id}/studio/lessons/${lessonA.id}/sections/${section.id}`,
    'PATCH',
    {
      heading: 'Updated fixture section',
      content: { text: 'Updated section content' },
    },
    token,
  );
  await request(
    `/admin/courses/${course.id}/studio/lessons/${lessonB.id}/sections`,
    'POST',
    {
      type: 'INTRO',
      heading: 'Lesson B required section',
      content: { text: 'Required content for Course publication validation' },
      isRequired: true,
    },
    token,
  );

  const createExercise = (slug: string, title: string, order: number) =>
    request<any>(
      `/admin/courses/${course.id}/studio/lessons/${lessonA.id}/exercises`,
      'POST',
      {
        slug,
        type: 'MULTIPLE_CHOICE',
        title,
        prompt: `Prompt for ${title}`,
        content: {},
        required: true,
        order,
      },
      token,
    );
  const guided = await createExercise(
    'guided-practice',
    'Guided Practice fixture',
    0,
  );
  const finalCheck = await createExercise(
    'final-check',
    'Final Check fixture',
    1,
  );

  const createQuestion = (exerciseId: number, prompt: string) =>
    request<any>(
      `/admin/courses/${course.id}/studio/lessons/${lessonA.id}/exercises/${exerciseId}/questions`,
      'POST',
      {
        prompt,
        options: ['Correct choice', 'Incorrect choice'],
        correctAnswer: 'Correct choice',
        explanation: `Explanation for ${prompt}`,
      },
      token,
    );
  const guidedQuestion = await createQuestion(
    guided.id,
    'Guided question fixture',
  );
  const finalQuestion = await createQuestion(
    finalCheck.id,
    'Final question fixture',
  );

  studio = await request<any>(
    `/admin/courses/${course.id}/studio`,
    'GET',
    undefined,
    token,
  );
  const persistedLesson = studio.lessons.find(
    (lesson: any) => lesson.id === lessonA.id,
  );
  const persistedSection = persistedLesson?.sections.find(
    (item: any) => item.id === section.id,
  );
  const persistedGuided = persistedLesson?.exercises.find(
    (item: any) => item.id === guided.id,
  );
  const persistedFinal = persistedLesson?.exercises.find(
    (item: any) => item.id === finalCheck.id,
  );
  if (
    persistedSection?.heading !== 'Updated fixture section' ||
    persistedSection?.content?.text !== 'Updated section content' ||
    persistedGuided?.slug !== 'guided-practice' ||
    persistedFinal?.slug !== 'final-check' ||
    persistedGuided?.questions?.[0]?.id !== guidedQuestion.id ||
    persistedFinal?.questions?.[0]?.id !== finalQuestion.id ||
    persistedGuided?.questions?.[0]?.correctAnswer !== 'Correct choice' ||
    persistedFinal?.questions?.[0]?.explanation !==
      'Explanation for Final question fixture'
  )
    throw new Error('Nested Course ownership or question persistence failed');

  const publishedLesson = await request<any>(
    `/admin/courses/${course.id}/studio/lessons/${lessonA.id}/publish`,
    'POST',
    undefined,
    token,
  );
  if (publishedLesson.status !== 'PUBLISHED')
    throw new Error('Lesson publish failed');
  const publishedCourse = await request<any>(
    `/admin/courses/${course.id}/studio/publish`,
    'POST',
    undefined,
    token,
  );
  if (publishedCourse.status !== 'PUBLISHED')
    throw new Error('Course publish failed');
  const draftCourse = await request<any>(
    `/admin/courses/${course.id}/update`,
    'POST',
    { status: 'DRAFT' },
    token,
  );
  const draftLesson = await request<any>(
    `/admin/courses/${course.id}/studio/lessons/${lessonA.id}`,
    'PATCH',
    { status: 'DRAFT' },
    token,
  );
  if (draftCourse.status !== 'DRAFT' || draftLesson.status !== 'DRAFT')
    throw new Error('Draft transition did not persist');

  const protectedAfter = await prisma.course.findMany({
    where: { id: { in: [1, 8, 12] } },
    select: { id: true, title: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });
  if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter))
    throw new Error('Protected Courses 1, 8, or 12 changed during QA');
  console.log(
    JSON.stringify(
      {
        prefix,
        courseId: course.id,
        lessonIds: { lessonA: lessonA.id, lessonB: lessonB.id },
        sectionId: section.id,
        exerciseIds: { guided: guided.id, finalCheck: finalCheck.id },
        questionIds: {
          guided: guidedQuestion.id,
          finalCheck: finalQuestion.id,
        },
        courseApiWorkflow: true,
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
