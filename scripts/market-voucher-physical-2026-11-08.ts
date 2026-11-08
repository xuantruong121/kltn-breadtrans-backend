/**
 * Owner decision 2026-11-08: the Phúc Long 30K voucher is a real gift card,
 * so it waits for an admin like the physical gifts instead of being approved
 * at once as a digital item. prisma/seed.ts already says PHYSICAL; this
 * changes the one existing MarketProduct row. Orders already placed are
 * listed and left as they are.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/market-voucher-physical-2026-11-08.ts <dryrun|apply> --target <url|env:DATABASE_URL>
 * dryrun writes nothing. apply needs MARKET_VOUCHER_AUTHORIZED=physical.
 * Take a backup (npm run db:backup) before apply on kltn_db.
 */
import { PrismaClient } from '@prisma/client';

const SLUG = 'gift-voucher';

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const mode = process.argv[2];
  const i = process.argv.indexOf('--target');
  const target = i > 0 ? process.argv[i + 1] : undefined;
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url || !['dryrun', 'apply'].includes(mode ?? ''))
    throw new Error('usage: <dryrun|apply> --target <url|env:DATABASE_URL>');
  if (mode === 'apply' && process.env.MARKET_VOUCHER_AUTHORIZED !== 'physical')
    throw new Error('REFUSED: MARKET_VOUCHER_AUTHORIZED=physical not set');

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const where = new URL(url);
    console.log(
      `TARGET=${where.hostname}:${where.port}${where.pathname} MODE=${mode}`,
    );
    const product = await prisma.marketProduct.findUnique({
      where: { slug: SLUG },
      select: { id: true, name: true, price: true, fulfillmentType: true },
    });
    if (!product) {
      console.log(`PRODUCT_FOUND=false (${SLUG}); nothing to do`);
      return;
    }
    console.log(
      `PRODUCT id=${product.id} "${product.name}" price=${product.price} fulfillmentType=${product.fulfillmentType}`,
    );
    const orders = await prisma.$queryRaw<
      { id: number; status: string; createdAt: Date }[]
    >`SELECT id, status, "createdAt" FROM "MarketOrder"
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(items::jsonb) item
        WHERE item->>'productId' = ${String(product.id)} OR item->>'slug' = ${SLUG}
      )
      ORDER BY id`;
    console.log(`EXISTING_VOUCHER_ORDERS=${orders.length} (left unchanged)`);
    for (const o of orders)
      console.log(
        `  order ${o.id} ${o.status} ${o.createdAt.toISOString().slice(0, 10)}`,
      );

    const change = product.fulfillmentType !== 'PHYSICAL';
    console.log(`ROWS_TO_UPDATE=${change ? 1 : 0}`);
    if (mode === 'dryrun' || !change) {
      console.log(
        `WRITES=0 (${mode === 'dryrun' ? 'dryrun' : 'already PHYSICAL'})`,
      );
      return;
    }
    const updated = await prisma.marketProduct.updateMany({
      where: { id: product.id, fulfillmentType: product.fulfillmentType },
      data: { fulfillmentType: 'PHYSICAL' },
    });
    if (updated.count !== 1)
      throw new Error(`ABORT: updated ${updated.count}, expected 1`);
    console.log('APPLIED fulfillmentType=PHYSICAL rows=1');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
