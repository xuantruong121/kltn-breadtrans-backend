import { britishReferenceUrl } from './speaking.service';

const clip = (id: number, version = 1) =>
  `https://media.example/catalog/speaking/reference/${id}.v${version}.mp3`;

describe('britishReferenceUrl', () => {
  it('points at the twin of a clip that has one', () => {
    expect(britishReferenceUrl(clip(1))).toBe(
      'https://media.example/catalog/speaking/reference/1.en-gb.v1.mp3',
    );
    expect(britishReferenceUrl(clip(186))).toContain('186.en-gb.v1.mp3');
    expect(britishReferenceUrl(clip(137, 2))).toContain('137.en-gb.v2.mp3');
    expect(britishReferenceUrl('premium/speaking/reference/30.v1.mp3')).toBe(
      'premium/speaking/reference/30.en-gb.v1.mp3',
    );
  });

  it('offers nothing for a clip without a twin, so the US clip plays', () => {
    expect(britishReferenceUrl(clip(187))).toBeNull();
    expect(britishReferenceUrl('https://media.example/other.mp3')).toBeNull();
    expect(britishReferenceUrl(null)).toBeNull();
  });
});
