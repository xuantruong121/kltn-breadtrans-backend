/**
 * External-service environment isolation for test workers (P12.9).
 *
 * Prisma's generated client loads the backend `.env` when it initialises
 * (`schemaEnvPath ../../../.env`, resolved from the real node_modules path, so
 * a worktree with a junctioned node_modules still reaches the owner's file).
 * It only adds variables that are not yet defined, and the jest global setup
 * imports Prisma in the parent process before workers start. So every name
 * that could carry a real credential, endpoint or provider mode is assigned
 * here, unconditionally, before any spec module loads: an empty string keeps
 * dotenv from filling it, and overrides a value inherited from the parent.
 *
 * Only variable names are read from `.env`; values are never read into the
 * test environment or printed.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parse } from 'dotenv';

/** Names the source or `.env` uses for external services, credentials and endpoints. */
export const EXTERNAL_ENV_NAMES = [
  // AI providers
  'GEMINI_API_KEY',
  'GEMINI_API_KEYS',
  'GEMINI_MODEL_NAME',
  'GEMINI_VISION_MODEL',
  'GEMINI_IMAGE_MODEL_NAME',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_AI_API_TOKEN',
  'AZURE_SPEECH_KEY',
  'AZURE_SPEECH_REGION',
  // Object storage (public, private, backup) and media hosts
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_ENDPOINT',
  'R2_PUBLIC_URL',
  'R2_PRIVATE_BUCKET_NAME',
  'R2_PRIVATE_ENDPOINT',
  'R2_PRIVATE_ACCESS_KEY_ID',
  'R2_PRIVATE_SECRET_ACCESS_KEY',
  'R2_PRIVATE_FORCE_PATH_STYLE',
  'R2_BACKUP_BUCKET_NAME',
  'R2_BACKUP_ENDPOINT',
  'R2_BACKUP_ACCESS_KEY_ID',
  'R2_BACKUP_SECRET_ACCESS_KEY',
  'TOEIC_LISTENING_MASTER_BASE_URL',
  'SEED_ASSET_BASE_URL',
  // Payments
  'PAYOS_CLIENT_ID',
  'PAYOS_API_KEY',
  'PAYOS_CHECKSUM_KEY',
  'SEPAY_API_TOKEN',
  'SEPAY_WEBHOOK_SECRET',
  'SEPAY_TRANSACTIONS_URL',
  // Image search, dictionary
  'IMAGE_SEARCH_PROVIDER',
  'PIXABAY_API_KEY',
  'PEXELS_API_KEY',
  'DICTIONARY_API_BASE_URL',
  // Google sign-in, e-mail, web push
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  // Application secrets: tests use the non-production fallbacks
  'JWT_SECRET',
  'OTP_SECRET',
] as const;

/** Provider modes forced to their offline value. */
export const SAFE_MODE_VALUES: Readonly<Record<string, string>> = {
  DIAGNOSTIC_GRADER_MODE: 'mock',
};

/** Set by jest-setup-isolation.ts; database and Redis keep their own guard. */
export const ISOLATION_OWNED_NAMES = new Set([
  'DATABASE_URL',
  'SHADOW_DATABASE_URL',
  'REDIS_URL',
  'REDIS_HOST',
  'REDIS_PORT',
]);

/**
 * The `.env` files dotenv could load in a test worker: the one Prisma's
 * generated client resolves (from the real path of node_modules) and the
 * repository's own.
 */
export function candidateEnvFiles(): string[] {
  const files = new Set<string>([join(__dirname, '..', '..', '.env')]);
  try {
    const prismaClientDir = realpathSync(
      dirname(require.resolve('@prisma/client/package.json')),
    );
    // node_modules/@prisma/client -> node_modules/.prisma/client is a sibling;
    // its schemaEnvPath ../../../.env lands on the project root.
    files.add(join(prismaClientDir, '..', '..', '..', '.env'));
  } catch {
    // No Prisma client installed: nothing for it to load.
  }
  return [...files].filter((file) => existsSync(file));
}

/** Variable names (never values) declared in the candidate `.env` files. */
export function envFileNames(files = candidateEnvFiles()): string[] {
  const names = new Set<string>();
  for (const file of files)
    for (const name of Object.keys(parse(readFileSync(file)))) names.add(name);
  return [...names];
}

/** Every name this setup neutralises, with the value it must hold. */
export function isolatedEnvPlan(
  fileNames = envFileNames(),
): Record<string, string> {
  const plan: Record<string, string> = {};
  for (const name of [...EXTERNAL_ENV_NAMES, ...fileNames])
    if (!ISOLATION_OWNED_NAMES.has(name)) plan[name] = '';
  return { ...plan, ...SAFE_MODE_VALUES };
}

export const ISOLATION_MARKER = '__BREADTRANS_TEST_ENV_ISOLATED__';

/** Applies the plan to `env` (unconditionally) and marks the worker. */
export function isolateExternalEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const [name, value] of Object.entries(isolatedEnvPlan()))
    env[name] = value;
  env[ISOLATION_MARKER] = '1';
}
