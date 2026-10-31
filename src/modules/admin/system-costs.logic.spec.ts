import { azureSpeechUsage, isGeminiCacheKey } from './system-costs.logic';
import {
  azureTtsKey,
  recordAzureTts,
  spokenCharacters,
} from '../ai/azure-usage';

describe('azureSpeechUsage', () => {
  it('adds practice and diagnostic audio, and keeps seconds visible', () => {
    expect(
      azureSpeechUsage({
        speakingMs: 9901,
        diagnosticMs: 73440,
        ttsCharacters: 0,
      }).audioMinutesThisMonth,
    ).toBe(1.4);
  });

  it('meters speech to text and text to speech apart', () => {
    const usage = azureSpeechUsage({
      speakingMs: 0,
      diagnosticMs: 0,
      ttsCharacters: 250_000,
    });
    expect(usage).toMatchObject({ usedPercent: 0, ttsUsedPercent: 50 });
    expect(usage.withinFreeTier).toBe(true);
  });

  it('leaves the free tier when either meter runs out', () => {
    expect(
      azureSpeechUsage({
        speakingMs: 0,
        diagnosticMs: 0,
        ttsCharacters: 500_000,
      }).withinFreeTier,
    ).toBe(false);
    expect(
      azureSpeechUsage({
        speakingMs: 5 * 60 * 60 * 1000,
        diagnosticMs: 0,
        ttsCharacters: 0,
      }).withinFreeTier,
    ).toBe(false);
  });
});

describe('isGeminiCacheKey', () => {
  it('counts only cached answers', () => {
    expect(isGeminiCacheKey('gemini:writing:abc')).toBe(true);
    expect(isGeminiCacheKey('gemini:telemetry:input_tokens')).toBe(false);
    expect(isGeminiCacheKey('gemini:daily_quota:2026-10-31')).toBe(false);
  });
});

describe('azure usage counter', () => {
  it('counts spoken text, not SSML tags', () => {
    expect(
      spokenCharacters('<speak><voice name="x">Hello there</voice></speak>'),
    ).toBe(11);
  });

  it('keys by calendar month', () => {
    expect(azureTtsKey(new Date('2026-11-02T00:00:00Z'))).toBe(
      'azure:usage:tts_chars:2026-11',
    );
  });

  it('never fails a synthesis', async () => {
    const redis = {
      incrby: jest.fn().mockRejectedValue(new Error('down')),
      expire: jest.fn(),
    };
    await expect(recordAzureTts(redis as never, 5)).resolves.toBeUndefined();
    await expect(recordAzureTts(null, 5)).resolves.toBeUndefined();
  });
});
