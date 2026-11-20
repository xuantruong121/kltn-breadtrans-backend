/**
 * Pet Bun over HTTP, disposable harness only (:3101): locked before purchase,
 * selectable after it, never bought twice (owner 2026-11-19).
 */
import { randomUUID } from 'node:crypto';

import { call, check, failureCount, newStudent } from './harness-api';
import { harnessExec } from './harness-db';

async function balance(token: string): Promise<number> {
  const r = await call('GET', '/market/currency/balance', token);
  return Number(r.data?.totalBanh);
}

/** Funds the learner straight in the disposable clone (harnessExec refuses kltn_db). */
function fund(userId: number, amount: number) {
  harnessExec(
    `insert into "UserStats" ("userId", "totalBanhRan") values (${userId}, ${amount})
     on conflict ("userId") do update set "totalBanhRan" = "UserStats"."totalBanhRan" + ${amount}`,
    process.env.HARNESS_DB ?? 'dev_qa',
  );
}

const order = (token: string, items: unknown[], key = randomUUID()) =>
  call('POST', '/market/orders', token, { items }, { 'idempotency-key': key });

const switchTo = (token: string, petName: string) =>
  call('POST', '/gamification/pet/change-type', token, { petName });

async function main() {
  console.log('\n== Pet Bun');
  const s = await newStudent('bun-a');
  await call('GET', '/gamification/pet', s.token); // creates the pet
  await call('GET', '/market/currency/balance', s.token); // creates the stats row
  fund(s.userId, 1200);

  const locked = await switchTo(s.token, 'petbun');
  check(
    'Bun cannot be chosen before it is bought',
    locked.status === 403,
    `(status ${locked.status})`,
  );

  const before = await balance(s.token);
  const bought = await order(s.token, [{ id: 'pet-bun', quantity: 1 }]);
  check(
    'buying Pet Bun succeeds and costs 500',
    bought.status < 300 && (await balance(s.token)) === before - 500,
    `(status ${bought.status})`,
  );

  const inv = await call('GET', '/market/inventory', s.token);
  check(
    'the inventory lists pet-bun',
    inv.data?.ownedSlugs?.includes('pet-bun'),
    `(${inv.data?.ownedSlugs?.join(',')})`,
  );

  const switched = await switchTo(s.token, 'petbun');
  const pet = await call('GET', '/gamification/pet', s.token);
  check(
    'after buying, switching to Bun works',
    switched.status < 300 && pet.data?.name === 'petbun',
    `(status ${switched.status}, name ${pet.data?.name})`,
  );

  const afterFirst = await balance(s.token);
  const again = await order(s.token, [{ id: 'pet-bun', quantity: 1 }]);
  check(
    'a second Pet Bun is refused and costs nothing',
    again.status === 400 && (await balance(s.token)) === afterFirst,
    `(status ${again.status}, ${JSON.stringify(again.message)})`,
  );

  const back = await switchTo(s.token, 'bready');
  check(
    'switching back to Bready still works',
    back.status < 300,
    `(status ${back.status})`,
  );

  const t = await newStudent('bun-b');
  await call('GET', '/market/currency/balance', t.token);
  fund(t.userId, 1200);
  const tBefore = await balance(t.token);
  const two = await order(t.token, [{ id: 'pet-bun', quantity: 2 }]);
  check(
    'two Pet Bun in one order are refused, no debit',
    two.status === 400 && (await balance(t.token)) === tBefore,
    `(status ${two.status})`,
  );

  const named = await switchTo(t.token, 'Bun');
  check(
    'a pet named "Bun" is not the bought Bun (no 403)',
    named.status < 300,
    `(status ${named.status})`,
  );

  console.log(`\npet-bun failures: ${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}

void main();
