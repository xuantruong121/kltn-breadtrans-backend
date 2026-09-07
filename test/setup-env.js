// jest globalSetup: loads .env.test and performs two-layer safety check before
// any E2E test module is required.
// Plain JS — no TypeScript lint rules apply here.
const path = require('path');
const fs   = require('fs');

const envPath = path.resolve(__dirname, '../.env.test');

// --- Layer 0: file existence ---
if (!fs.existsSync(envPath)) {
  throw new Error(
    '[setup-env] .env.test not found at ' + envPath + '\n' +
    'Create it from .env.test.example before running E2E tests.\n' +
    'DATABASE_URL must point to kltn_test_db.'
  );
}

const result = require('dotenv').config({ path: envPath, override: true });
if (result.error) {
  throw new Error('[setup-env] Failed to parse .env.test: ' + result.error.message);
}

// --- Layer 1: URL string check (fast, pre-connection) ---
const url = process.env.DATABASE_URL || '';
const urlOk =
  (url.includes('localhost') || url.includes('127.0.0.1')) &&
  url.includes('5432') &&
  url.includes('kltn_test_db');

if (!urlOk) {
  throw new Error(
    '[setup-env] DATABASE_URL does not satisfy safety requirements after loading .env.test.\n' +
    'Must contain: localhost/127.0.0.1, 5432, kltn_test_db.\n' +
    'Loaded URL: ' + url.replace(/:[^:@]+@/, ':***@')
  );
}

// --- Layer 2: Live DB query — current_database() and current_schema() ---
// Prevents URL-string spoofing: confirms we are actually connected to kltn_test_db/public.
module.exports = async () => {
  const { PrismaClient } = require('@prisma/client');
  const fuseClient = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await fuseClient.$queryRaw`SELECT current_database() AS db, current_schema() AS schema`;
    const { db, schema } = rows[0];
    if (db !== 'kltn_test_db' || schema !== 'public') {
      throw new Error(
        '[setup-env] SAFETY FUSE TRIGGERED (live DB check): expected kltn_test_db/public but got ' +
        db + '/' + schema + '. Aborting all E2E tests.'
      );
    }
  } finally {
    await fuseClient.$disconnect();
  }
};
