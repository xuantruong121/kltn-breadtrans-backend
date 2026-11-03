/**
 * Re-run of UTCID07 (UT Lab 4, DEF-01): an admin creates an account with an
 * email that already exists. Expected HTTP 409 and "Email đã tồn tại".
 *
 * Usage: HARNESS_DB=<db> npx ts-node --transpile-only scripts/qa/def01-rerun.ts
 */
import { call, check, failureCount, newAdmin } from './harness-api';
import { harnessQuery } from './harness-db';

async function main() {
  const admin = await newAdmin('def01');
  const email = `def01-${Date.now()}@harness.local`;
  const body = {
    email,
    password: 'Password123',
    role: 'STUDENT',
    fullName: 'Học viên DEF01',
  };

  const first = await call('POST', '/admin/users', admin.token, body);
  check(
    'the first account is created',
    first.status === 201 || first.status === 200,
    String(first.status),
  );

  const second = await call('POST', '/admin/users', admin.token, body);
  const message = JSON.stringify(second.data ?? '');
  check(
    'a taken email answers HTTP 409',
    second.status === 409,
    String(second.status),
  );
  check(
    'the message says the email exists',
    message.includes('Email đã tồn tại'),
    message.slice(0, 160),
  );

  const rows = harnessQuery(
    `select count(*) from "User" where email = '${email}'`,
  )[0]?.[0];
  check('only one account holds the email', rows === '1', rows);
  console.log(`failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
