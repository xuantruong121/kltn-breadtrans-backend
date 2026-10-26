/**
 * Authentication and profile over HTTP, disposable harness only. SMTP is not
 * configured there, so the password-reset link is read from the harness
 * backend log (dev-only debug line); no email is sent.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { call, check, failureCount, newStudent } from './harness-api';

const LOG = join(
  process.env.HARNESS_WORK ??
    join(process.env.TEMP ?? '', 'breadtrans-harness'),
  'backend.log',
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n== Register / login');
  const email = `auth-${randomUUID().slice(0, 8)}@harness.local`;
  const password = `Harness-${randomUUID().slice(0, 6)}-Aa1!`;
  const weak = await call('POST', '/auth/register', undefined, {
    email,
    password: '123',
    fullName: 'Weak',
  });
  check(
    'a weak password is refused',
    weak.status === 400,
    `(status ${weak.status})`,
  );
  const badEmail = await call('POST', '/auth/register', undefined, {
    email: 'not-an-email',
    password,
    fullName: 'X',
  });
  check('an invalid email is refused', badEmail.status === 400);
  const reg = await call('POST', '/auth/register', undefined, {
    email,
    password,
    fullName: 'Auth Learner',
    role: 'ADMIN',
  });
  check('registration succeeds', reg.status < 300, `(status ${reg.status})`);
  const dup = await call('POST', '/auth/register', undefined, {
    email,
    password,
    fullName: 'Again',
  });
  check(
    'a duplicate email is refused (409)',
    dup.status === 409,
    `(status ${dup.status})`,
  );
  const wrong = await call('POST', '/auth/login', undefined, {
    email,
    password: `${password}x`,
  });
  check(
    'a wrong password is refused (401)',
    wrong.status === 401,
    `(status ${wrong.status})`,
  );
  const login = await call('POST', '/auth/login', undefined, {
    email,
    password,
  });
  const access = login.data?.access_token;
  const refresh = login.data?.refresh_token;
  const deviceId = login.data?.deviceId;
  check('login returns access and refresh tokens', !!access && !!refresh);
  check(
    'a role sent at registration is ignored',
    login.data?.user?.role === 'STUDENT',
    `(${login.data?.user?.role})`,
  );
  const adminRoute = await call('GET', '/admin/subscriptions', access);
  check(
    'a learner token cannot reach an Admin API',
    adminRoute.status === 403,
    `(status ${adminRoute.status})`,
  );
  const noToken = await call('GET', '/users/profile');
  check('protected routes need a token', noToken.status === 401);

  console.log('\n== Refresh / logout');
  const r1 = await call('POST', '/auth/refresh', access, {
    deviceId,
    refreshToken: refresh,
  });
  check(
    'refresh issues a new access token',
    r1.status < 300 && !!r1.data?.access_token,
    `(status ${r1.status} ${JSON.stringify(r1.message)})`,
  );
  const reuse = await call('POST', '/auth/refresh', access, {
    deviceId,
    refreshToken: refresh,
  });
  check(
    'a refresh token cannot be reused after rotation',
    reuse.status === 401 || reuse.status === 403,
    `(status ${reuse.status})`,
  );
  const out = await call('POST', '/auth/logout', r1.data?.access_token);
  check(
    'logout succeeds',
    out.status < 300,
    `(status ${out.status} ${JSON.stringify(out.message)})`,
  );
  const afterLogout = await call(
    'POST',
    '/auth/refresh',
    r1.data?.access_token,
    { deviceId, refreshToken: r1.data?.refresh_token },
  );
  check(
    'the refresh token is invalid after logout',
    afterLogout.status === 401,
    `(status ${afterLogout.status})`,
  );

  console.log('\n== Profile');
  const s = await newStudent('profile');
  const other = await newStudent('profile-other');
  const patch = await call('PATCH', '/users/profile', s.token, {
    fullName: 'Nguyễn Văn Test',
    phone: '0912345678',
    role: 'ADMIN',
  });
  check(
    'profile update succeeds',
    patch.status < 300,
    `(status ${patch.status} ${JSON.stringify(patch.message)})`,
  );
  const prof = await call('GET', '/users/profile', s.token);
  check(
    'the new name is persisted',
    JSON.stringify(prof.data).includes('Nguyễn Văn Test'),
  );
  const relog = await call('POST', '/auth/login', undefined, {
    email: s.email,
    password: s.password,
  });
  check(
    'a role in the profile body is ignored',
    relog.data?.user?.role === 'STUDENT',
    `(${relog.data?.user?.role})`,
  );
  const otherProf = await call('GET', '/users/profile', other.token);
  check(
    'profiles are per user',
    !JSON.stringify(otherProf.data).includes('Nguyễn Văn Test'),
  );

  console.log('\n== Change password');
  const badCurrent = await call('POST', '/auth/change-password', s.token, {
    currentPassword: 'nope',
    newPassword: `New-${randomUUID().slice(0, 6)}-Aa1!`,
  });
  check(
    'change-password needs the current password',
    badCurrent.status >= 400,
    `(status ${badCurrent.status})`,
  );
  const newPw = `New-${randomUUID().slice(0, 6)}-Aa1!`;
  const changed = await call('POST', '/auth/change-password', s.token, {
    currentPassword: s.password,
    newPassword: newPw,
  });
  check(
    'change-password succeeds',
    changed.status < 300,
    `(status ${changed.status} ${JSON.stringify(changed.message)})`,
  );
  check(
    'the old password stops working',
    (
      await call('POST', '/auth/login', undefined, {
        email: s.email,
        password: s.password,
      })
    ).status === 401,
  );
  check(
    'the new password works',
    (
      await call('POST', '/auth/login', undefined, {
        email: s.email,
        password: newPw,
      })
    ).status < 300,
  );

  console.log('\n== Forgot / reset password');
  const unknown = await call('POST', '/auth/forgot-password', undefined, {
    email: `nobody-${randomUUID().slice(0, 6)}@harness.local`,
  });
  const known = await call('POST', '/auth/forgot-password', undefined, {
    email: other.email,
  });
  check(
    'forgot-password answers the same for unknown and known emails (no account enumeration)',
    unknown.status === known.status &&
      JSON.stringify(unknown.data) === JSON.stringify(known.data),
    `(${unknown.status}/${known.status})`,
  );
  await sleep(1500);
  const lines = readFileSync(LOG, 'utf8')
    .split('\n')
    .filter((l) => l.includes(`Password reset URL for ${other.email}`));
  const token = /token=([A-Za-z0-9._~-]+)/.exec(lines.at(-1) ?? '')?.[1];
  if (!token) {
    check(
      'reset link available from the dev log',
      false,
      '(debug line not found; NOT_VERIFIED)',
    );
  } else {
    const resetPw = `Reset-${randomUUID().slice(0, 6)}-Aa1!`;
    const reset = await call('POST', '/auth/reset-password', undefined, {
      token,
      newPassword: resetPw,
    });
    check(
      'reset with the emailed token succeeds',
      reset.status < 300,
      `(status ${reset.status} ${JSON.stringify(reset.message)})`,
    );
    const reuseReset = await call('POST', '/auth/reset-password', undefined, {
      token,
      newPassword: `Again-${randomUUID().slice(0, 6)}-Aa1!`,
    });
    check(
      'the reset token is single-use',
      reuseReset.status >= 400,
      `(status ${reuseReset.status})`,
    );
    check(
      'login works with the reset password',
      (
        await call('POST', '/auth/login', undefined, {
          email: other.email,
          password: resetPw,
        })
      ).status < 300,
    );
  }

  console.log(`\nAUTH_API_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
