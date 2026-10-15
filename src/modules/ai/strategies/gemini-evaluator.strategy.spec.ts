import { GeminiEvaluatorStrategy } from './gemini-evaluator.strategy';

describe('GeminiEvaluatorStrategy Writing image MIME detection', () => {
  const detect = (buffer: Buffer) =>
    (new GeminiEvaluatorStrategy() as any).detectImageMimeType(buffer);

  it('detects PNG bytes as image/png', () => {
    expect(
      detect(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
  });

  it('detects JPEG bytes as image/jpeg', () => {
    expect(detect(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('detects WebP bytes as image/webp', () => {
    expect(detect(Buffer.from('RIFF0000WEBP', 'ascii'))).toBe('image/webp');
  });
});
