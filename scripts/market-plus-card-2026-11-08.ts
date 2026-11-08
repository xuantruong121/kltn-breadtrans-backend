/**
 * Owner decision 2026-11-08: the Phúc Long voucher could not be supplied to a
 * learner who bought it, so shop product 10 becomes "Thẻ 7 ngày Plus", which
 * the system fulfils itself (market.service adds the days at checkout).
 * prisma/seed.ts already holds the new product; this changes the one existing
 * row in place, keeping its id, price and order. Orders already placed for the
 * voucher are listed and the run stops if there are any, since their history
 * would then name a different product.
 *
 * Run it only after the code with the Plus card effect is live and migration
 * 20261108160000_market_plus_card is deployed: before that, a learner could
 * pay for a card that gives nothing.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/market-plus-card-2026-11-08.ts <dryrun|apply> --target <url|env:DATABASE_URL>
 * dryrun writes nothing. apply needs MARKET_PLUS_CARD_AUTHORIZED=apply.
 * Take a backup (npm run db:backup) before apply on kltn_db.
 */
import { PrismaClient } from '@prisma/client';

const ID = 10;
const FROM_SLUG = 'gift-voucher';
const TO = {
  slug: 'plus-7d',
  name: 'Thẻ 7 ngày Plus',
  description:
    'Chưa có gói: dùng Plus 7 ngày từ lúc đổi. Đang có gói Plus hoặc Pro: cộng thêm 7 ngày vào gói hiện tại.',
  category: 'BOOST',
  rarity: 'LEGENDARY',
  imageUrl: '/images/market/plus-7d.svg',
  stock: 100,
  fulfillmentType: 'DIGITAL',
  isActive: true,
} as const;

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const mode = process.argv[2];
  const i = process.argv.indexOf('--target');
  const target = i > 0 ? process.argv[i + 1] : undefined;
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url || !['dryrun', 'apply'].includes(mode ?? ''))
    throw new Error('usage: <dryrun|apply> --target <url|env:DATABASE_URL>');
  if (mode === 'apply' && process.env.MARKET_PLUS_CARD_AUTHORIZED !== 'apply')
    throw new Error('REFUSED: MARKET_PLUS_CARD_AUTHORIZED=apply not set');

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const where = new URL(url);
    console.log(
      `TARGET=${where.hostname}:${where.port}${where.pathname} MODE=${mode}`,
    );
    const product = await prisma.marketProduct.findUnique({
      where: { id: ID },
    });
    if (!product) throw new Error(`STOP: product ${ID} not found`);
    console.log(
      `PRODUCT id=${product.id} slug=${product.slug} "${product.name}" price=${product.price} fulfillmentType=${product.fulfillmentType}`,
    );
    if (product.slug === TO.slug) {
      console.log('ROWS_TO_UPDATE=0 WRITES=0 (already the Plus card)');
      return;
    }
    if (product.slug !== FROM_SLUG)
      throw new Error(
        `STOP: product ${ID} is ${product.slug}, not ${FROM_SLUG}`,
      );
    const taken = await prisma.marketProduct.findUnique({
      where: { slug: TO.slug },
    });
    if (taken) throw new Error(`STOP: slug ${TO.slug} is product ${taken.id}`);

    const orders = await prisma.$queryRaw<{ id: number; status: string }[]>`
      SELECT id, status FROM "MarketOrder"
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(items::jsonb) item
        WHERE item->>'productId' = ${String(ID)} OR item->>'slug' = ${FROM_SLUG}
      )
      ORDER BY id`;
    console.log(`EXISTING_VOUCHER_ORDERS=${orders.length}`);
    for (const o of orders) console.log(`  order ${o.id} ${o.status}`);
    if (orders.length)
      throw new Error('STOP: voucher orders exist; settle them first');

    console.log('ROWS_TO_UPDATE=1');
    if (mode === 'dryrun') {
      console.log('WRITES=0 (dryrun)');
      return;
    }
    const updated = await prisma.marketProduct.updateMany({
      where: { id: ID, slug: FROM_SLUG },
      data: TO,
    });
    if (updated.count !== 1)
      throw new Error(`ABORT: updated ${updated.count}, expected 1`);
    console.log(`APPLIED product ${ID} -> ${TO.slug} rows=1`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
