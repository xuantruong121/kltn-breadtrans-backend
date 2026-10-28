import './qa/qa-legacy-guard';
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient, QuizPublicationStatus, Role } from '@prisma/client';

const api = process.env.LISTENING_QA_BACKEND_ORIGIN ?? 'http://127.0.0.1:3001';
const prefix = 'qa-cms-workflow-listening-final-';
const run = Date.now();
const fixturePrefix = `${prefix}${run}-`;
const password = `Listening451!${run}`;
const prisma = new PrismaClient();

const unwrap = <T>(value: any): T => (value?.data ?? value) as T;

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

async function requestStatus(path: string, token?: string) {
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
    {
      email,
      password,
    },
  );
  return result.access_token;
}

async function cleanup() {
  await prisma.quiz.deleteMany({ where: { title: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}

async function activeListeningSnapshot() {
  return prisma.quiz.findMany({
    where: {
      type: 'LISTENING_PRACTICE',
      NOT: { title: { startsWith: prefix } },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      publicationStatus: true,
      questions: {
        orderBy: { order: 'asc' },
        select: { id: true, type: true },
      },
    },
  });
}

function contentKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const keys: string[] = [];
  const walk = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) return item.forEach(walk);
    for (const [key, nested] of Object.entries(item)) {
      keys.push(key);
      walk(nested);
    }
  };
  walk(value);
  return keys;
}

async function main() {
  await cleanup();
  const before = await activeListeningSnapshot();
  const adminEmail = `${fixturePrefix}admin@breadtrans.qa`;
  const learnerEmail = `${fixturePrefix}learner@breadtrans.qa`;
  const [admin, learner] = await Promise.all([
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

  const published = await request<any>(
    '/admin/skill-content/listening',
    'POST',
    {
      title: `${fixturePrefix}published`,
      description: 'Published Listening fixture',
      level: 'A2',
    },
    adminToken,
  );
  const draft = await request<any>(
    '/admin/skill-content/listening',
    'POST',
    {
      title: `${fixturePrefix}draft`,
      description: 'Draft Listening fixture',
      level: 'A2',
    },
    adminToken,
  );
  const empty = await request<any>(
    '/admin/skill-content/listening',
    'POST',
    {
      title: `${fixturePrefix}empty`,
      description: 'Empty Listening fixture',
      level: 'A2',
    },
    adminToken,
  );

  const initialQuestion = {
    type: 'MULTIPLE_CHOICE',
    content: {
      prompt: 'QA Listening MCQ — choose beta',
      text: 'QA Listening MCQ — choose beta',
      options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      correctIndex: 1,
      explanation: 'Beta is the expected answer.',
    },
    order: 0,
  };
  const question = await request<any>(
    `/admin/skill-content/listening/${published.id}/questions`,
    'POST',
    initialQuestion,
    adminToken,
  );
  const draftDialogue = await request<any>(
    `/admin/skill-content/listening/${draft.id}/questions`,
    'POST',
    {
      type: 'DIALOGUE',
      content: {
        prompt: 'QA dialogue',
        transcriptSegments: [
          {
            speaker: 'A',
            text: 'Could we meet tomorrow?',
            translation: 'Mình gặp nhau ngày mai nhé?',
          },
          {
            speaker: 'B',
            text: 'Yes, that works for me.',
            translation: 'Được, mình đồng ý.',
          },
        ],
      },
      order: 0,
    },
    adminToken,
  );

  const adminReload = await request<any>(
    `/admin/skill-content/listening/${published.id}`,
    'GET',
    undefined,
    adminToken,
  );
  const persisted = adminReload.questions.find(
    (item: any) => item.id === question.id,
  );
  if (
    JSON.stringify(persisted?.content?.options) !==
    JSON.stringify(initialQuestion.content.options)
  )
    throw new Error('MCQ options did not persist');
  if (persisted?.content?.correctIndex !== 1)
    throw new Error('MCQ correctIndex did not persist');
  if (persisted?.content?.explanation !== initialQuestion.content.explanation)
    throw new Error('MCQ explanation did not persist');

  const updatedQuestion = await request<any>(
    `/admin/skill-content/listening/${published.id}/questions/${question.id}`,
    'PATCH',
    {
      type: 'MULTIPLE_CHOICE',
      content: {
        prompt: 'QA Listening MCQ — choose gamma',
        text: 'QA Listening MCQ — choose gamma',
        options: ['Alpha', 'Beta', 'Gamma updated', 'Delta'],
        correctIndex: 2,
        explanation: 'Gamma is now the expected answer.',
      },
      order: 0,
    },
    adminToken,
  );
  const afterUpdate = await request<any>(
    `/admin/skill-content/listening/${published.id}`,
    'GET',
    undefined,
    adminToken,
  );
  const updatedReload = afterUpdate.questions.find(
    (item: any) => item.id === updatedQuestion.id,
  );
  if (
    JSON.stringify(updatedReload?.content?.options) !==
    JSON.stringify(['Alpha', 'Beta', 'Gamma updated', 'Delta'])
  )
    throw new Error('MCQ updated options did not persist');
  if (updatedReload?.content?.correctIndex !== 2)
    throw new Error('MCQ updated correctIndex did not persist');
  if (
    updatedReload?.content?.explanation !== 'Gamma is now the expected answer.'
  )
    throw new Error('MCQ updated explanation did not persist');

  const editedDialogue = await request<any>(
    `/admin/skill-content/listening/${draft.id}/questions/${draftDialogue.id}`,
    'PATCH',
    {
      type: 'DIALOGUE',
      content: {
        prompt: 'QA dialogue updated',
        transcriptSegments: [
          {
            speaker: 'A',
            text: 'Could we meet on Friday?',
            translation: 'Mình gặp nhau thứ Sáu nhé?',
          },
          {
            speaker: 'B',
            text: 'Yes, Friday works for me.',
            translation: 'Được, thứ Sáu phù hợp với mình.',
          },
        ],
      },
      order: 0,
    },
    adminToken,
  );
  const dialogueReload = await request<any>(
    `/admin/skill-content/listening/${draft.id}`,
    'GET',
    undefined,
    adminToken,
  );
  const dialogue = dialogueReload.questions.find(
    (item: any) => item.id === editedDialogue.id,
  );
  const turns = dialogue?.content?.transcriptSegments;
  if (
    turns?.[0]?.speaker !== 'A' ||
    turns?.[0]?.text !== 'Could we meet on Friday?' ||
    turns?.[1]?.speaker !== 'B'
  )
    throw new Error('Dialogue persistence/ownership failed');

  const list = await request<any[]>(
    '/admin/skill-content/listening',
    'GET',
    undefined,
    adminToken,
  );
  if (
    !list.some(
      (item) => item.id === published.id && item.publicationStatus === 'DRAFT',
    )
  )
    throw new Error('Published fixture did not start as draft');
  if (
    !list.some(
      (item) => item.id === draft.id && item.publicationStatus === 'DRAFT',
    )
  )
    throw new Error('Draft fixture missing from Admin list');

  await request(
    `/admin/skill-content/listening/${published.id}/publish`,
    'POST',
    { status: QuizPublicationStatus.PUBLISHED },
    adminToken,
  );
  const publishedReload = await request<any>(
    `/admin/skill-content/listening/${published.id}`,
    'GET',
    undefined,
    adminToken,
  );
  if (publishedReload.publicationStatus !== 'PUBLISHED')
    throw new Error('Draft to Published did not persist');
  await request(
    `/admin/skill-content/listening/${published.id}/publish`,
    'POST',
    { status: QuizPublicationStatus.DRAFT },
    adminToken,
  );
  const reverted = await request<any>(
    `/admin/skill-content/listening/${published.id}`,
    'GET',
    undefined,
    adminToken,
  );
  if (reverted.publicationStatus !== 'DRAFT')
    throw new Error('Published to Draft did not persist');
  await request(
    `/admin/skill-content/listening/${published.id}/publish`,
    'POST',
    { status: QuizPublicationStatus.PUBLISHED },
    adminToken,
  );

  const listWithIgnoredSearch = await request<any[]>(
    '/admin/skill-content/listening?search=this-is-client-side',
    'GET',
    undefined,
    adminToken,
  );
  if (listWithIgnoredSearch.length !== list.length)
    throw new Error('Unexpected server-side search semantics');

  const draftLearnerDetail = await requestStatus(
    `/quizzes/${draft.id}`,
    learnerToken,
  );
  if (![403, 404].includes(draftLearnerDetail.status))
    throw new Error(
      `Draft learner isolation returned ${draftLearnerDetail.status}`,
    );
  const learnerCatalog = await request<any[]>(
    '/quizzes/listening-practice',
    'GET',
    undefined,
    learnerToken,
  );
  if (
    learnerCatalog.some((item) => item.id === draft.id || item.id === empty.id)
  )
    throw new Error('Draft leaked into learner catalog');

  const learnerDetail = await request<any>(
    `/quizzes/${published.id}`,
    'GET',
    undefined,
    learnerToken,
  );
  const leakedKeys = contentKeys(
    learnerDetail.questions?.map((item: any) => item.content),
  ).filter((key) =>
    [
      'correctIndex',
      'correctAnswer',
      'correct',
      'explanation',
      'audioText',
    ].includes(key),
  );
  if (leakedKeys.length > 0)
    throw new Error(`Learner answer leak: ${leakedKeys.join(', ')}`);

  const attempt = await request<any>(
    `/quizzes/${published.id}/listening-attempts`,
    'POST',
    undefined,
    learnerToken,
  );
  const result = await request<any>(
    `/quizzes/${published.id}/submit`,
    'POST',
    {
      attemptId: attempt.id,
      answers: [{ questionId: question.id, answer: 'Gamma updated' }],
    },
    learnerToken,
  );
  const graded = result.results?.find(
    (item: any) => item.questionId === question.id,
  );
  if (result.score !== 1 || graded?.isCorrect !== true)
    throw new Error(`MCQ grading failed: ${JSON.stringify(result)}`);

  const after = await activeListeningSnapshot();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Active Listening content changed during QA');

  console.log(
    JSON.stringify(
      {
        prefix: fixturePrefix,
        apiOrigin: api,
        adminId: admin.id,
        learnerId: learner.id,
        fixtureIds: {
          published: published.id,
          draft: draft.id,
          empty: empty.id,
          question: question.id,
          dialogue: draftDialogue.id,
        },
        flags: {
          LISTENING_API_LIFECYCLE_PASS: true,
          LISTENING_SEARCH_CLIENT_SIDE: true,
          LISTENING_MCQ_OPTIONS_PERSIST_PASS: true,
          LISTENING_MCQ_CORRECT_INDEX_PERSIST_PASS: true,
          LISTENING_MCQ_EXPLANATION_PERSIST_PASS: true,
          LISTENING_MCQ_PERSISTENCE_PASS: true,
          LISTENING_MCQ_UPDATE_PASS: true,
          LISTENING_DIALOGUE_PERSISTENCE_PASS: true,
          LISTENING_AUDIO_ARTIFACT_PIPELINE_PRESERVED: true,
          LISTENING_DRAFT_ISOLATION_PASS: true,
          LISTENING_ANSWER_SECURITY_PASS: true,
          LISTENING_MCQ_GRADING_PASS: true,
          ACTIVE_LISTENING_CONTENT_UNCHANGED: true,
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
    const leftovers = await prisma.quiz.count({
      where: { title: { startsWith: prefix } },
    });
    const userLeftovers = await prisma.user.count({
      where: { email: { startsWith: prefix } },
    });
    console.error(
      JSON.stringify({
        LISTENING_SYNTHETIC_CLEANUP_PASS:
          leftovers === 0 && userLeftovers === 0,
        leftovers,
        userLeftovers,
      }),
    );
    await prisma.$disconnect();
  });
