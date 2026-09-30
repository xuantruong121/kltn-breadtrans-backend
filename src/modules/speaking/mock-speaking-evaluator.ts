import { Logger } from '@nestjs/common';

export interface MockPronunciationResult {
  overallScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  pronScore: number;
  transcript: string;
  words: Array<{
    word: string;
    accuracyScore: number;
    errorType: string;
    phonemes?: Array<{ phoneme: string; accuracyScore: number }>;
  }>;
  isSilentOrNoSpeech?: boolean;
  errorCode?: string;
}

export class MockSpeakingEvaluator {
  private static readonly logger = new Logger(MockSpeakingEvaluator.name);

  static isMockEnabled(): boolean {
    return (
      process.env.MOCK_AZURE_SPEECH === 'true' ||
      process.env.NODE_ENV === 'test'
    );
  }

  static async evaluate(
    targetText: string,
    audioBuffer: Buffer,
  ): Promise<MockPronunciationResult> {
    void audioBuffer;
    if (!this.isMockEnabled()) {
      throw new Error(
        'MockSpeakingEvaluator invoked but MOCK_AZURE_SPEECH is not enabled',
      );
    }

    // Configurable simulated delay
    const delayMs = parseInt(process.env.MOCK_AZURE_DELAY_MS || '150', 10);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Simulated error triggers for resilience testing
    if (process.env.MOCK_AZURE_SIMULATE_429 === 'true') {
      const err: any = new Error(
        'Too Many Requests: Azure Speech rate limit reached',
      );
      err.code = 'TOO_MANY_REQUESTS';
      err.status = 429;
      throw err;
    }

    if (process.env.MOCK_AZURE_SIMULATE_5XX === 'true') {
      const err: any = new Error('Service Unavailable: Azure Speech 503');
      err.code = 'PROVIDER_UNAVAILABLE';
      err.status = 503;
      throw err;
    }

    if (process.env.MOCK_AZURE_SIMULATE_TIMEOUT === 'true') {
      const err: any = new Error(
        'Request Timeout: Azure Speech connection timed out',
      );
      err.code = 'PROVIDER_TIMEOUT';
      throw err;
    }

    const cleanText = (targetText || '').trim();
    const wordsList = cleanText.split(/\s+/).filter(Boolean);

    const words = wordsList.map((w) => ({
      word: w.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ''),
      accuracyScore: 88,
      errorType: 'None',
      phonemes: [
        { phoneme: 'ae', accuracyScore: 90 },
        { phoneme: 't', accuracyScore: 86 },
      ],
    }));

    return {
      overallScore: 8.8,
      accuracyScore: 88,
      fluencyScore: 85,
      completenessScore: 92,
      pronScore: 88,
      transcript: cleanText,
      words,
      isSilentOrNoSpeech: false,
    };
  }
}
