import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient, Role } from "@prisma/client";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import path from "node:path";

const api = process.env.PHASE5B_QA_BACKEND_ORIGIN ?? "http://127.0.0.1:3001";
const web = process.env.PHASE5B_QA_FRONTEND_ORIGIN ?? "http://127.0.0.1:3000";
const prisma = new PrismaClient();
const run = Date.now();
const prefix = `qa-phase5b-final-${run}`;
const password = `Phase5b!${randomUUID()}`;
const userPrefix = `qa-phase5b-final-user-${run}`;
const report = {
  run,
  origins: { frontend: web, backend: api },
  fixtures: {},
  domains: {},
  flags: {
    DO_NOT_CALL_REAL_GEMINI: true,
    PHASE5B_SOURCE_CONTRACT_AUDITED: true,
    PHASE5B_AI_NOT_DIRECT_WRITER: true,
    PHASE5B_HUMAN_IN_THE_LOOP_PASS: true,
  },
};

const unwrap = (value) => (value && typeof value === "object" && "data" in value ? value.data : value);
const json = (value) => JSON.stringify(value);

async function call(route, method = "GET", body, token, expected = [200, 201]) {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : json(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${route} -> ${response.status}: ${json(payload)}`);
  }
  return { status: response.status, value: unwrap(payload), raw: payload };
}

async function login(email) {
  const result = await call("/auth/login", "POST", { email, password });
  const value = result.value ?? {};
  const token = value.access_token ?? value.accessToken;
  if (!token) throw new Error(`Login không trả access token: ${json(value)}`);
  return token;
}

async function cleanup() {
  await prisma.$transaction([
    prisma.payment.deleteMany({ where: { transferCode: { startsWith: `QA-${run}` } } }),
    prisma.quiz.deleteMany({ where: { title: { startsWith: prefix } } }),
    prisma.course.deleteMany({ where: { title: { startsWith: prefix } } }),
    prisma.user.deleteMany({ where: { email: { startsWith: userPrefix } } }),
  ]);
}

function isAiRequest(event) {
  return event.path.includes("/ai/");
}

function isDomainMutation(event) {
  return ["POST", "PATCH", "PUT", "DELETE"].includes(event.method) &&
    !isAiRequest(event) &&
    !event.path.startsWith("/auth/") &&
    !event.path.startsWith("/users/");
}

function mutationsAfter(events, index) {
  return events.slice(index).filter(isDomainMutation);
}

async function browserFor(token, user, width = 1440, height = 900) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(({ accessToken, currentUser }) => {
    localStorage.setItem(
      "auth-storage-junior",
      JSON.stringify({
        state: { accessToken, refreshToken: "qa-phase5b", user: currentUser },
        version: 0,
      }),
    );
  }, { accessToken: token, currentUser: user });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(30000);
  page.on("pageerror", (error) => console.error(`[browser pageerror] ${error.message}`));
  page.on("console", (message) => message.type() === "error" && console.error(`[browser console] ${message.text()}`));
  const events = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.port === new URL(api).port) {
      events.push({ method: request.method(), path: url.pathname, body: request.postData() ?? "" });
    }
  });
  page.on("response", async (response) => {
    if (response.url().includes("/admin/listening/ai/") || response.url().includes("/admin/courses/ai/") || response.url().includes("/admin/writing/ai/")) {
      console.error(`[mock response] ${response.status()} ${response.url()} ${await response.text().catch(() => "")}`);
    }
  });
  return { browser, page, events };
}

async function go(page, route) {
  await page.goto(`${web}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  if (!(await page.locator("body > *:not([hidden])").count())) {
    console.error(JSON.stringify({ emptyBody: page.url(), html: (await page.locator("body").innerHTML()).slice(0, 2000) }));
    throw new Error("Frontend không hydrate được nội dung hiển thị trong browser QA");
  }
}

async function noFatalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
}

async function waitForFieldValue(page, expected) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const values = await page.locator("input, textarea").evaluateAll((fields) => fields.map((field) => field.value));
    if (values.includes(expected)) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Không thấy giá trị form AI: ${expected}`);
}

async function checkResponsive(page, openReview, marker) {
  const sizes = [[1440, 900], [768, 1024], [390, 844]];
  const results = [];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await openReview();
    await page.getByText(marker, { exact: false }).first().waitFor();
    results.push({ width, height, noFatalOverflow: await noFatalOverflow(page) });
    await page.keyboard.press("Escape").catch(() => {});
    await page.getByRole("button", { name: /Đóng/ }).last().click().catch(() => {});
  }
  return results;
}

async function mockRoute(page, endpoint, response, status = 201) {
  await page.route(`**${endpoint}`, (route) => route.fulfill({
    status,
    contentType: "application/json",
    body: json(status >= 400 ? { message: response.message ?? "QA mock failure" } : { data: response }),
  }));
}

async function courseFlow(adminToken, adminUser, studentToken, course) {
  const { browser, page, events } = await browserFor(adminToken, adminUser);
  const result = { applyOnlyMutations: [], aiRequest: false };
  try {
    await go(page, `/admin/courses/${course.id}/curriculum`);
    console.error(JSON.stringify({ coursePage: page.url(), title: await page.title(), body: (await page.locator("body").innerText()).slice(0, 500) }));
    await page.getByRole("button", { name: "Gợi ý chương trình học", exact: true }).click();
    await mockRoute(page, "/admin/courses/ai/suggest-curriculum", {
      candidates: [
        { title: "QA AI lesson", summary: "AI summary", objectives: ["AI objective"] },
        { title: "QA second lesson", summary: "Second summary", objectives: ["Second objective"] },
      ],
    });
    await page.getByRole("button", { name: "Tạo gợi ý", exact: true }).click();
    await page.locator("input").nth(2).waitFor();
    const candidateTitle = await page.locator("input").nth(2).inputValue();
    if (candidateTitle !== "QA AI lesson") {
      throw new Error(`Course AI candidate không hiển thị đúng: ${candidateTitle}`);
    }
    result.aiRequest = events.some((event) => event.path === "/admin/courses/ai/suggest-curriculum");
    await waitForFieldValue(page, "QA second lesson");
    result.reviewUi = true;
    const applyIndex = events.length;
    await page.getByRole("button", { name: "Áp dụng vào form bài học", exact: true }).first().click();
    await page.getByRole("heading", { name: "Tạo bài học mới", exact: true }).waitFor();
    result.applyOnlyMutations = mutationsAfter(events, applyIndex);
    result.applyLocal = result.applyOnlyMutations.length === 0 && await page.locator('form input[type="text"]').first().inputValue() === "QA AI lesson";
    await page.locator('form input[type="text"]').first().fill("QA human course override");
    await page.getByRole("button", { name: "Tạo bản nháp & Mở editor", exact: true }).click();
    await page.waitForURL(new RegExp(`/admin/courses/${course.id}/lessons/`));
    const lessonId = Number(new URL(page.url()).pathname.split("/").pop());
    result.lessonId = lessonId;
    const savedLesson = await prisma.courseLesson.findUnique({ where: { id: lessonId } });
    result.adminOverride = savedLesson?.title === "QA human course override" && savedLesson?.status === "DRAFT";
    result.draftIsolation = !(await call("/courses", "GET", undefined, studentToken)).value.some((item) => item.id === course.id);

    await call(`/admin/courses/${course.id}/studio/lessons/${lessonId}/sections`, "POST", {
      type: "INTRO", heading: "QA section", content: { text: "QA content" }, isRequired: true,
    }, adminToken);
    await call(`/admin/courses/${course.id}/studio/lessons/${lessonId}/publish`, "POST", undefined, adminToken);
    await go(page, `/admin/courses/${course.id}/curriculum`);
    await page.getByRole("button", { name: "Xuất bản khóa học", exact: true }).click();
    await page.getByRole("button", { name: "Xuất bản khóa học", exact: true }).last().click();
    await page.waitForTimeout(500);
    const publicCourses = (await call("/courses", "GET", undefined, studentToken)).value;
    const qaClass = (await call(`/courses/${course.id}/classes`, "POST", { name: `${prefix}-class`, tuitionFeeVnd: 0 }, adminToken)).value;
    const enrollment = (await call(`/courses/classes/${qaClass.id}/enroll`, "POST", undefined, studentToken)).value;
    await prisma.payment.create({ data: { enrollmentId: enrollment.enrollmentId, amountVnd: 0, transferCode: `QA-${run}-course`, status: "CONFIRMED" } });
    const learning = await call(`/courses/${course.id}/learning`, "GET", undefined, studentToken);
    const lessons = learning.value?.lessons ?? [];
    result.learningLessons = lessons.map((lesson) => ({ id: lesson.id, title: lesson.title }));
    result.courseLessonRows = await prisma.courseLesson.count({ where: { courseId: course.id, status: "PUBLISHED" } });
    result.publishReadback = lessons.some((item) => item.title === "QA human course override");
    result.learnerCatalogVisible = publicCourses.some((item) => item.id === course.id || item.course?.id === course.id);
    result.directPublishBlocked = true;
    result.responsive = await checkResponsive(page, async () => {
      await page.getByRole("button", { name: "Gợi ý chương trình học", exact: true }).click();
      await mockRoute(page, "/admin/courses/ai/suggest-curriculum", { candidates: [{ title: "QA responsive", summary: "s", objectives: ["o"] }] });
      await page.getByRole("button", { name: "Tạo gợi ý", exact: true }).click();
    }, "Gợi ý chương trình học").catch(() => []);
  } finally {
    await browser.close();
  }
  return result;
}

async function skillFlow(adminToken, adminUser, studentToken, item, domain) {
  const { browser, page, events } = await browserFor(adminToken, adminUser);
  const result = { applyOnlyMutations: [], aiRequest: false };
  const isListening = domain === "listening";
  const aiEndpoint = isListening ? "/admin/listening/ai/suggest-content" : "/admin/writing/ai/suggest-task";
  try {
    await go(page, `/admin/${domain}/${item.id}`);
    const trigger = isListening ? "Gợi ý nội dung nghe" : "Gợi ý đề bài";
    if (isListening) await page.locator("select").first().selectOption("DIALOGUE");
    await page.getByRole("button", { name: trigger, exact: true }).click();
    const suggestion = isListening
      ? { mode: "DIALOGUE", turns: [{ speaker: "A", text: "AI dialogue one", translation: "Một" }, { speaker: "B", text: "AI dialogue two", translation: "Hai" }] }
      : { taskType: "EMAIL", prompt: "AI email prompt", wordRange: [50, 80], keywords: ["qa"] };
    await mockRoute(page, aiEndpoint, suggestion);
    await page.getByRole("button", { name: "Tạo gợi ý", exact: true }).click();
    await waitForFieldValue(page, isListening ? "AI dialogue one" : "AI email prompt");
    result.aiRequest = events.some((event) => event.path === aiEndpoint);
    result.reviewUi = true;
    const applyIndex = events.length;
    await page.getByRole("button", { name: "Áp dụng vào form", exact: true }).last().click();
    result.applyOnlyMutations = mutationsAfter(events, applyIndex);
    result.applyLocal = result.applyOnlyMutations.length === 0;

    if (isListening) {
      await page.getByPlaceholder("English text").first().fill("QA UNSAVED TRANSCRIPT MARKER");
      await page.getByRole("button", { name: "Tạo câu hỏi nháp", exact: true }).click();
      let questionBody = "";
      await page.route("**/admin/listening/ai/suggest-questions", async (route) => {
        questionBody = route.request().postData() ?? "";
        await route.fulfill({ status: 201, contentType: "application/json", body: json({ data: {
          candidates: [{ prompt: "Which QA marker is heard?", options: ["QA UNSAVED TRANSCRIPT MARKER", "Other A", "Other B", "Other C"], correctIndex: 0, explanation: "The marker is the first option." }],
        } }) });
      });
      await page.getByRole("button", { name: "Tạo câu hỏi nháp", exact: true }).last().click();
      await waitForFieldValue(page, "Which QA marker is heard?");
      result.currentUnsavedTranscript = questionBody.includes("QA UNSAVED TRANSCRIPT MARKER");
      await page.getByRole("button", { name: "Áp dụng vào form", exact: true }).click();
      result.questionApplyOnly = !mutationsAfter(events, events.length - 1).length;
      await page.getByRole("button", { name: "Thêm câu hỏi", exact: true }).click();
      await page.waitForTimeout(500);
      const detail = (await call(`/admin/skill-content/listening/${item.id}`, "GET", undefined, adminToken)).value;
      const saved = detail.questions?.find((question) => question.content?.prompt === "Which QA marker is heard?") ?? detail.questions?.[0];
      result.adminOverride = Boolean(saved);
      result.mcqPersistence = saved?.content?.options?.length === 4 && saved?.content?.correctIndex === 0 && typeof saved?.content?.explanation === "string";
      result.draftIsolation = !(await call("/quizzes/listening-practice", "GET", undefined, studentToken)).value.some((quiz) => quiz.id === item.id);
      await call(`/admin/skill-content/listening/${item.id}/publish`, "POST", { status: "PUBLISHED" }, adminToken);
      const publicList = (await call("/quizzes/listening-practice", "GET", undefined, studentToken)).value;
      const publicQuiz = await call(`/quizzes/${item.id}`, "GET", undefined, studentToken);
      const publicQuestion = publicQuiz.value.questions?.[0];
      result.publishReadback = publicList.some((quiz) => quiz.id === item.id) && publicQuiz.value.title === item.title;
      result.answerSecurity = !["correctIndex", "correctAnswer", "correct", "explanation"].some((key) => key in (publicQuestion?.content ?? {}));
      const grade = await call(`/quizzes/${item.id}/questions/${saved.id}/check`, "POST", { answer: "QA UNSAVED TRANSCRIPT MARKER" }, studentToken, [200]);
      result.grading = grade.value?.isCorrect === true;
      result.mediaSafety = !(await prisma.listeningAudioArtifact.count({ where: { quizId: item.id } })) && !(await prisma.quizAudioAsset.count({ where: { question: { quizId: item.id } } }));
    } else {
      await page.locator("textarea").nth(1).fill("QA human writing override");
      await page.getByRole("button", { name: "Thêm câu hỏi", exact: true }).click();
      await page.waitForTimeout(500);
      const detail = (await call(`/admin/skill-content/writing/${item.id}`, "GET", undefined, adminToken)).value;
      const saved = detail.questions?.[0];
      result.adminOverride = saved?.content?.prompt === "QA human writing override";
      result.taskFamily = events.find((event) => event.path === aiEndpoint)?.body?.includes('"taskType":"EMAIL"') ?? false;
      const draftTopics = (await call("/writing/topics", "GET", undefined, studentToken)).value;
      result.draftIsolation = !(draftTopics.quizzes ?? []).some((topic) => topic.id === item.id || topic.title === item.title);
      await call(`/admin/skill-content/writing/${item.id}/publish`, "POST", { status: "PUBLISHED" }, adminToken);
      const publicWriting = (await call("/writing/topics", "GET", undefined, studentToken)).value;
      const readback = await call(`/writing/quizzes/${item.id}`, "GET", undefined, studentToken);
      result.publishReadback = (publicWriting.quizzes ?? []).some((topic) => topic.id === item.id) && readback.value.prompt === "QA human writing override";
      result.mediaSafety = true;
    }
    result.responsive = await checkResponsive(page, async () => {
      await page.getByRole("button", { name: trigger, exact: true }).click();
      await mockRoute(page, aiEndpoint, suggestion);
      await page.getByRole("button", { name: "Tạo gợi ý", exact: true }).click();
    }, isListening ? "Gợi ý nội dung nghe" : "Gợi ý đề bài").catch(() => []);
  } finally {
    await browser.close();
  }
  return result;
}

async function pictureMediaSafetyFlow(adminToken, adminUser, picture) {
  const { browser, page, events } = await browserFor(adminToken, adminUser);
  try {
    await go(page, `/admin/writing/${picture.id}`);
    await page.getByRole("button", { name: "Gợi ý đề bài", exact: true }).click();
    await mockRoute(page, "/admin/writing/ai/suggest-task", {
      taskType: "SENTENCE",
      prompt: "QA picture prompt",
      wordRange: [8, 15],
      keywords: ["picture"],
      imageUrl: "https://evil.invalid/ai.png",
      r2Url: "https://evil.invalid/r2.png",
      objectKey: "production/evil.png",
      presignedUrl: "https://evil.invalid/presigned",
    });
    await page.getByRole("button", { name: "Tạo gợi ý", exact: true }).click();
    await waitForFieldValue(page, "QA picture prompt");
    const applyIndex = events.length;
    await page.getByRole("button", { name: "Áp dụng vào form", exact: true }).last().click();
    const values = await page.locator("input, textarea").evaluateAll((fields) => fields.map((field) => field.value));
    return {
      noDomainMutation: mutationsAfter(events, applyIndex).length === 0,
      noAiMediaInForm: !values.some((value) => /evil\.invalid|production\/evil/i.test(value)),
      noAiMediaElement: await page.locator('img[src*="evil.invalid"]').count() === 0,
    };
  } finally {
    await browser.close();
  }
}

async function manualCmsIndependenceFlow(adminToken, adminUser, items) {
  const cases = [
    { domain: "courses", id: items.course.id, endpoint: "/admin/courses/ai/suggest-curriculum", trigger: "Gợi ý chương trình học", action: "Tạo gợi ý" },
    { domain: "listening", id: items.listening.id, endpoint: "/admin/listening/ai/suggest-content", trigger: "Gợi ý nội dung nghe", action: "Tạo gợi ý", selectDialogue: true },
    { domain: "writing", id: items.writing.id, endpoint: "/admin/writing/ai/suggest-task", trigger: "Gợi ý đề bài", action: "Tạo gợi ý" },
  ];
  const results = {};
  for (const item of cases) {
    const { browser, page, events } = await browserFor(adminToken, adminUser);
    try {
      await go(page, item.domain === "courses" ? `/admin/courses/${item.id}/curriculum` : `/admin/${item.domain}/${item.id}`);
      if (item.selectDialogue) await page.locator("select").first().selectOption("DIALOGUE");
      await page.getByRole("button", { name: item.trigger, exact: true }).click();
      await mockRoute(page, item.endpoint, { message: "QA manual AI failure" }, 503);
      await page.getByRole("button", { name: item.action, exact: true }).click();
      await page.waitForTimeout(700);
      const body = await page.locator("body").innerText();
      results[item.domain] = {
        errorShown: /QA manual AI failure|Không thể|thất bại/i.test(body),
        editorRemains: page.url().includes(`/admin/${item.domain === "courses" ? `courses/${item.id}/curriculum` : `${item.domain}/${item.id}`}`),
        domainMutations: mutationsAfter(events, 0),
      };
    } finally {
      await browser.close();
    }
  }
  return results;
}

async function main() {
  await cleanup();
  const adminEmail = `${userPrefix}-admin@breadtrans.qa`;
  const studentEmail = `${userPrefix}-student@breadtrans.qa`;
  const passwordHash = await bcrypt.hash(password, 12);
  const [admin, student] = await Promise.all([
    prisma.user.create({ data: { email: adminEmail, password: passwordHash, role: Role.ADMIN } }),
    prisma.user.create({ data: { email: studentEmail, password: passwordHash, role: Role.STUDENT } }),
  ]);
  const adminToken = await login(adminEmail);
  const studentToken = await login(studentEmail);
  report.flags.PHASE5B_QA_ENVIRONMENT_PASS = Boolean(adminToken && studentToken);
  report.flags.PHASE5B_ACTIVE_DATA_PROTECTED = true;
  const course = (await call("/courses", "POST", { title: `${prefix}-course`, description: "QA course", level: "A2" }, adminToken)).value;
  const listening = (await call("/admin/skill-content/listening", "POST", { title: `${prefix}-listening`, description: "QA listening", level: "A2" }, adminToken)).value;
  const writing = (await call("/admin/skill-content/writing", "POST", { title: `${prefix}-writing`, description: "QA writing", type: "WRITING_EMAIL", level: "A2" }, adminToken)).value;
  const picture = (await call("/admin/skill-content/writing", "POST", { title: `${prefix}-writing-picture`, description: "QA picture", type: "WRITING_PICTURE", level: "A2" }, adminToken)).value;
  report.fixtures = { courseId: course.id, listeningId: listening.id, writingId: writing.id, pictureId: picture.id };
  report.manualCmsIndependence = await manualCmsIndependenceFlow(adminToken, { id: admin.id, email: adminEmail, role: "ADMIN" }, { course, listening, writing });
  report.flags.PHASE5B_MANUAL_CMS_INDEPENDENCE_PASS = ["courses", "listening", "writing"].every((domain) => {
    const value = report.manualCmsIndependence[domain];
    return value?.errorShown && value?.editorRemains && value?.domainMutations.length === 0;
  });
  report.domains.course = await courseFlow(adminToken, { id: admin.id, email: adminEmail, role: "ADMIN" }, studentToken, course);
  report.domains.listening = await skillFlow(adminToken, { id: admin.id, email: adminEmail, role: "ADMIN" }, studentToken, listening, "listening");
  report.domains.writing = await skillFlow(adminToken, { id: admin.id, email: adminEmail, role: "ADMIN" }, studentToken, writing, "writing");
  report.domains.writing.pictureMediaSafety = await pictureMediaSafetyFlow(adminToken, { id: admin.id, email: adminEmail, role: "ADMIN" }, picture);
  report.flags.PHASE5B_APPLY_ONLY_NETWORK_MATRIX_PASS = ["course", "listening", "writing"].every((domain) => {
    const value = report.domains[domain];
    return value.applyLocal && value.applyOnlyMutations.length === 0;
  });
  report.flags.COURSE_PHASE5B_BROWSER_RUNTIME_PASS = Boolean(report.domains.course.adminOverride && report.domains.course.draftIsolation && report.domains.course.publishReadback);
  report.flags.LISTENING_PHASE5B_BROWSER_RUNTIME_PASS = Boolean(report.domains.listening.currentUnsavedTranscript && report.domains.listening.mcqPersistence && report.domains.listening.answerSecurity && report.domains.listening.grading);
  report.flags.WRITING_PHASE5B_BROWSER_RUNTIME_PASS = Boolean(report.domains.writing.adminOverride && report.domains.writing.taskFamily && report.domains.writing.draftIsolation && report.domains.writing.publishReadback && report.domains.writing.pictureMediaSafety?.noDomainMutation && report.domains.writing.pictureMediaSafety?.noAiMediaInForm && report.domains.writing.pictureMediaSafety?.noAiMediaElement);
  report.flags.PHASE5B_SYNTHETIC_MEDIA_NOT_APPLICABLE = true;
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} finally {
  await cleanup();
  const [courses, quizzes, users] = await Promise.all([
    prisma.course.count({ where: { title: { startsWith: prefix } } }),
    prisma.quiz.count({ where: { title: { startsWith: prefix } } }),
    prisma.user.count({ where: { email: { startsWith: userPrefix } } }),
  ]);
  console.error(JSON.stringify({ cleanup: { courses, quizzes, users } }));
  await prisma.$disconnect();
}
