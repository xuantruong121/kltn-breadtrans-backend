require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const active = process.argv[2] === 'active';
(async () => {
  const row = await p.subscription.update({ where: { id: 114 }, data: { status: active ? 'ACTIVE' : 'EXPIRED', endsAt: active ? new Date(Date.now() + 60 * 60 * 1000) : new Date() } });
  console.log(JSON.stringify({ id: row.id, status: row.status, endsAt: row.endsAt }));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => p.$disconnect());
