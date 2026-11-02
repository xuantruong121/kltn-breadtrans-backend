import { bestImageCandidate, imageSearchQuery } from './exam-image-query';

describe('imageSearchQuery', () => {
  it('turns a brief into keywords', () => {
    expect(
      imageSearchQuery(
        'A realistic photo of a woman watering plants in an open office.',
      ),
    ).toBe('woman watering plants open office');
  });

  it('caps the length and repeats no word', () => {
    expect(
      imageSearchQuery('desk desk chair lamp shelf window door floor', 4),
    ).toBe('desk chair lamp shelf');
  });

  it('returns nothing for a brief without usable words', () => {
    expect(imageSearchQuery('A photo of it')).toBe('');
  });
});

describe('bestImageCandidate', () => {
  it('takes the highest score among suitable images', () => {
    expect(
      bestImageCandidate([
        { candidateId: 'a', suitable: true, score: 60 },
        { candidateId: 'b', suitable: false, score: 95 },
        { candidateId: 'c', suitable: true, score: 80 },
      ]),
    ).toBe('c');
  });

  it('refuses when no image is suitable', () => {
    expect(
      bestImageCandidate([{ candidateId: 'a', suitable: false, score: 90 }]),
    ).toBeNull();
  });
});
