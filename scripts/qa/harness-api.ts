/**
 * Minimal HTTP client for the disposable harness backend (:3101 only).
 * Unwraps the TransformInterceptor envelope `{ statusCode, message, data }`.
 */
import { randomUUID } from 'node:crypto';

export const BE = 'http://localhost:3101';

export type ApiResult<T = any> = { status: number; data: T; message: unknown };

export async function call<T = any>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const res = await fetch(BE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  const data =
    json && typeof json === 'object' && 'data' in json && 'statusCode' in json
      ? json.data
      : json;
  return { status: res.status, data, message: json?.message };
}

export async function newStudent(label = 'api'): Promise<{
  email: string;
  password: string;
  token: string;
  userId: number;
}> {
  // Registration stores the address lower-cased; the ADMIN promotion below
  // matches on it, so a label with capitals must not miss.
  const email =
    `${label}-${randomUUID().slice(0, 8)}@harness.local`.toLowerCase();
  const password = `Harness-${randomUUID().slice(0, 8)}-Aa1!`;
  const reg = await call('POST', '/auth/register', undefined, {
    email,
    password,
    fullName: `Harness ${label}`,
  });
  if (reg.status >= 300) throw new Error(`register ${reg.status}`);
  const login = await call('POST', '/auth/login', undefined, {
    email,
    password,
  });
  if (login.status >= 300) throw new Error(`login ${login.status}`);
  const token = login.data?.accessToken ?? login.data?.access_token;
  const userId = login.data?.user?.id;
  if (!token)
    throw new Error(
      `no token in login response: ${Object.keys(login.data ?? {}).join(',')}`,
    );
  return { email, password, token, userId };
}

let failures = 0;
export function check(name: string, cond: boolean, detail = ''): boolean {
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`,
  );
  if (!cond) failures += 1;
  return cond;
}
export const failureCount = () => failures;

/** A harness ADMIN: registered normally, then promoted in the disposable clone. */
export async function newAdmin(label = 'admin') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { harnessExec } = require('./harness-db');
  const s = await newStudent(label);
  harnessExec(`update "User" set role = 'ADMIN' where email = '${s.email}'`);
  const login = await call('POST', '/auth/login', undefined, {
    email: s.email,
    password: s.password,
  });
  return { ...s, token: login.data.accessToken ?? login.data.access_token };
}

/** A harness STUDENT with an active PRO plan, granted through the Admin API. */
export async function newProStudent(label = 'pro') {
  const admin = await newAdmin(`${label}-granter`);
  const s = await newStudent(label);
  const grant = await call('POST', '/admin/subscriptions/grant', admin.token, {
    studentId: s.userId,
    planVersionId: 1,
    durationDays: 30,
    reason: 'Harness QA access',
  });
  if (grant.status >= 300)
    throw new Error(`grant ${grant.status} ${JSON.stringify(grant.message)}`);
  return { ...s, admin };
}

let planGranter: Awaited<ReturnType<typeof newAdmin>> | null = null;

/**
 * Puts a harness learner on a paid plan through the Admin API (the current
 * published 30-day version of the plan). Suites about plan benefits need a
 * learner on a known plan: revisions, AI gradings a day, TOEIC S&W exams.
 */
export async function grantPlan(
  userId: number,
  code: 'PLUS' | 'PRO',
  durationDays = 30,
) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { harnessQuery } = require('./harness-db');
  const planVersionId = Number(
    harnessQuery(
      `select v.id from "PlanVersion" v join "Plan" p on p.id = v."planId" where p.code = '${code}' and v."durationDays" = 30 and v.status = 'PUBLISHED' order by v.id desc limit 1`,
    )[0]?.[0],
  );
  planGranter ??= await newAdmin('plan-granter');
  const grant = await call(
    'POST',
    '/admin/subscriptions/grant',
    planGranter.token,
    {
      studentId: userId,
      planVersionId,
      durationDays,
      reason: 'Harness QA access',
    },
  );
  if (grant.status >= 300)
    throw new Error(`grant ${grant.status} ${JSON.stringify(grant.message)}`);
}

/**
 * Opens every practice level for a harness learner (fixture only). Suites
 * written before the level lock pick B1-C1 content for a fresh learner, which
 * the lock now refuses by design; they open the levels first.
 */
export function unlockAllLevels(userId: number) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { harnessExec } = require('./harness-db');
  harnessExec(
    `insert into "LearnerSkillLevel" ("userId", skill, level, "unlockedLevel", source, "updatedAt")
     select ${Number(userId)}, s::"PracticeSkill", 'ADVANCED', 'ADVANCED', 'SELF', now()
     from unnest(array['LISTENING','READING','SPEAKING','WRITING']) s
     on conflict ("userId", skill) do update set level = 'ADVANCED', "unlockedLevel" = 'ADVANCED', "updatedAt" = now()`,
  );
}

/**
 * The published TOEIC 4 Skills assessment and the L&R exam it uses. Suites
 * once hard-coded assessment 2, which was archived on 2026-11-02.
 */
export function fourSkillsAssessment(): { id: number; lrExamId: number } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { harnessQuery } = require('./harness-db');
  const row = harnessQuery(
    `select a.id, c."lrExamSetId" from "ToeicAssessment" a
     join "ToeicAssessmentComponent" c on c."assessmentId" = a.id and c.kind = 'LISTENING_READING'
     where a."productFamily" = 'TOEIC_4_SKILLS' and a."publicationStatus" = 'PUBLISHED'
     order by a.id desc limit 1`,
  )[0];
  if (!row) throw new Error('no published TOEIC 4 Skills assessment');
  return { id: Number(row[0]), lrExamId: Number(row[1]) };
}

/** A harness learner who has finished onboarding, so /dashboard opens. */
export async function onboard(token: string) {
  return call('PUT', '/learning-path/profile', token, {
    onboarded: true,
    goal: 'GENERAL',
    track: 'GENERAL',
    minutesPerDay: 15,
  });
}
