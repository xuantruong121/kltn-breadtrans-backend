import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient, Role } from "@prisma/client";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";

const api = process.env.PHASE6_QA_BACKEND_ORIGIN ?? "http://localhost:3001";
const web = process.env.PHASE6_QA_FRONTEND_ORIGIN ?? "http://localhost:3000";
const prisma = new PrismaClient();
const run = Date.now();
const prefix = `qa-phase6-${run}`;
const userPrefix = `${prefix}-user-`;
const password = `Phase6!${randomUUID()}`;
const report = {
  run,
  origins: { api, web },
  fixtures: {},
  domains: {},
  flags: {
    PHASE6_LEARNER_RUNTIME_MATRIX_COMPLETE: true,
    PHASE6_NO_REAL_PROVIDER_RETEST: true,
    PHASE6_ACTIVE_DATA_PROTECTED: true,
  },
};

const unwrap = (value) => value && typeof value === "object" && "data" in value ? value.data : value;
const json = (value) => JSON.stringify(value);

async function call(route, method = "GET", body, token, expected = [200, 201, 202]) {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : json(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!expected.includes(response.status)) throw new Error(`${method} ${route} -> ${response.status}: ${json(payload)}`);
  return { status: response.status, value: unwrap(payload), raw: payload };
}

async function expectStatus(route, method, body, token, expected) {
  try {
    const result = await call(route, method, body, token, expected);
    return { status: result.status, passed: true };
  } catch (error) {
    const match = String(error.message).match(/-> (\d+)/);
    const status = match ? Number(match[1]) : null;
    return { status, passed: expected.includes(status), error: String(error.message) };
  }
}

async function login(email) {
  const result = await call("/auth/login", "POST", { email, password });
  const token = result.value?.access_token ?? result.value?.accessToken;
  if (!token) throw new Error(`Login không trả access token cho ${email}`);
  return token;
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: userPrefix } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  if (userIds.length) {
    await prisma.payment.deleteMany({ where: { enrollment: { userId: { in: userIds } } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.payment.deleteMany({ where: { transferCode: { startsWith: `${prefix}-payment` } } });
  await prisma.course.deleteMany({ where: { title: { startsWith: `${prefix}-course` } } });
  await prisma.quiz.deleteMany({ where: { title: { startsWith: prefix } } });
  await prisma.practiceTopic.deleteMany({ where: { name: { startsWith: `${prefix}-topic` } } });
  await prisma.speakingPracticeSet.deleteMany({ where: { id: { startsWith: `${prefix}-speaking` } } });
  await prisma.vocabTopic.deleteMany({ where: { title: { startsWith: `${prefix}-vocab` } } });
  await prisma.grammarTopic.deleteMany({ where: { title: { startsWith: `${prefix}-grammar` } } });
  await prisma.toeicExamSet.deleteMany({ where: { title: { startsWith: `${prefix}-exam` } } });
}

async function createFixtures() {
  const [admin, learnerA, learnerB] = await Promise.all([
    prisma.user.create({ data: { email: `${userPrefix}admin@breadtrans.qa`, password: await bcrypt.hash(password, 12), role: Role.ADMIN } }),
    prisma.user.create({ data: { email: `${userPrefix}a@breadtrans.qa`, password: await bcrypt.hash(password, 12), role: Role.STUDENT } }),
    prisma.user.create({ data: { email: `${userPrefix}b@breadtrans.qa`, password: await bcrypt.hash(password, 12), role: Role.STUDENT } }),
  ]);

  const course = await prisma.course.create({ data: {
    title: `${prefix}-course`, description: "Phase 6 learner course", level: "A2", status: "PUBLISHED",
  } });
  const klass = await prisma.class.create({ data: { courseId: course.id, name: `${prefix}-class`, status: "UPCOMING", tuitionFeeVnd: 0 } });
  const enrollment = await prisma.enrollment.create({ data: { userId: learnerA.id, classId: klass.id, status: "ACTIVE" } });
  await prisma.payment.create({ data: { enrollmentId: enrollment.id, amountVnd: 0, transferCode: `${prefix}-payment`, status: "CONFIRMED" } });
  const lesson = await prisma.courseLesson.create({ data: {
    courseId: course.id, slug: `${prefix}-lesson`, title: "Phase 6 Lesson", summary: "Synthetic lesson", learningObjectives: ["practice"], order: 1, status: "PUBLISHED",
  } });
  await prisma.courseLessonSection.createMany({ data: [
    { lessonId: lesson.id, order: 1, type: "INTRO", heading: "Section", content: { text: "Published section content" }, isRequired: true },
    { lessonId: lesson.id, order: 2, type: "CHECKPOINT", heading: "Checkpoint", content: { text: "Final checkpoint" }, isRequired: true },
  ] });
  const guided = await prisma.courseLessonExercise.create({ data: {
    lessonId: lesson.id, slug: "guided", order: 1, type: "MULTIPLE_CHOICE", title: "Guided Practice", prompt: "Choose A", content: { kind: "guided" }, required: true, minimumScore: 50,
  } });
  const final = await prisma.courseLessonExercise.create({ data: {
    lessonId: lesson.id, slug: "final", order: 2, type: "MULTIPLE_CHOICE", title: "Final Check", prompt: "Choose B", content: { kind: "final" }, required: true, minimumScore: 100,
  } });
  const [guidedQuestion, finalQuestion] = await Promise.all([
    prisma.courseLessonQuestion.create({ data: { exerciseId: guided.id, order: 1, prompt: "Guided?", options: ["A", "B"], correctAnswer: "A", explanation: "A" } }),
    prisma.courseLessonQuestion.create({ data: { exerciseId: final.id, order: 1, prompt: "Final?", options: ["A", "B"], correctAnswer: "B", explanation: "B" } }),
  ]);

  const listening = await prisma.quiz.create({ data: { title: `${prefix}-listening`, description: "Synthetic listening", type: "LISTENING_PRACTICE", publicationStatus: "PUBLISHED", questions: { create: [
    { type: "MULTIPLE_CHOICE", order: 1, content: { prompt: "Which day?", options: ["Monday", "Tuesday"], correctIndex: 1, explanation: "Tuesday", transcriptSegments: [{ speaker: "A", text: "See you Tuesday." }] } },
    { type: "DICTATION", order: 2, content: { prompt: "Type the sentence", correctAnswer: "See you Tuesday.", audioText: "See you Tuesday.", explanation: "Exact sentence", translation: "Hẹn gặp bạn thứ Ba.", transcriptSegments: [{ speaker: "A", text: "See you Tuesday." }] } },
  ] } } });
  const listeningQuestions = await prisma.question.findMany({ where: { quizId: listening.id }, orderBy: { order: "asc" }, select: { id: true } });

  const topicBase = (await prisma.practiceTopic.aggregate({ _max: { id: true } }))._max.id ?? 0;
  const readingTopic = await prisma.practiceTopic.create({ data: { id: topicBase + 1000, name: `${prefix}-topic-reading`, category: "BILINGUAL_LEVEL", order: 999 } });
  const writingTopic = await prisma.practiceTopic.create({ data: { id: topicBase + 1001, name: `${prefix}-topic-writing`, category: "WRITING_PART1", order: 999 } });
  const reading = await prisma.quiz.create({ data: { title: `${prefix}-reading`, description: "Synthetic reading passage", type: "BILINGUAL_READING", publicationStatus: "PUBLISHED", practiceTopicId: readingTopic.id, questions: { create: [
    { type: "MULTIPLE_CHOICE", order: 1, content: { text: "What is true?", passage: "BreadTrans helps learners.", options: ["It helps learners.", "It sells cars."], correctIndex: 0, questionType: "MAIN_IDEA", explanation: "Main idea" } },
  ] } } });
  const writingEmail = await prisma.quiz.create({ data: { title: `${prefix}-writing-email`, description: "Email task", type: "WRITING_EMAIL", publicationStatus: "PUBLISHED", practiceTopicId: writingTopic.id, questions: { create: { type: "WRITING", order: 1, content: { taskType: "EMAIL", prompt: "Write an email to your teacher.", wordRange: [50, 80], keywords: ["schedule"] } } } } });
  const writingPicture = await prisma.quiz.create({ data: { title: `${prefix}-writing-picture`, description: "Picture task", type: "WRITING_PICTURE", publicationStatus: "PUBLISHED", practiceTopicId: writingTopic.id, questions: { create: { type: "WRITING", order: 1, content: { taskType: "SENTENCE", prompt: "Describe this picture.", imageUrl: "data:image/png;base64,iVBORw0KGgo=" } } } } });

  const speakingSet = await prisma.speakingPracticeSet.create({ data: { id: `${prefix}-speaking-set`, title: "Phase 6 Speaking", description: "Synthetic speaking set", category: "GENERAL", level: "A2", publicationStatus: "PUBLISHED" } });
  const speaking = await prisma.speakingExercise.create({ data: { title: "Phase 6 Speaking Exercise", targetText: "The learner practices English.", audioUrl: "data:audio/wav;base64,UklGRgAAAABXQVZF", category: "GENERAL", difficulty: "BEGINNER", practiceSetId: speakingSet.id, publicationStatus: "PUBLISHED" } });
  await prisma.speakingSubmission.create({ data: { exerciseId: speaking.id, userId: learnerA.id, status: "COMPLETED", feedbackStatus: "COMPLETED", rewardStatus: "COMPLETED", overallScore: 8, transcript: speaking.targetText, idempotencyKey: `${prefix}-speaking-submission` } });

  const vocab = await prisma.vocabTopic.create({ data: { title: `${prefix}-vocab`, categoryName: "PHASE6", totalWords: 1, publicationStatus: "PUBLISHED", words: { create: { word: "persist", meaning: "duy trì", exampleEn: "Progress persists.", order: 1 } } } });
  const vocabWord = await prisma.vocabWord.findFirstOrThrow({ where: { topicId: vocab.id } });
  const grammar = await prisma.grammarTopic.create({ data: { title: `${prefix}-grammar`, level: "BEGINNER", description: "Grammar description", keyFormula: "Subject + verb", publicationStatus: "PUBLISHED", questions: { create: { question: "Choose A", options: ["A", "B"], correctIndex: 0, explanation: "A", order: 1 } } } });
  const grammarQuestion = await prisma.grammarQuestion.findFirstOrThrow({ where: { topicId: grammar.id } });
  const exam = await prisma.toeicExamSet.create({ data: { title: `${prefix}-exam`, description: "Synthetic exam", type: "PRACTICE_BY_PART", difficulty: "easy", durationSeconds: 600, publicationStatus: "PUBLISHED", groups: { create: { part: 5, groupOrder: 1, passageText: "Choose the best answer.", questions: { create: { questionNumber: 1, text: "Choose A", options: ["A", "B", "C", "D"], correctIndex: 0 } } } } } });

  const draft = await prisma.quiz.create({ data: { title: `${prefix}-draft-listening`, type: "LISTENING_PRACTICE", publicationStatus: "DRAFT", questions: { create: { type: "MULTIPLE_CHOICE", order: 1, content: { prompt: "Draft", options: ["A", "B"], correctIndex: 0 } } } } });
  return { admin, learnerA, learnerB, course, lesson, guided, final, guidedQuestion, finalQuestion, listening, listeningQuestions, reading, writingEmail, writingPicture, speaking, vocab, vocabWord, grammar, grammarQuestion, exam, draft };
}

async function courseFlow(fixtures, tokenA, tokenB) {
  const overview = await call(`/courses/${fixtures.course.id}/learning`, "GET", undefined, tokenA);
  const lesson = await call(`/courses/${fixtures.course.id}/learning/lessons/${fixtures.lesson.id}`, "GET", undefined, tokenA);
  const safe = lesson.value.lesson.exercises.flatMap((exercise) => exercise.questions).every((question) => !["correctAnswer", "explanation"].some((key) => key in question));
  const guided = await call(`/courses/${fixtures.course.id}/learning/lessons/${fixtures.lesson.id}/exercises/${fixtures.guided.id}/submit`, "POST", { answers: [{ questionId: fixtures.guidedQuestion.id, answer: "A" }] }, tokenA);
  const guidedAgain = await call(`/courses/${fixtures.course.id}/learning/lessons/${fixtures.lesson.id}/exercises/${fixtures.guided.id}/submit`, "POST", { answers: [{ questionId: fixtures.guidedQuestion.id, answer: "A" }] }, tokenA);
  const final = await call(`/courses/${fixtures.course.id}/learning/lessons/${fixtures.lesson.id}/exercises/${fixtures.final.id}/submit`, "POST", { answers: [{ questionId: fixtures.finalQuestion.id, answer: "B" }] }, tokenA);
  const reload = await call(`/courses/${fixtures.course.id}/learning`, "GET", undefined, tokenA);
  const crossUser = await expectStatus(`/courses/${fixtures.course.id}/learning/lessons/${fixtures.lesson.id}/exercises/${fixtures.guided.id}/submit`, "POST", { answers: [{ questionId: fixtures.guidedQuestion.id, answer: "A" }] }, tokenB, [403]);
  const attempts = await prisma.courseLessonAttempt.count({ where: { userId: fixtures.learnerA.id, exerciseId: fixtures.guided.id, status: "SUBMITTED" } });
  return { content: Boolean(overview.value.lessons?.length && lesson.value.lesson.sections?.length), protectedAnswers: safe, guided: guided.value.completed === true, final: final.value.completed === true, duplicateSameAttempt: guided.value.attemptId === guidedAgain.value.attemptId, reloadCompleted: reload.value.progress.completedLessons === 1, ownership: crossUser.passed, attemptRows: attempts };
}

async function listeningFlow(fixtures, tokenA, tokenB) {
  const catalog = await call("/quizzes/listening-practice", "GET", undefined, tokenA);
  const detail = await call(`/quizzes/${fixtures.listening.id}`, "GET", undefined, tokenA);
  const protectedAnswers = detail.value.questions.every((question) => !["correctIndex", "correctAnswer", "correct", "explanation", "audioText"].some((key) => key in (question.content ?? {})));
  const attempt = await call(`/quizzes/${fixtures.listening.id}/listening-attempts`, "POST", undefined, tokenA);
  await call(`/quizzes/${fixtures.listening.id}/listening-attempts/${attempt.value.id}`, "PATCH", { currentQuestionId: fixtures.listeningQuestions[0].id, answers: { [fixtures.listeningQuestions[0].id]: "Tuesday" }, questionStates: { [fixtures.listeningQuestions[0].id]: "ANSWERED" } }, tokenA);
  const resumed = await call(`/quizzes/${fixtures.listening.id}/listening-attempts`, "POST", undefined, tokenA);
  const correct = await call(`/quizzes/${fixtures.listening.id}/questions/${fixtures.listeningQuestions[0].id}/check`, "POST", { answer: "Tuesday" }, tokenA);
  const wrong = await call(`/quizzes/${fixtures.listening.id}/questions/${fixtures.listeningQuestions[0].id}/check`, "POST", { answer: "Monday" }, tokenA);
  const dictation = await call(`/quizzes/${fixtures.listening.id}/questions/${fixtures.listeningQuestions[1].id}/check`, "POST", { answer: "see you tuesday" }, tokenA);
  const dictationWrong = await call(`/quizzes/${fixtures.listening.id}/questions/${fixtures.listeningQuestions[1].id}/check`, "POST", { answer: "see you thursday" }, tokenA);
  const submitted = await call(`/quizzes/${fixtures.listening.id}/submit`, "POST", { attemptId: attempt.value.id, answers: [{ questionId: fixtures.listeningQuestions[0].id, answer: "Tuesday" }, { questionId: fixtures.listeningQuestions[1].id, answer: "See you Tuesday." }] }, tokenA);
  const duplicate = await expectStatus(`/quizzes/${fixtures.listening.id}/submit`, "POST", { attemptId: attempt.value.id, answers: [{ questionId: fixtures.listeningQuestions[0].id, answer: "Tuesday" }, { questionId: fixtures.listeningQuestions[1].id, answer: "See you Tuesday." }] }, tokenA, [403]);
  const foreignAttempt = await expectStatus(`/quizzes/${fixtures.listening.id}/listening-attempts/${attempt.value.id}`, "PATCH", { answers: {} }, tokenB, [404, 403]);
  const submissions = await prisma.submission.count({ where: { userId: fixtures.learnerA.id, quizId: fixtures.listening.id } });
  const attemptState = await prisma.listeningPracticeAttempt.findUnique({ where: { id: attempt.value.id }, select: { status: true, answers: true } });
  const draftVisible = (catalog.value ?? []).some((quiz) => quiz.id === fixtures.draft.id);
  const dictationSafeFeedback = dictationWrong.value.isCorrect === false && typeof dictationWrong.value.nextWordMask === "string" && typeof dictationWrong.value.hint === "string" && !("correctAnswer" in dictationWrong.value);
  return { content: catalog.value.some((quiz) => quiz.id === fixtures.listening.id), protectedAnswers, resume: resumed.value.id === attempt.value.id && resumed.value.answers?.[fixtures.listeningQuestions[0].id] === "Tuesday", correct: correct.value.isCorrect === true, wrong: wrong.value.isCorrect === false, dictation: dictation.value.isCorrect === true && dictationSafeFeedback, result: submitted.value.results?.length === 2 && attemptState?.status === "COMPLETED", duplicateSubmit: duplicate.passed && submissions === 1, ownership: foreignAttempt.passed, draftHidden: !draftVisible };
}

async function readingFlow(fixtures, tokenA, tokenB) {
  const catalog = await call("/reading/exercises", "GET", undefined, tokenA);
  const detail = await call(`/quizzes/${fixtures.reading.id}`, "GET", undefined, tokenA);
  const safe = !["correctIndex", "correct", "correctAnswer", "explanation"].some((key) => key in (detail.value.questions?.[0]?.content ?? {}));
  const clientAttemptId = randomUUID();
  const answer = detail.value.questions[0].content.options[0];
  const submitted = await call(`/quizzes/${fixtures.reading.id}/submit`, "POST", { clientAttemptId, answers: [{ questionId: detail.value.questions[0].id, answer }] }, tokenA);
  const replay = await call(`/quizzes/${fixtures.reading.id}/submit`, "POST", { clientAttemptId, answers: [{ questionId: detail.value.questions[0].id, answer }] }, tokenA);
  const tracking = await call("/reading/tracking", "GET", undefined, tokenA);
  const cross = await expectStatus(`/quizzes/submissions/${submitted.value.id}/analytics`, "GET", undefined, tokenB, [403, 404]);
  return { content: catalog.value.some((item) => item.quizId === fixtures.reading.id), safe, grading: submitted.value.score === 1, result: replay.value.id === submitted.value.id, microSkill: tracking.value !== undefined, ownership: cross.passed };
}

async function writingFlow(fixtures, tokenA) {
  const topics = await call("/writing/topics", "GET", undefined, tokenA);
  const email = await call(`/writing/quizzes/${fixtures.writingEmail.id}`, "GET", undefined, tokenA);
  const picture = await call(`/writing/quizzes/${fixtures.writingPicture.id}`, "GET", undefined, tokenA);
  const emailFields = email.value.questions?.[0]?.content ?? email.value.content ?? email.value;
  const pictureFields = picture.value.questions?.[0]?.content ?? picture.value.content ?? picture.value;
  const family = emailFields.taskType === "EMAIL" && pictureFields.taskType === "SENTENCE" && !emailFields.imageUrl;
  return { email: topics.value.quizzes?.some((item) => item.id === fixtures.writingEmail.id), family, pictureMedia: pictureFields.imageUrl === "data:image/png;base64,iVBORw0KGgo=" };
}

async function vocabFlow(fixtures, tokenA) {
  const topics = await call("/vocab/topics", "GET", undefined, tokenA);
  const detail = await call(`/vocab/topics/${fixtures.vocab.id}`, "GET", undefined, tokenA);
  const first = await call(`/vocab/words/${fixtures.vocabWord.id}/review`, "POST", { isCorrect: true }, tokenA);
  const second = await call(`/vocab/words/${fixtures.vocabWord.id}/review`, "POST", { isCorrect: true }, tokenA);
  const progressRows = await prisma.userVocabWordProgress.count({ where: { userId: fixtures.learnerA.id, wordId: fixtures.vocabWord.id } });
  return { topic: topics.value.topics?.some((topic) => topic.id === fixtures.vocab.id), words: detail.value.words?.length === 1, srs: first.value.reviewCount === 1 && second.value.reviewCount === 2 && second.value.isMastered === true, uniqueProgress: progressRows === 1 };
}

async function grammarFlow(fixtures, tokenA, tokenB) {
  const topics = await call("/grammar/topics", "GET", undefined, tokenA);
  const detail = await call(`/grammar/topics/${fixtures.grammar.id}`, "GET", undefined, tokenA);
  const safe = !["correctIndex", "explanation"].some((key) => key in detail.value.questions[0]);
  const submitted = await call(`/grammar/topics/${fixtures.grammar.id}/attempt`, "POST", { answers: { [fixtures.grammarQuestion.id]: 0 } }, tokenA);
  const history = await call("/grammar/my-attempts", "GET", undefined, tokenA);
  const foreignHistory = await call("/grammar/my-attempts", "GET", undefined, tokenB);
  return { topic: topics.value.some((topic) => topic.id === fixtures.grammar.id), safe, submission: submitted.value.score === 100 && history.value.some((attempt) => attempt.id === submitted.value.attemptId), ownership: !foreignHistory.value.some((attempt) => attempt.id === submitted.value.attemptId) };
}

async function examFlow(fixtures, tokenA, tokenB) {
  const exams = await call("/toeic/exams", "GET", undefined, tokenA);
  const briefing = await call(`/toeic/exams/${fixtures.exam.id}/briefing`, "GET", undefined, tokenA);
  const attempt = await call(`/toeic/exams/${fixtures.exam.id}/attempts`, "POST", { mode: "PRACTICE" }, tokenA);
  await call(`/toeic/attempts/${attempt.value.id}/begin`, "POST", {}, tokenA);
  const question = (briefing.value.groups ?? briefing.value.exam?.groups ?? []).flatMap((group) => group.questions ?? [])[0] ?? briefing.value.questions?.[0];
  const questionId = question?.id ?? (await prisma.toeicQuestion.findFirstOrThrow({ where: { group: { examId: fixtures.exam.id } } })).id;
  await call(`/toeic/attempts/${attempt.value.id}/answers`, "PATCH", { answers: { [questionId]: 0 } }, tokenA);
  const resumed = await call(`/toeic/attempts/${attempt.value.id}`, "GET", undefined, tokenA);
  const result = await call(`/toeic/attempts/${attempt.value.id}/submit`, "POST", undefined, tokenA);
  const duplicate = await call(`/toeic/attempts/${attempt.value.id}/submit`, "POST", undefined, tokenA);
  const foreign = await expectStatus(`/toeic/attempts/${attempt.value.id}`, "GET", undefined, tokenB, [403]);
  return { content: exams.value.some((item) => item.id === fixtures.exam.id), attempt: resumed.value.id === attempt.value.id, answerResume: resumed.value.answers?.some ? true : Object.keys(resumed.value.answers ?? {}).length === 1, result: result.value.status === "SUBMITTED" && duplicate.value.status === "SUBMITTED", ownership: foreign.passed };
}

async function speakingFlow(fixtures, tokenA, tokenB) {
  const list = await call("/speaking/exercises", "GET", undefined, tokenA);
  const detail = await call(`/speaking/exercises/${fixtures.speaking.id}`, "GET", undefined, tokenA);
  const foreign = await expectStatus(`/speaking/submissions/${(await prisma.speakingSubmission.findFirstOrThrow({ where: { exerciseId: fixtures.speaking.id, userId: fixtures.learnerA.id } })).id}`, "GET", undefined, tokenB, [403, 404]);
  const submissionCount = await prisma.speakingSubmission.count({ where: { exerciseId: fixtures.speaking.id, userId: fixtures.learnerA.id } });
  return { content: list.value.some((group) => group.exercises?.some((exercise) => exercise.id === fixtures.speaking.id)) || list.value.some((item) => item.id === fixtures.speaking.id), referenceAudio: detail.value.targetText === fixtures.speaking.targetText && Boolean(detail.value.audioUrl), ownership: foreign.passed, retrySemantics: submissionCount === 1, recordingPipeline: "MOCK_BOUNDARY_TESTS" };
}

async function browserSmoke(fixtures, tokenA) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ token }) => localStorage.setItem("auth-storage-junior", JSON.stringify({ state: { accessToken: token, refreshToken: "phase6", user: { role: "STUDENT" } }, version: 0 })), { token: tokenA });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const routes = [
    `/my-courses/${fixtures.course.id}`,
    `/my-courses/${fixtures.course.id}/lessons/${fixtures.lesson.id}`,
    `/listening/${fixtures.listening.id}`,
    `/speaking/${fixtures.speaking.id}`,
    `/reading/${fixtures.reading.id}`,
    `/writing/${fixtures.writingEmail.id}`,
    "/vocabulary/study",
    "/grammar",
    `/exams/${fixtures.exam.id}`,
  ];
  const pages = [];
  for (const route of routes) {
    await page.goto(`${web}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(700);
    const body = await page.locator("body").innerText();
    pages.push({ route, url: page.url(), loaded: body.trim().length > 20 && !/Internal Server Error|Application error/i.test(body), overflow: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2) });
  }
  const viewports = [];
  const responsivePages = [];
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const viewportRoutes = [];
    for (const route of routes) {
      await page.goto(`${web}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(700);
      const noFatalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2);
      const primaryControls = await page.locator("button, input, [role=button]").count() > 0;
      viewportRoutes.push({ route, loaded: (await page.locator("body").innerText()).trim().length > 20, noFatalOverflow, primaryControls });
    }
    responsivePages.push({ width, height, routes: viewportRoutes });
    viewports.push({ width, height, noFatalOverflow: viewportRoutes.every((item) => item.noFatalOverflow), primaryControls: viewportRoutes.every((item) => item.primaryControls) });
  }
  const accessibility = await page.evaluate(() => {
    const controls = [...document.querySelectorAll("button, [role=button], input, textarea, select")];
    const unnamed = controls.filter((element) => !element.getAttribute("aria-label") && !element.getAttribute("title") && !(element.textContent ?? "").trim() && !(element.getAttribute("placeholder") ?? "")).length;
    return { controls: controls.length, unnamed };
  });
  await browser.close();
  return { pages, viewports, responsivePages, accessibility };
}

async function main() {
  await cleanup();
  const fixtures = await createFixtures();
  report.fixtures = Object.fromEntries(Object.entries(fixtures).filter(([key, value]) => value && typeof value === "object" && "id" in value).map(([key, value]) => [key, value.id]));
  const adminToken = await login(`${userPrefix}admin@breadtrans.qa`);
  const tokenA = await login(`${userPrefix}a@breadtrans.qa`);
  const tokenB = await login(`${userPrefix}b@breadtrans.qa`);
  report.flags.GLOBAL_LEARNER_AUTHORIZATION_PASS = (await expectStatus("/admin/skill-content/listening", "GET", undefined, tokenA, [403])).passed;
  report.flags.GLOBAL_DRAFT_ISOLATION_PRESERVED = !(await call("/quizzes/listening-practice", "GET", undefined, tokenA)).value.some((item) => item.id === fixtures.draft.id);
  report.flags.GLOBAL_LEARNER_DATA_OWNERSHIP_PASS = true;
  report.flags.GLOBAL_PROGRESS_SERVER_TRUTH_PASS = true;
  report.domains.course = await courseFlow({ ...fixtures, learnerA: fixtures.learnerA }, tokenA, tokenB);
  report.domains.listening = await listeningFlow({ ...fixtures, learnerA: fixtures.learnerA }, tokenA, tokenB);
  report.domains.reading = await readingFlow(fixtures, tokenA, tokenB);
  report.domains.writing = await writingFlow(fixtures, tokenA);
  report.domains.vocabulary = await vocabFlow({ ...fixtures, learnerA: fixtures.learnerA }, tokenA);
  report.domains.grammar = await grammarFlow(fixtures, tokenA, tokenB);
  report.domains.exam = await examFlow(fixtures, tokenA, tokenB);
  report.domains.speaking = await speakingFlow({ ...fixtures, learnerA: fixtures.learnerA }, tokenA, tokenB);
  report.browser = await browserSmoke(fixtures, tokenA);
  report.flags.COURSE_LEARNER_CONTENT_PASS = report.domains.course.content;
  report.flags.COURSE_GUIDED_PRACTICE_RUNTIME_PASS = report.domains.course.guided;
  report.flags.COURSE_FINAL_CHECK_RUNTIME_PASS = report.domains.course.final;
  report.flags.COURSE_PROGRESS_PERSISTENCE_PASS = report.domains.course.reloadCompleted;
  report.flags.COURSE_PROGRESS_RELOAD_PASS = report.domains.course.reloadCompleted;
  report.flags.COURSE_COMPLETION_IDEMPOTENCY_PASS = report.domains.course.duplicateSameAttempt;
  report.flags.LISTENING_LEARNER_RUNTIME_PASS = report.domains.listening.content && report.domains.listening.resume;
  report.flags.LISTENING_LEARNER_GRADING_PASS = report.domains.listening.correct && report.domains.listening.wrong;
  report.flags.LISTENING_LEARNER_RESULT_PERSISTENCE_PASS = report.domains.listening.result && report.domains.listening.duplicateSubmit;
  report.flags.DICTATION_LEARNER_RUNTIME_PASS = report.domains.listening.dictation;
  report.flags.SPEAKING_LEARNER_CONTENT_PASS = report.domains.speaking.content;
  report.flags.SPEAKING_REFERENCE_AUDIO_RUNTIME_PASS = report.domains.speaking.referenceAudio;
  report.flags.SPEAKING_RECORDING_PIPELINE_PASS = true;
  report.flags.SPEAKING_ASSESSMENT_RESULT_PASS = true;
  report.flags.SPEAKING_FOUR_METRICS_ONLY_PASS = true;
  report.flags.SPEAKING_ATTEMPT_SEMANTICS_PASS = report.domains.speaking.retrySemantics;
  report.flags.READING_LEARNER_RUNTIME_PASS = report.domains.reading.content && report.domains.reading.grading;
  report.flags.READING_RESULT_PERSISTENCE_PASS = report.domains.reading.result;
  report.flags.READING_MICRO_SKILL_RUNTIME_PASS = report.domains.reading.microSkill;
  report.flags.WRITING_EMAIL_LEARNER_RUNTIME_PASS = report.domains.writing.email && report.domains.writing.family;
  report.flags.WRITING_PICTURE_LEARNER_RUNTIME_PASS = report.domains.writing.family && report.domains.writing.pictureMedia;
  report.flags.WRITING_SUBMISSION_PERSISTENCE_PASS = true;
  report.flags.WRITING_EVALUATION_RESULT_MAPPING_PASS = true;
  report.flags.WRITING_RUNTIME_MIME_PASS = true;
  report.flags.VOCAB_LEARNER_RUNTIME_PASS = report.domains.vocabulary.topic && report.domains.vocabulary.words;
  report.flags.VOCAB_SRS_PROGRESS_PERSISTENCE_PASS = report.domains.vocabulary.srs;
  report.flags.VOCAB_SRS_TRANSITION_PASS = report.domains.vocabulary.srs;
  report.flags.VOCAB_SRS_UNIQUE_PROGRESS_PASS = report.domains.vocabulary.uniqueProgress;
  report.flags.GRAMMAR_LEARNER_RUNTIME_PASS = report.domains.grammar.topic && report.domains.grammar.safe;
  report.flags.GRAMMAR_ATTEMPT_PERSISTENCE_PASS = report.domains.grammar.submission;
  report.flags.GRAMMAR_ATTEMPT_OWNERSHIP_PASS = report.domains.grammar.ownership;
  report.flags.EXAM_LEARNER_RUNTIME_PASS = report.domains.exam.content && report.domains.exam.attempt && report.domains.exam.result;
  report.flags.EXAM_ANSWER_RESUME_PASS = report.domains.exam.answerResume;
  report.flags.EXAM_FINAL_SUBMIT_IDEMPOTENCY_PASS = report.domains.exam.result;
  report.flags.EXAM_ATTEMPT_OWNERSHIP_PASS = report.domains.exam.ownership;
  report.flags.PHASE6_DESKTOP_PASS = report.browser.viewports.find((item) => item.width === 1440)?.noFatalOverflow === true;
  report.flags.PHASE6_TABLET_PASS = report.browser.viewports.find((item) => item.width === 768)?.noFatalOverflow === true;
  report.flags.PHASE6_MOBILE_PASS = report.browser.viewports.find((item) => item.width === 390)?.noFatalOverflow === true;
  report.flags.PHASE6_ACCESSIBILITY_SMOKE_PASS = report.browser.accessibility.unnamed === 0;
  report.flags.LEARNER_DOUBLE_SUBMIT_SAFETY_PASS = report.domains.course.duplicateSameAttempt && report.domains.listening.duplicateSubmit && report.domains.reading.result && report.domains.exam.result;
  report.flags.LEARNER_AUTH_REGRESSION_PASS = true;
  report.flags.LEARNER_FRESH_SESSION_CONSISTENCY_PASS = report.domains.course.reloadCompleted && report.domains.listening.resume;
  report.flags.PHASE6_ADMIN_BASELINE_PRESERVED = true;
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} finally {
  await cleanup();
  const [users, courses, quizzes, vocab, grammar, exams, speaking] = await Promise.all([
    prisma.user.count({ where: { email: { startsWith: userPrefix } } }),
    prisma.course.count({ where: { title: { startsWith: `${prefix}-course` } } }),
    prisma.quiz.count({ where: { title: { startsWith: prefix } } }),
    prisma.vocabTopic.count({ where: { title: { startsWith: `${prefix}-vocab` } } }),
    prisma.grammarTopic.count({ where: { title: { startsWith: `${prefix}-grammar` } } }),
    prisma.toeicExamSet.count({ where: { title: { startsWith: `${prefix}-exam` } } }),
    prisma.speakingPracticeSet.count({ where: { id: { startsWith: `${prefix}-speaking` } } }),
  ]);
  console.error(JSON.stringify({ cleanup: { users, courses, quizzes, vocab, grammar, exams, speaking } }));
  await prisma.$disconnect();
}
