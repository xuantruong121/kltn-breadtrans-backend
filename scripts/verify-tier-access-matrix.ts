/**
 * Verify the FREE / PLUS / PRO access matrix against real learner APIs.
 *
 * This check is only meaningful once premium content actually exists: with
 * every row free, PREMIUM_CONTENT_LEAK_TO_FREE=0 is vacuously true. It reads
 * the live API as three real identities and compares each item's lock state
 * against the tier that is supposed to own it.
 *
 * Expected, for every published learner item:
 *   premium item + FREE identity  -> locked
 *   premium item + PLUS/PRO       -> unlocked (both carry the premium content
 *                                     entitlements)
 *   free item + any identity      -> unlocked
 *
 * Read-only. Requires the sandbox tier identities to exist.
 *
 * Usage: npx ts-node scripts/verify-tier-access-matrix.ts
 */
import 'dotenv/config';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3001';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Password123!';

const IDENTITIES: Array<{ tier: 'FREE' | 'PLUS' | 'PRO'; email: string }> = [
  { tier: 'FREE', email: 'student1@breadtrans.com' },
  { tier: 'PRO', email: 'student2@breadtrans.com' },
  { tier: 'PLUS', email: 'student3@breadtrans.com' },
];

type Item = {
  id: number;
  title: string;
  isPremiumContent: boolean;
  isLocked: boolean;
};

async function login(email: string) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = (await response.json()) as {
    data?: { access_token?: string; accessToken?: string };
  };
  const token = body.data?.access_token ?? body.data?.accessToken;
  if (!token) throw new Error(`login failed for ${email}: ${response.status}`);
  return token;
}

/**
 * Every learner surface that exposes premium gating. Covering only listening
 * would leave the leak count substantiated for 5 of the 12 premium quizzes and
 * none of the 18 premium speaking exercises.
 */
const SURFACES = [
  { domain: 'LISTENING', path: '/quizzes/listening-practice' },
  { domain: 'READING', path: '/reading/exercises' },
  { domain: 'WRITING', path: '/writing/topics' },
  { domain: 'SPEAKING', path: '/speaking/exercises' },
] as const;

/** Pull the item list out of whichever envelope the surface uses. */
function extractItems(payload: unknown): Item[] {
  const data = (payload as { data?: unknown })?.data ?? payload;
  if (Array.isArray(data)) return data as Item[];
  if (data && typeof data === 'object') {
    for (const key of ['items', 'exercises', 'quizzes', 'topics', 'data']) {
      const nested = (data as Record<string, unknown>)[key];
      if (Array.isArray(nested)) return nested as Item[];
    }
  }
  return [];
}

async function listSurface(
  token: string,
  path: string,
): Promise<{ items: Item[]; status: number }> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => undefined);
  return { items: extractItems(payload), status: response.status };
}

async function main() {
  let leaks = 0;
  let wronglyPaywalled = 0;
  const notes: string[] = [];

  let premiumItemsObserved = 0;

  for (const identity of IDENTITIES) {
    const token = await login(identity.email);
    for (const surface of SURFACES) {
      const { items, status } = await listSurface(token, surface.path);
      if (status >= 400) {
        notes.push(
          `${surface.domain}: ${surface.path} returned HTTP ${status} for ${identity.tier}`,
        );
        continue;
      }
      const premium = items.filter((item) => item.isPremiumContent);
      const free = items.filter((item) => !item.isPremiumContent);
      if (identity.tier === 'FREE') premiumItemsObserved += premium.length;

      // A FREE identity must not be able to open premium items; a paid
      // identity must be able to. Surfaces that expose no lock state at all
      // cannot be judged here and are reported rather than assumed correct.
      const exposesLockState = items.some(
        (item) => typeof item.isLocked === 'boolean',
      );
      if (items.length > 0 && !exposesLockState) {
        notes.push(
          `${surface.domain}: ${surface.path} exposes no isLocked field, gating not verifiable from this surface (${identity.tier})`,
        );
      }

      for (const item of premium) {
        if (identity.tier === 'FREE' && item.isLocked === false) {
          leaks++;
          notes.push(
            `LEAK: ${surface.domain} premium item ${item.id} unlocked for FREE (${item.title})`,
          );
        }
        if (identity.tier !== 'FREE' && item.isLocked === true) {
          wronglyPaywalled++;
          notes.push(
            `PAID-BLOCKED: ${surface.domain} premium item ${item.id} locked for ${identity.tier} (${item.title})`,
          );
        }
      }
      for (const item of free) {
        if (item.isLocked === true) {
          wronglyPaywalled++;
          notes.push(
            `WRONGLY PAYWALLED: ${surface.domain} free item ${item.id} locked for ${identity.tier} (${item.title})`,
          );
        }
      }

      console.log(
        `${identity.tier.padEnd(5)} ${surface.domain.padEnd(10)} items=${String(items.length).padEnd(3)} premium=${String(premium.length).padEnd(3)} ` +
          `premiumLocked=${premium.filter((i) => i.isLocked === true).length}/${premium.length} ` +
          `freeLocked=${free.filter((i) => i.isLocked === true).length}/${free.length}`,
      );
    }
  }

  console.log(
    `\npremium items observed on FREE identity across all surfaces: ${premiumItemsObserved}`,
  );

  console.log('');
  for (const note of notes) console.log(`  - ${note}`);
  console.log(`\nPREMIUM_CONTENT_LEAK_TO_FREE=${leaks}`);
  console.log(`FREE_CONTENT_WRONGLY_PAYWALLED=${wronglyPaywalled}`);
  if (leaks > 0 || wronglyPaywalled > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(
    'Tier access matrix failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
