/**
 * Database safety guard — runs BEFORE any Prisma command that needs a
 * disposable shadow database (`migrate dev`, `migrate diff`, `migrate reset`).
 *
 * Incident this prevents (2026-10-23): the real development DATABASE_URL was
 * passed as `--shadow-database-url`. Prisma treats a shadow database as
 * disposable, so it reset the real development database and destroyed all
 * development data. Configuration alone was not enough to stop that, because
 * the dangerous value was supplied on the command line.
 *
 * Usage:
 *   ts-node scripts/db-safety-guard.ts            # validate env config
 *   ts-node scripts/db-safety-guard.ts --argv ... # also scan a command line
 *
 * Exits non-zero and prints a loud, credential-free explanation on failure.
 */
import 'dotenv/config';

type Target = {
  raw: string;
  host: string;
  port: string;
  database: string;
};

/** Expected local development topology (docker-compose.yml). */
const EXPECTED = {
  devPorts: ['5432'],
  devDatabase: 'kltn_db',
  shadowPorts: ['5433'],
  shadowDatabase: 'kltn_shadow',
  localHosts: ['localhost', '127.0.0.1', '::1', 'postgres', 'postgres-shadow'],
};

/** Never prints user/password — only host, port and database name. */
function parseTarget(url: string | undefined, label: string): Target {
  if (!url || !url.trim())
    fail([`${label} is not set.`, 'A disposable shadow database is required.']);
  const value: string = url;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail([`${label} is not a valid connection URL.`]);
  }
  return {
    raw: value,
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: parsed.pathname.replace(/^\//, ''),
  };
}

function describe(target: Target) {
  return `${target.host}:${target.port} / ${target.database}`;
}

function fail(lines: string[]): never {
  console.error('');
  console.error('==================================================');
  console.error(' DATABASE SAFETY CHECK FAILED');
  console.error('==================================================');
  for (const line of lines) console.error(` ${line}`);
  console.error('');
  console.error(' REFUSING TO RUN THE PRISMA MIGRATION COMMAND.');
  console.error(' See docs/database-safety.md');
  console.error('==================================================');
  console.error('');
  process.exit(1);
}

export function assertDatabaseSafety(argv: string[] = []) {
  const dev = parseTarget(process.env.DATABASE_URL, 'DATABASE_URL');
  const shadow = parseTarget(
    process.env.SHADOW_DATABASE_URL,
    'SHADOW_DATABASE_URL',
  );

  // 1. Byte-identical URLs.
  if (dev.raw.trim() === shadow.raw.trim())
    fail([
      'DATABASE_URL and SHADOW_DATABASE_URL are the same value.',
      `DATABASE_URL:        ${describe(dev)}`,
      `SHADOW_DATABASE_URL: ${describe(shadow)}`,
      'Prisma resets the shadow database — this would destroy development data.',
    ]);

  // 2. Same host + port + database (different credentials/params still fatal).
  if (
    dev.host === shadow.host &&
    dev.port === shadow.port &&
    dev.database === shadow.database
  )
    fail([
      'DATABASE_URL and SHADOW_DATABASE_URL resolve to the same database.',
      `DATABASE_URL:        ${describe(dev)}`,
      `SHADOW_DATABASE_URL: ${describe(shadow)}`,
      'The shadow database must be a separate, disposable database.',
    ]);

  // 3. Shadow must not be the known development database name.
  if (shadow.database === EXPECTED.devDatabase)
    fail([
      `SHADOW_DATABASE_URL points at the development database "${EXPECTED.devDatabase}".`,
      `SHADOW_DATABASE_URL: ${describe(shadow)}`,
      `Expected a disposable database such as "${EXPECTED.shadowDatabase}".`,
    ]);

  // 4. Development target must look like the expected local Docker dev DB.
  if (!EXPECTED.localHosts.includes(dev.host))
    fail([
      'DATABASE_URL does not point at a local development host.',
      `DATABASE_URL: ${describe(dev)}`,
      'Migration-development commands must never target remote databases.',
    ]);
  if (dev.database !== EXPECTED.devDatabase)
    fail([
      `DATABASE_URL database is "${dev.database}", expected "${EXPECTED.devDatabase}".`,
      `DATABASE_URL: ${describe(dev)}`,
      'Refusing to run migration-development commands on an unexpected database.',
    ]);

  // 5. Shadow target must also be local and on its own expected port.
  if (!EXPECTED.localHosts.includes(shadow.host))
    fail([
      'SHADOW_DATABASE_URL does not point at a local host.',
      `SHADOW_DATABASE_URL: ${describe(shadow)}`,
    ]);
  if (!EXPECTED.shadowPorts.includes(shadow.port) && shadow.port === dev.port)
    fail([
      'SHADOW_DATABASE_URL shares the development port and is not the expected shadow port.',
      `DATABASE_URL:        ${describe(dev)}`,
      `SHADOW_DATABASE_URL: ${describe(shadow)}`,
      `Expected shadow port ${EXPECTED.shadowPorts.join(' or ')} (kltn-postgres-shadow).`,
    ]);

  // 6. Reject a dangerous --shadow-database-url on the forwarded command line.
  const joined = argv.join(' ');
  const flagMatch = /--shadow-database-url[= ]+("?)([^"\s]+)\1/.exec(joined);
  if (flagMatch) {
    const supplied = parseTarget(flagMatch[2], '--shadow-database-url');
    if (
      supplied.raw.trim() === dev.raw.trim() ||
      (supplied.host === dev.host &&
        supplied.port === dev.port &&
        supplied.database === dev.database)
    )
      fail([
        '--shadow-database-url was given the real development database.',
        `--shadow-database-url: ${describe(supplied)}`,
        `DATABASE_URL:          ${describe(dev)}`,
        'This is exactly the 2026-10-23 incident. Never do this.',
      ]);
  }
  if (/\$DATABASE_URL|\$\{DATABASE_URL\}|%DATABASE_URL%/.test(joined))
    fail([
      'The command line expands DATABASE_URL into a shadow/disposable argument.',
      'Use SHADOW_DATABASE_URL (kltn-postgres-shadow) instead.',
    ]);

  console.log('DATABASE SAFETY CHECK PASSED');
  console.log(`  DATABASE_URL        -> ${describe(dev)}`);
  console.log(`  SHADOW_DATABASE_URL -> ${describe(shadow)}`);
  console.log('  same target         -> false');
}

if (require.main === module) {
  const argvIndex = process.argv.indexOf('--argv');
  assertDatabaseSafety(argvIndex >= 0 ? process.argv.slice(argvIndex + 1) : []);
}
