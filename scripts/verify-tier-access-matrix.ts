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

async function listListening(token: string): Promise<Item[]> {
  const response = await fetch(`${BASE}/quizzes/listening-practice`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as { data?: Item[] };
  if (!response.ok || !body.data)
    throw new Error(`listening-practice failed: HTTP ${response.status}`);
  return body.data;
}

async function main() {
  let leaks = 0;
  let wronglyPaywalled = 0;
  const notes: string[] = [];

  for (const identity of IDENTITIES) {
    const token = await login(identity.email);
    const items = await listListening(token);
    const premium = items.filter((item) => item.isPremiumContent);
    const free = items.filter((item) => !item.isPremiumContent);

    // A FREE identity must not be able to open premium items; a paid identity
    // must be able to.
    for (const item of premium) {
      if (identity.tier === 'FREE' && !item.isLocked) {
        leaks++;
        notes.push(
          `LEAK: premium quiz ${item.id} is unlocked for FREE (${item.title})`,
        );
      }
      if (identity.tier !== 'FREE' && item.isLocked) {
        wronglyPaywalled++;
        notes.push(
          `PAID-BLOCKED: premium quiz ${item.id} is locked for ${identity.tier} (${item.title})`,
        );
      }
    }
    for (const item of free) {
      if (item.isLocked) {
        wronglyPaywalled++;
        notes.push(
          `WRONGLY PAYWALLED: free quiz ${item.id} is locked for ${identity.tier} (${item.title})`,
        );
      }
    }

    console.log(
      `${identity.tier.padEnd(5)} items=${String(items.length).padEnd(3)} premium=${String(premium.length).padEnd(2)} ` +
        `premiumLocked=${premium.filter((i) => i.isLocked).length}/${premium.length} ` +
        `freeLocked=${free.filter((i) => i.isLocked).length}/${free.length}`,
    );
  }

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
