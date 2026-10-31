import type Redis from 'ioredis';

/**
 * Azure text-to-speech volume per calendar month, for the admin cost page.
 * Azure meters characters here, not audio minutes, and only Listening
 * authoring has a usage table. Counting never fails a synthesis.
 */
const KEEP_SECONDS = 400 * 24 * 60 * 60;

export const azureTtsKey = (at: Date = new Date()) =>
  `azure:usage:tts_chars:${at.toISOString().slice(0, 7)}`;

/** The text inside SSML: the tags are not spoken. */
export const spokenCharacters = (ssml: string) =>
  ssml.replace(/<[^>]+>/g, '').trim().length;

export async function recordAzureTts(
  redis: Pick<Redis, 'incrby' | 'expire'> | null | undefined,
  characters: number,
) {
  if (!redis || characters <= 0) return;
  const key = azureTtsKey();
  try {
    await redis.incrby(key, characters);
    await redis.expire(key, KEEP_SECONDS);
  } catch {
    // Telemetry only.
  }
}
