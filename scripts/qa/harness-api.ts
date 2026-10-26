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
  const email = `${label}-${randomUUID().slice(0, 8)}@harness.local`;
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
