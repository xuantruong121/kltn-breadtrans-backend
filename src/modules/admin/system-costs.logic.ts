/**
 * Figures of the admin cost page. No Prisma, no I/O. Free quotas are the
 * providers' published numbers: Azure F0 gives 5 audio hours of speech to text
 * and 0.5 million neural text-to-speech characters a month, R2 10 GB. Azure
 * meters the two separately, so neither hides the other.
 */
export const AZURE_STT_FREE_MINUTES = 5 * 60;
export const AZURE_TTS_FREE_CHARACTERS = 500_000;
export const R2_FREE_GB = 10;

const percentOf = (used: number, quota: number) =>
  Math.min(100, Math.round((used / quota) * 100));

export function azureSpeechUsage(input: {
  speakingMs: number;
  diagnosticMs: number;
  ttsCharacters: number;
}) {
  const milliseconds = input.speakingMs + input.diagnosticMs;
  // One decimal: a few short recordings must not read as zero.
  const audioMinutesThisMonth = Math.round(milliseconds / 6000) / 10;
  const usedPercent = percentOf(audioMinutesThisMonth, AZURE_STT_FREE_MINUTES);
  const ttsUsedPercent = percentOf(
    input.ttsCharacters,
    AZURE_TTS_FREE_CHARACTERS,
  );
  return {
    audioMinutesThisMonth,
    freeQuotaMinutes: AZURE_STT_FREE_MINUTES,
    usedPercent,
    ttsCharactersThisMonth: input.ttsCharacters,
    freeTtsCharacters: AZURE_TTS_FREE_CHARACTERS,
    ttsUsedPercent,
    withinFreeTier: usedPercent < 100 && ttsUsedPercent < 100,
  };
}

/** `gemini:*` also holds telemetry and quota counters, which are not cache. */
export const isGeminiCacheKey = (key: string) =>
  !key.startsWith('gemini:telemetry:') &&
  !key.startsWith('gemini:daily_quota:');
