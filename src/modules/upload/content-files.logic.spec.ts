import {
  type ContentFileOwner,
  contentKeyOwner,
  ownedContentKey,
  storedObjectKey,
} from './content-files.logic';

/** Bug 2026-11-22: a deleted content item's own R2 files go with it. */
describe('content files', () => {
  const quiz103: ContentFileOwner = { kind: 'listening-quiz', quizId: 103 };
  const question415: ContentFileOwner = {
    kind: 'listening-question',
    quizId: 103,
    questionId: 415,
  };
  const exercise5: ContentFileOwner = {
    kind: 'speaking-exercise',
    exerciseId: 5,
  };

  describe('ownedContentKey', () => {
    it.each([
      // The key of the bug report.
      'catalog/listening/practice/audio/quiz-103/question-415/v1/0b6c.mp3',
      'catalog/listening/practice/dialogue/quiz-103/question-415/v2/9f1e.mp3',
      'catalog/listening/practice/audio/quiz-103/question-415/dialogue-v3.mp3',
      'listening/quiz-103/question-415/v1/1a2b.mp3',
      'premium/listening/quiz-103/question-415/v1/audio.mp3',
      // Whole-quiz audio, free and premium (both layouts).
      'catalog/listening/practice/quiz-103/audio/v1/full.mp3',
      'premium/listening/quiz-103/audio/v2/full.mp3',
      'premium/listening/quiz-103/artifact-v1/full.mp3',
    ])('a listening quiz owns %s', (key) => {
      expect(ownedContentKey(quiz103, key)).toBe(key);
    });

    it.each([
      // Another quiz, also one whose id starts with the same digits.
      'catalog/listening/practice/audio/quiz-10/question-415/v1/a.mp3',
      'catalog/listening/practice/audio/quiz-1030/question-1/v1/a.mp3',
      'premium/listening/quiz-1031/audio/v1/full.mp3',
      // Shared seed pictures, generic uploads, TOEIC exam audio.
      'catalog/listening/practice/images/office.webp',
      'images/4f0e.png',
      'audio/4f0e.mp3',
      'premium/listening/toeic/exams/3/groups/7/audio.mp3',
      // A learner recording.
      'premium/speaking/practice/19/rec.wav',
    ])('a listening quiz does not own %s', (key) => {
      expect(ownedContentKey(quiz103, key)).toBeNull();
    });

    it('a question owns its own clips only, never the whole-quiz audio', () => {
      expect(
        ownedContentKey(
          question415,
          'catalog/listening/practice/audio/quiz-103/question-415/v1/a.mp3',
        ),
      ).not.toBeNull();
      for (const key of [
        'catalog/listening/practice/audio/quiz-103/question-416/v1/a.mp3',
        'catalog/listening/practice/audio/quiz-103/question-4150/v1/a.mp3',
        'catalog/listening/practice/audio/quiz-104/question-415/v1/a.mp3',
        'catalog/listening/practice/quiz-103/audio/v1/full.mp3',
        'premium/listening/quiz-103/audio/v1/full.mp3',
      ])
        expect(ownedContentKey(question415, key)).toBeNull();
    });

    it('a Speaking exercise owns the reference audio made for it', () => {
      for (const key of [
        'catalog/speaking/reference/5.r1763800000000.mp3',
        'premium/speaking/reference/5.r1763800000000.mp3',
      ])
        expect(ownedContentKey(exercise5, key)).toBe(key);
      for (const key of [
        'catalog/speaking/reference/50.r1763800000000.mp3',
        'catalog/speaking/reference/15.r1763800000000.mp3',
        'catalog/speaking/reference/5.mp3',
        'images/5.r1.png',
      ])
        expect(ownedContentKey(exercise5, key)).toBeNull();
    });

    it.each([
      ['a scheme', 'https://cdn.example.com/listening/quiz-103/a.mp3'],
      ['a leading slash', '/listening/quiz-103/question-415/v1/a.mp3'],
      ['a .. segment', 'listening/quiz-103/../quiz-7/question-1/v1/a.mp3'],
      ['a backslash', 'listening\\quiz-103\\question-415\\v1\\a.mp3'],
      ['nothing', ''],
      ['null', null],
    ])('refuses a key with %s', (_label, key) => {
      expect(ownedContentKey(quiz103, key)).toBeNull();
    });
  });

  describe('storedObjectKey', () => {
    const base = 'https://pub-123.r2.dev';

    it('reads the key from a URL on the public base, or takes a bare key', () => {
      expect(
        storedObjectKey(
          `${base}/catalog/speaking/reference/5.r1.mp3`,
          `${base}/`,
        ),
      ).toBe('catalog/speaking/reference/5.r1.mp3');
      expect(storedObjectKey('premium/speaking/reference/5.r1.mp3', base)).toBe(
        'premium/speaking/reference/5.r1.mp3',
      );
    });

    it('refuses a URL on another host, with a query, or without a base', () => {
      expect(
        storedObjectKey(
          'https://evil.example/catalog/speaking/reference/5.r1.mp3',
          base,
        ),
      ).toBeNull();
      expect(
        storedObjectKey(
          `${base}/catalog/speaking/reference/5.r1.mp3?x=1`,
          base,
        ),
      ).toBeNull();
      expect(
        storedObjectKey(`${base}/catalog/speaking/reference/5.r1.mp3`, ''),
      ).toBeNull();
      // The base must end at a path boundary.
      expect(
        storedObjectKey(`${base}.evil.example/catalog/x.mp3`, base),
      ).toBeNull();
    });
  });

  describe('contentKeyOwner (the retry re-validates each queued key)', () => {
    it('reads the owner from the key', () => {
      expect(
        contentKeyOwner(
          'catalog/listening/practice/audio/quiz-103/question-415/v1/a.mp3',
        ),
      ).toEqual(question415);
      expect(
        contentKeyOwner(
          'catalog/listening/practice/quiz-103/audio/v1/full.mp3',
        ),
      ).toEqual(quiz103);
      expect(
        contentKeyOwner('premium/listening/quiz-103/audio/v1/full.mp3'),
      ).toEqual(quiz103);
      expect(
        contentKeyOwner('catalog/speaking/reference/5.r1763800000000.mp3'),
      ).toEqual(exercise5);
    });

    it.each([
      'images/4f0e.png',
      'premium/speaking/practice/19/rec.wav',
      'premium/listening/toeic/exams/3/groups/7/audio.mp3',
      'catalog/listening/practice/images/office.webp',
      // The server never writes a question folder under the artifact path.
      'catalog/listening/practice/quiz-103/question-415/a.mp3',
      'https://pub-123.r2.dev/listening/quiz-103/question-1/v1/a.mp3',
      '/listening/quiz-103/question-1/v1/a.mp3',
      'listening/quiz-103/../../images/a.png',
    ])('is null for %s', (key) => {
      expect(contentKeyOwner(key)).toBeNull();
    });
  });
});
