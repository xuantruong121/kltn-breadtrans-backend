/**
 * P0 evidence: a URL that passes the static checks but reaches the protected
 * cluster through another address must be refused by cluster identity. The
 * only queries issued are read-only SELECTs of current_database() and
 * pg_control_system(). Credentials are taken from .env and never printed.
 *
 * Usage: npx ts-node --transpile-only scripts/audit/p0-alias-refusal-check.ts <host> <database>
 */
import { readFileSync } from 'node:fs';

import { parse } from 'dotenv';

import {
  assessDatabaseUrl,
  redactUrl,
} from '../../test/safety/test-target-guard';
import {
  verifyDatabaseTarget,
  verifyRedisTarget,
} from '../../test/safety/target-identity';

async function main() {
  const [host, database] = process.argv.slice(2);
  const real = new URL(parse(readFileSync('.env')).DATABASE_URL);
  const alias = new URL(real.toString());
  alias.hostname = host;
  alias.port = '5432';
  alias.pathname = `/${database}`;
  alias.search = '';
  const aliasUrl = alias.toString();
  console.log(`alias target: ${redactUrl(aliasUrl)}`);
  console.log(`static check: ${JSON.stringify(assessDatabaseUrl(aliasUrl))}`);
  const verdict = await verifyDatabaseTarget(aliasUrl);
  console.log(
    `identity check: ${JSON.stringify({ ok: verdict.ok, reason: (verdict as any).reason, database: verdict.identity?.database })}`,
  );
  const redisAlias = `redis://${host}:6379`;
  console.log(
    `redis ${redisAlias}: ${JSON.stringify(await verifyRedisTarget(redisAlias))}`,
  );
  process.exit(verdict.ok ? 1 : 0);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
