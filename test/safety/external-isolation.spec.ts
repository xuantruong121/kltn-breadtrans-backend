import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  candidateEnvFiles,
  envFileNames,
  ISOLATION_MARKER,
  ISOLATION_OWNED_NAMES,
  isolatedEnvPlan,
} from './external-env';

/**
 * Canary for the real jest initialisation path (P12.9): it checks the state a
 * spec actually sees, not the helper in isolation. Assertions list variable
 * names only, never values.
 */
const notIsolated = () =>
  Object.entries(isolatedEnvPlan())
    .filter(([name, value]) => process.env[name] !== value)
    .map(([name]) => name);

describe('external-service environment isolation', () => {
  it('ran in this worker before the spec module loaded', () => {
    expect(process.env[ISOLATION_MARKER]).toBe('1');
  });

  it('every external-service variable holds its safe value', () => {
    expect(notIsolated()).toEqual([]);
  });

  it('both Gemini variable names are empty and the grader is mocked', () => {
    expect(process.env.GEMINI_API_KEY).toBe('');
    expect(process.env.GEMINI_API_KEYS).toBe('');
    expect(process.env.DIAGNOSTIC_GRADER_MODE).toBe('mock');
  });

  it('covers every name declared in the .env files dotenv could load', () => {
    const plan = isolatedEnvPlan();
    expect(
      envFileNames().filter(
        (name) => !(name in plan) && !ISOLATION_OWNED_NAMES.has(name),
      ),
    ).toEqual([]);
  });

  it('covers the .env the generated Prisma client would load, wherever it points', () => {
    const clientDir = join(
      __dirname,
      '..',
      '..',
      'node_modules',
      '.prisma',
      'client',
    );
    const index = join(clientDir, 'index.js');
    if (!existsSync(index)) return; // client not generated: nothing loads
    // `prisma generate` records where the client loads `.env` from; it is
    // null when no .env existed at generation time (CI).
    const declared = /"schemaEnvPath":\s*("[^"]*"|null)/.exec(
      readFileSync(index, 'utf8'),
    )?.[1];
    const relative =
      declared && declared !== 'null' ? (JSON.parse(declared) as string) : null;
    if (!relative) return;
    const target = resolve(realpathSync(clientDir), relative);
    if (!existsSync(target)) return; // nothing there to load
    expect(candidateEnvFiles().map((file) => resolve(file))).toContain(target);
  });

  it('loading and constructing the Prisma client cannot restore .env values', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require('@prisma/client');
    const client = new PrismaClient(); // never queried, never connected
    expect(client).toBeDefined();
    expect(notIsolated()).toEqual([]);
    expect(process.env.DATABASE_URL).not.toMatch(/kltn_db/);
  });

  it('both jest projects run the isolation as their first setup', () => {
    const root = join(__dirname, '..', '..');
    const unit = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      .jest as { setupFiles: string[]; setupFilesAfterEnv?: string[] };
    expect(unit.setupFiles[0]).toMatch(
      /test\/safety\/jest-setup-isolation\.ts$/,
    );
    const unitSetup = readFileSync(
      join(__dirname, 'jest-setup-isolation.ts'),
      'utf8',
    );
    // The first import of the unit setup is the external isolation.
    expect(unitSetup.match(/^import .*$/m)?.[0]).toBe(
      "import './jest-setup-external';",
    );
    const e2e = JSON.parse(
      readFileSync(join(root, 'test', 'jest-e2e.json'), 'utf8'),
    ) as { setupFiles?: string[] };
    expect(e2e.setupFiles?.[0]).toMatch(/safety\/jest-setup-external\.ts$/);
  });
});
