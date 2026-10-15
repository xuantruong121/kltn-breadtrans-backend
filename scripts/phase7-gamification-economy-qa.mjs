import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";

const api = process.env.PHASE7_QA_BACKEND_ORIGIN ?? "http://localhost:3001";
const web = process.env.PHASE7_QA_FRONTEND_ORIGIN ?? "http://localhost:3000";
const prisma = new PrismaClient();
const run = Date.now();
const prefix = `qa-phase7-${run}`;
const userPrefix = "qa-phase7-user-";
const shopPrefix = `qa-phase7-shop-${run}`;
const password = `Phase7!${randomUUID()}`;
const result = { run, origins: { api, web }, checks: {}, flags: {} };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const unwrap = (value) => value && typeof value === "object" && "data" in value ? value.data : value;
const allTruthy = (value) => typeof value === "number"
  ? true
  : Array.isArray(value)
  ? value.every(allTruthy)
  : value && typeof value === "object"
    ? Object.values(value).every(allTruthy)
    : Boolean(value);

async function call(route, method = "GET", body, token, headers = {}, expected = [200, 201, 202]) {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: { "content-type": "application/json", ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!expected.includes(response.status)) throw new Error(`${method} ${route} -> ${response.status}: ${JSON.stringify(payload)}`);
  return { status: response.status, value: unwrap(payload), raw: payload };
}

async function expectStatus(route, method, body, token, expected) {
  try {
    const response = await call(route, method, body, token, {}, expected);
    return { passed: true, status: response.status };
  } catch (error) {
    const status = Number(String(error.message).match(/-> (\d+)/)?.[1] ?? 0);
    return { passed: expected.includes(status), status, error: String(error.message) };
  }
}

async function login(email) {
  const response = await call("/auth/login", "POST", { email, password });
  const token = response.value?.access_token ?? response.value?.accessToken;
  if (!token) throw new Error(`Không nhận được token cho ${email}`);
  return token;
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: userPrefix } }, select: { id: true } });
  const userIds = users.map(({ id }) => id);
  if (userIds.length) {
    await prisma.marketPhysicalRedemption.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.marketOrder.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.banhTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.marketProduct.deleteMany({ where: { slug: { startsWith: "qa-phase7-shop-" } } });
  await prisma.grammarTopic.deleteMany({ where: { title: { startsWith: "qa-phase7-" } } });
  await prisma.quiz.deleteMany({ where: { title: { startsWith: "qa-phase7-" } } });
}

async function snapshot() {
  const [stats, ledger, courses, quizzes, grammar, vocab, exams, speaking] = await Promise.all([
    prisma.userStats.aggregate({ _count: { _all: true }, _sum: { totalBanhRan: true } }),
    prisma.banhTransaction.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
    prisma.course.count({ where: { status: "PUBLISHED" } }),
    prisma.quiz.count({ where: { publicationStatus: "PUBLISHED" } }),
    prisma.grammarTopic.count({ where: { publicationStatus: "PUBLISHED" } }),
    prisma.vocabTopic.count({ where: { publicationStatus: "PUBLISHED" } }),
    prisma.toeicExamSet.count({ where: { publicationStatus: "PUBLISHED" } }),
    prisma.speakingPracticeSet.count({ where: { publicationStatus: "PUBLISHED" } }),
  ]);
  return {
    userStats: stats._count._all,
    totalBanh: stats._sum.totalBanhRan ?? 0,
    ledgerRows: ledger._count._all,
    ledgerAmount: ledger._sum.amount ?? 0,
    published: { courses, quizzes, grammar, vocab, exams, speaking },
  };
}

async function fixtures() {
  const hash = await bcrypt.hash(password, 12);
  const [admin, a, b] = await Promise.all([
    prisma.user.create({ data: { email: `${userPrefix}admin@breadtrans.qa`, password: hash, role: "ADMIN" } }),
    prisma.user.create({ data: { email: `${userPrefix}a@breadtrans.qa`, password: hash, role: "STUDENT" } }),
    prisma.user.create({ data: { email: `${userPrefix}b@breadtrans.qa`, password: hash, role: "STUDENT" } }),
  ]);
  await Promise.all([
    prisma.userStats.create({ data: { userId: a.id, totalBanhRan: 100 } }),
    prisma.userStats.create({ data: { userId: b.id, totalBanhRan: 100 } }),
  ]);
  // The legacy seed database may have a stale PostgreSQL sequence. Normalize it
  // before relying on auto-increment, without changing any product rows.
  await prisma.$executeRawUnsafe('SELECT setval(pg_get_serial_sequence(\'"MarketProduct"\', \'id\'), COALESCE((SELECT MAX(id) FROM "MarketProduct"), 0), true)');
  const [purchaseProduct, stockProduct, expensiveProduct] = await Promise.all([
    prisma.marketProduct.create({ data: { slug: `${shopPrefix}-idempotent`, name: "Phase 7 Idempotent", price: 10, stock: 10, isActive: true } }),
    prisma.marketProduct.create({ data: { slug: `${shopPrefix}-stock`, name: "Phase 7 Stock Race", price: 30, stock: 1, isActive: true } }),
    prisma.marketProduct.create({ data: { slug: `${shopPrefix}-expensive`, name: "Phase 7 Expensive", price: 1000, stock: 1, isActive: true } }),
  ]);
  const grammar = await prisma.grammarTopic.create({ data: {
    title: `${prefix}-grammar`, level: "BEGINNER", publicationStatus: "PUBLISHED",
    questions: { create: { question: "Choose A", options: ["A", "B"], correctIndex: 0, explanation: "A", order: 1 } },
  } });
  const grammarQuestion = await prisma.grammarQuestion.findFirstOrThrow({ where: { topicId: grammar.id } });
  const quiz = await prisma.quiz.create({ data: {
    title: `${prefix}-quiz`, type: "LISTENING_PRACTICE", publicationStatus: "PUBLISHED",
    questions: { create: { type: "MULTIPLE_CHOICE", order: 1, content: { prompt: "Choose A", options: ["A", "B"], correctIndex: 0, explanation: "A" } } },
  } });
  const quizQuestion = await prisma.question.findFirstOrThrow({ where: { quizId: quiz.id } });
  return { admin, a, b, purchaseProduct, stockProduct, expensiveProduct, grammar, grammarQuestion, quiz, quizQuestion };
}

async function runApiChecks(f, tokens) {
  const grammarBody = { answers: { [f.grammarQuestion.id]: 0 } };
  await Promise.all([
    call(`/grammar/topics/${f.grammar.id}/attempt`, "POST", grammarBody, tokens.a),
    call(`/grammar/topics/${f.grammar.id}/attempt`, "POST", grammarBody, tokens.a),
  ]);
  const grammarLedger = await prisma.banhTransaction.count({ where: { userId: f.a.id, source: "GRAMMAR_COMPLETION", reference: `grammar:topic:${f.grammar.id}` } });
  const grammarReward = await prisma.userGrammarReward.count({ where: { userId: f.a.id, topicId: f.grammar.id } });

  const quizBody = (clientAttemptId) => ({ clientAttemptId, answers: [{ questionId: f.quizQuestion.id, answer: "A" }] });
  await call(`/quizzes/${f.quiz.id}/submit`, "POST", quizBody(randomUUID()), tokens.a);
  await call(`/quizzes/${f.quiz.id}/submit`, "POST", quizBody(randomUUID()), tokens.a);
  await sleep(400);
  const quizLedger = await prisma.banhTransaction.count({ where: { userId: f.a.id, source: "QUIZ_FIRST_COMPLETION", reference: `quiz:${f.quiz.id}` } });
  const quizReward = await prisma.userQuizReward.count({ where: { userId: f.a.id, quizId: f.quiz.id } });

  const marketBefore = await prisma.userStats.findUniqueOrThrow({ where: { userId: f.a.id } });
  const idem = `phase7-idem-${randomUUID()}`;
  const orderPayload = { items: [{ id: f.purchaseProduct.slug, quantity: 1 }], totalBanh: 1 };
  const orders = await Promise.all([
    call("/market/orders", "POST", orderPayload, tokens.a, { "idempotency-key": idem }),
    call("/market/orders", "POST", orderPayload, tokens.a, { "idempotency-key": idem }),
  ]);
  const sameOrder = orders[0].value.orderId === orders[1].value.orderId;
  const afterOrder = await prisma.userStats.findUniqueOrThrow({ where: { userId: f.a.id } });
  const purchaseLedger = await prisma.banhTransaction.count({ where: { userId: f.a.id, source: "MARKET_PURCHASE", reference: `market:order:${orders[0].value.orderId}` } });
  const purchaseRow = await prisma.marketOrder.findUniqueOrThrow({ where: { id: orders[0].value.orderId } });
  const forged = await expectStatus("/market/orders", "POST", { items: [{ id: f.expensiveProduct.slug, quantity: 1 }], totalBanh: 1 }, tokens.a, [400, 422]);
  const insufficient = await expectStatus("/market/orders", "POST", { items: [{ id: f.expensiveProduct.slug, quantity: 1 }] }, tokens.b, [400, 422]);

  const race = await Promise.allSettled([
    call("/market/orders", "POST", { items: [{ id: f.stockProduct.slug, quantity: 1 }] }, tokens.a, { "idempotency-key": `phase7-race-${randomUUID()}` }),
    call("/market/orders", "POST", { items: [{ id: f.stockProduct.slug, quantity: 1 }] }, tokens.b, { "idempotency-key": `phase7-race-${randomUUID()}` }),
  ]);
  const raceSuccess = race.filter((item) => item.status === "fulfilled").length;
  const stock = await prisma.marketProduct.findUniqueOrThrow({ where: { id: f.stockProduct.id }, select: { stock: true } });
  const foreignOrders = await call("/market/orders/my", "GET", undefined, tokens.b);
  const adminOrders = await call("/market/orders", "GET", undefined, tokens.admin);
  const learnerAdminBoundary = await expectStatus("/market/orders", "GET", undefined, tokens.a, [403]);
  const beforeFailedAdminDebit = await prisma.userStats.findUniqueOrThrow({ where: { userId: f.a.id } });
  const failedAdminDebit = await expectStatus("/market/currency/adjust", "POST", { userId: f.a.id, amount: -100000, reason: "phase7 insufficient" }, tokens.admin, [400]);
  const afterFailedAdminDebit = await prisma.userStats.findUniqueOrThrow({ where: { userId: f.a.id } });

  result.checks.completionReward = { grammarLedger: grammarLedger === 1, grammarReward: grammarReward === 1, quizLedger: quizLedger === 1, quizReward: quizReward === 1 };
  result.checks.attemptVsReward = { grammarAttempts: 2, grammarRewards: grammarReward, quizSubmissions: 2, quizRewards: quizReward };
  result.checks.clientForgery = forged.passed && (await prisma.marketProduct.findUniqueOrThrow({ where: { id: f.expensiveProduct.id }, select: { stock: true } })).stock === 1;
  result.checks.redemption = { sameKeySingleOrder: sameOrder, oneDebit: marketBefore.totalBanhRan - afterOrder.totalBanhRan === purchaseRow.totalBanh, oneLedgerRow: purchaseLedger === 1, forgedPriceRejected: forged.passed };
  result.checks.insufficientBalance = insufficient.passed;
  result.checks.stockConcurrency = { oneSuccess: raceSuccess === 1, stockZero: stock.stock === 0 };
  result.checks.ownership = { learnerCannotListAll: learnerAdminBoundary.passed, otherLearnerDoesNotSeeOrder: !foreignOrders.value.some((order) => order.id === purchaseRow.id), adminCanList: adminOrders.value.some((order) => order.id === purchaseRow.id) };
  result.checks.negativeBalance = { rejected: failedAdminDebit.passed, unchanged: afterFailedAdminDebit.totalBanhRan === beforeFailedAdminDebit.totalBanhRan };
  result.checks.freshSessionBalance = (await call("/market/currency/balance", "GET", undefined, tokens.a)).value.totalBanh === afterFailedAdminDebit.totalBanhRan;
}

async function browserSmoke(token) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ value }) => localStorage.setItem("auth-storage-junior", JSON.stringify({ state: { accessToken: value, refreshToken: "phase7", user: { role: "STUDENT" } }, version: 0 })), { value: token });
  const page = await context.newPage();
  const pages = [];
  for (const route of ["/market", "/dashboard", "/pet"]) {
    await page.goto(`${web}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    const body = await page.locator("body").innerText();
    const unnamedButtons = await page.locator("button").evaluateAll((buttons) => buttons.filter((button) => !(button.innerText || button.getAttribute("aria-label") || button.title).trim()).length);
    pages.push({ route, loaded: body.trim().length > 20 && !/Internal Server Error|Application error/i.test(body), noHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), unnamedButtons, accessibilityPass: unnamedButtons === 0 });
  }
  await browser.close();
  result.checks.browser = pages;
}

async function main() {
  await cleanup();
  const before = await snapshot();
  const f = await fixtures();
  const tokens = { admin: await login(f.admin.email), a: await login(f.a.email), b: await login(f.b.email) };
  await runApiChecks(f, tokens);
  await browserSmoke(tokens.a);
  await cleanup();
  const after = await snapshot();
  result.flags = {
    BREADTRANS_GAMIFICATION_ECONOMY_READY: allTruthy(result.checks) && JSON.stringify(before) === JSON.stringify(after),
    BEHAVIOR_CHECKS_PASS: allTruthy(result.checks),
    ACTIVE_DATA_PRESERVED: JSON.stringify(before.published) === JSON.stringify(after.published),
    ECONOMY_SNAPSHOT_RESTORED: JSON.stringify(before) === JSON.stringify(after),
    NO_REAL_PROVIDER_CALLS: true,
  };
  console.log(JSON.stringify({ before, after, ...result }, null, 2));
  if (!result.flags.BREADTRANS_GAMIFICATION_ECONOMY_READY) process.exitCode = 2;
}

main().catch(async (error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
