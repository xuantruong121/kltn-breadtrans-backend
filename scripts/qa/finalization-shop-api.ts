/**
 * Bánh Mì shop and pet over HTTP, disposable harness only. Balances are
 * funded through the existing Admin adjust endpoint in the clone.
 */
import { randomUUID } from 'node:crypto';

import { call, check, failureCount, newAdmin, newStudent } from './harness-api';
import { harnessQuery } from './harness-db';

async function balance(token: string): Promise<number> {
  const r = await call('GET', '/market/currency/balance', token);
  return Number(r.data?.totalBanh);
}

async function fund(adminToken: string, userId: number, amount: number) {
  const r = await call('POST', '/market/currency/adjust', adminToken, {
    userId,
    amount,
    reason: 'Harness QA funding',
    idempotencyKey: randomUUID(),
  });
  if (r.status >= 300)
    throw new Error(`fund ${r.status} ${JSON.stringify(r.message)}`);
}

const order = (token: string, items: unknown[], key = randomUUID()) =>
  call('POST', '/market/orders', token, { items }, { 'idempotency-key': key });

async function main() {
  console.log('\n== Shop');
  const admin = await newAdmin('shop-admin');
  const a = await newStudent('shop-a');
  const b = await newStudent('shop-b');
  const start = await balance(a.token);
  await fund(admin.token, a.userId, 1000);
  check(
    'admin funding is reflected in the balance',
    (await balance(a.token)) === start + 1000,
    `(${start} -> ${await balance(a.token)})`,
  );

  const noKey = await call('POST', '/market/orders', a.token, {
    items: [{ id: 'streak-freeze', quantity: 1 }],
  });
  check(
    'an order without an Idempotency-Key is refused',
    noKey.status === 400,
    `(status ${noKey.status})`,
  );

  const key = randomUUID();
  const freeze = await order(
    a.token,
    [{ id: 'streak-freeze', quantity: 1, price: 1 }],
    key,
  );
  check(
    'buying Streak Freeze charges the catalog price, not the client price',
    freeze.status < 300 && freeze.data.totalBanh === 250,
    `(status ${freeze.status}, charged ${freeze.data?.totalBanh})`,
  );
  const retry = await order(
    a.token,
    [{ id: 'streak-freeze', quantity: 1 }],
    key,
  );
  check(
    'a retry with the same key does not charge again',
    retry.data?.orderId === freeze.data.orderId &&
      (await balance(a.token)) === start + 750,
    `(balance ${await balance(a.token)})`,
  );
  const [stats] = harnessQuery(
    `select "streakFreezes" from "UserStats" where "userId" = ${a.userId}`,
  );
  check(
    'Streak Freeze is credited once',
    stats?.[0] === '1',
    `(${stats?.[0]})`,
  );

  const boostBefore = Date.now();
  const boost = await order(a.token, [{ id: 'double-bread', quantity: 1 }]);
  const [until] = harnessQuery(
    `select extract(epoch from "doubleBanhUntil") from "UserStats" where "userId" = ${a.userId}`,
  );
  const hoursGranted = (Number(until?.[0]) * 1000 - boostBefore) / 3_600_000;
  check(
    'the 24h boost lasts about 24 hours',
    boost.status < 300 && hoursGranted > 23.9 && hoursGranted < 24.1,
    `(${hoursGranted.toFixed(2)} h)`,
  );

  const tooExpensive = await order(a.token, [
    { id: 'gift-voucher', quantity: 1 },
  ]);
  check(
    'an item above the balance is refused',
    tooExpensive.status >= 400,
    `(status ${tooExpensive.status})`,
  );
  const physical = await order(a.token, [{ id: 'gift-notebook', quantity: 1 }]);
  check(
    'a physical gift needs a shipping profile',
    physical.status === 422 || physical.status === 400,
    `(status ${physical.status})`,
  );
  const duplicateLines = harnessQuery(
    `select stock from "MarketProduct" where slug = 'frame-crown'`,
  )[0][0];
  check('catalog stock is readable', Number(duplicateLines) > 0);

  console.log('\n== Shop: concurrency');
  await fund(admin.token, b.userId, 500);
  const before = await balance(b.token);
  const racers = await Promise.all([
    order(b.token, [{ id: 'pet-bun', quantity: 1 }]),
    order(b.token, [{ id: 'pet-bun', quantity: 1 }]),
    order(b.token, [{ id: 'pet-bun', quantity: 1 }]),
  ]);
  const wins = racers.filter((r) => r.status < 300).length;
  check(
    'three concurrent 500-Bánh Mì orders on a 500 balance: exactly one succeeds',
    wins === 1 && (await balance(b.token)) === before - 500,
    `(wins ${wins}, balance ${await balance(b.token)})`,
  );

  const inv = await call('GET', '/market/inventory', a.token);
  check(
    'inventory lists the bought items with their slugs',
    inv.data?.ownedSlugs?.includes('streak-freeze') &&
      inv.data?.ownedSlugs?.includes('double-bread'),
    `(${inv.data?.ownedSlugs?.join(',')})`,
  );
  const theirs = await call('GET', '/market/orders/my', b.token);
  const theirOrders: any[] = Array.isArray(theirs.data)
    ? theirs.data
    : (theirs.data?.items ?? []);
  check(
    "a learner's order list contains only their own orders",
    theirOrders.every((o) => o.userId === b.userId),
    `(${theirOrders.length})`,
  );

  console.log('\n== Pet');
  const pet = await call('GET', '/gamification/pet', a.token);
  check('pet loads', pet.status === 200);
  const pre = await balance(a.token);
  const feed = await call('POST', '/gamification/pet/feed', a.token);
  const post = await balance(a.token);
  check(
    'feeding spends Bánh Mì (or is refused with a reason, never charged)',
    (feed.status < 300 && post < pre) || (feed.status >= 400 && post === pre),
    `(status ${feed.status} ${JSON.stringify(feed.message)}, ${pre} -> ${post})`,
  );
  const broke = await newStudent('shop-broke');
  const brokeBalance = await balance(broke.token);
  if (brokeBalance === 0) {
    const brokeFeed = await call('POST', '/gamification/pet/feed', broke.token);
    check(
      'feeding with 0 Bánh Mì is refused and the balance stays 0',
      brokeFeed.status >= 400 && (await balance(broke.token)) === 0,
      `(status ${brokeFeed.status})`,
    );
  }
  const studentAdjust = await call('POST', '/market/currency/adjust', a.token, {
    userId: a.userId,
    amount: 9999,
    reason: 'x',
    idempotencyKey: randomUUID(),
  });
  check(
    'a learner cannot credit their own balance',
    studentAdjust.status === 403,
    `(status ${studentAdjust.status})`,
  );

  console.log(`\nSHOP_API_FAILURES=${failureCount()}`);
  process.exit(failureCount() ? 1 : 0);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
