import { validateToeicExam } from './toeic.validation';
import {
  toeicMediaHash,
  withManualMedia,
  withMediaFailure,
} from './toeic-media';
import { createHash } from 'crypto';

function makeExam() {
  const groups = [] as any[];
  let number = 1;
  for (const [part, count] of [
    [1, 6],
    [2, 25],
    [3, 39],
    [4, 30],
    [5, 30],
    [6, 16],
    [7, 54],
  ] as const) {
    const groupCount =
      part === 3
        ? 13
        : part === 4
          ? 10
          : part === 6
            ? 4
            : part === 7
              ? 15
              : count;
    let remaining = count;
    for (let index = 0; index < groupCount; index++) {
      const size =
        part === 3 || part === 4
          ? 3
          : part === 7 && index >= 10
            ? 5
            : part === 7
              ? index === 0
                ? 2
                : 3
              : part === 6
                ? 4
                : 1;
      const questions = Array.from(
        { length: Math.min(size, remaining) },
        () => ({
          id: number,
          questionNumber: number++,
          options: part === 2 ? ['a', 'b', 'c'] : ['a', 'b', 'c', 'd'],
          correctIndex: 0,
        }),
      );
      remaining -= questions.length;
      groups.push({
        id: groups.length + 1,
        part,
        groupOrder: groups.length + 1,
        imageUrl:
          part === 1
            ? 'https://pub-ecd236c9754a4b7cb22ab82189e6ded2.r2.dev/test/image.png'
            : null,
        audioUrl: part <= 4 ? 'audio' : null,
        passageText: part >= 6 ? 'passage' : null,
        questions,
      });
    }
  }
  return { id: 1, type: 'FULL_TEST', durationSeconds: 7200, groups };
}

test('validates the standard 200-question structure and grouping', () => {
  const result = validateToeicExam(makeExam());
  expect(result.learnerReady).toBe(true);
  expect(result.counts).toMatchObject({
    total: 200,
    listening: 100,
    reading: 100,
  });
});

test('explains why a single-Part Draft cannot be published as a TOEIC template', () => {
  const exam = makeExam();
  exam.type = 'PRACTICE_BY_PART';
  const result = validateToeicExam(exam);
  expect(result.learnerReady).toBe(false);
  expect(result.issues).toContainEqual(
    expect.objectContaining({ code: 'INCOMPLETE_TEMPLATE' }),
  );
});

test('rejects missing durable listening media without weakening count checks', () => {
  const exam = makeExam();
  exam.groups.find((group) => group.part === 3).audioUrl = null;
  const result = validateToeicExam(exam);
  expect(result.learnerReady).toBe(false);
  expect(result.issues.some((issue) => issue.code === 'MISSING_AUDIO')).toBe(
    true,
  );
});

test('keeps a complete 200-question Draft reviewable when Part 1 image is unavailable', () => {
  const exam = makeExam();
  const group = exam.groups.find((candidate) => candidate.part === 1);
  group.imageUrl = null;
  group.imageBrief = 'A manager reviewing a printed report in an office.';
  group.mediaMetadata = withMediaFailure(
    {},
    'image',
    new Error('429 quota exceeded'),
    toeicMediaHash(group.imageBrief),
  );

  const result = validateToeicExam(exam);

  expect(result.counts.total).toBe(200);
  expect(result.learnerReady).toBe(false);
  expect(result.issues).toContainEqual(
    expect.objectContaining({ code: 'MISSING_IMAGE', groupId: group.id }),
  );
  expect(group.imageUrl).toBeNull();
  expect(group.imageBrief).toContain('manager');
  expect(group.mediaMetadata.image).toMatchObject({
    source: 'AI_GENERATED',
    status: 'FAILED',
    errorCode: 'PROVIDER_UNAVAILABLE',
  });
});

test('rejects SVG and arbitrary remote URLs as a Part 1 publish stimulus', () => {
  const exam = makeExam();
  const group = exam.groups.find((candidate) => candidate.part === 1);
  group.imageUrl = 'data:image/svg+xml,<svg/>';
  expect(validateToeicExam(exam).issues).toContainEqual(
    expect.objectContaining({ code: 'MISSING_IMAGE', groupId: group.id }),
  );
  group.imageUrl = 'https://example.com/picture.svg';
  expect(validateToeicExam(exam).issues).toContainEqual(
    expect.objectContaining({ code: 'MISSING_IMAGE', groupId: group.id }),
  );
});

test('keeps Listening transcript when audio materialization fails', () => {
  const exam = makeExam();
  const group = exam.groups.find((candidate) => candidate.part === 3);
  group.audioUrl = null;
  group.transcriptText = 'Woman: The meeting starts at nine.';
  group.mediaMetadata = withMediaFailure(
    {},
    'audio',
    new Error('Azure provider timeout'),
    toeicMediaHash(group.transcriptText),
  );

  const result = validateToeicExam(exam);

  expect(result.issues).toContainEqual(
    expect.objectContaining({ code: 'MISSING_AUDIO', groupId: group.id }),
  );
  expect(group.audioUrl).toBeNull();
  expect(group.transcriptText).toBe('Woman: The meeting starts at nine.');
  expect(group.mediaMetadata.audio).toMatchObject({
    source: 'AI_GENERATED',
    status: 'FAILED',
    errorCode: 'PROVIDER_UNAVAILABLE',
  });
});

test('marks a manual media replacement as ready with truthful provenance', () => {
  const metadata = withManualMedia(
    {},
    'image',
    toeicMediaHash('A team meeting in a bright office.'),
  );

  expect(metadata.image).toMatchObject({
    source: 'ADMIN_UPLOADED',
    status: 'READY',
  });
  expect(metadata.image.briefHash).toBe(
    toeicMediaHash('A team meeting in a bright office.'),
  );
});

test('allows three-option Part 2 responses and rejects wrong option cardinality', () => {
  const exam = makeExam();
  exam.groups.find((group) => group.part === 2).questions[0].options = [
    'a',
    'b',
  ];
  const result = validateToeicExam(exam);
  expect(result.issues.some((issue) => issue.code === 'OPTIONS')).toBe(true);
});

test('fails closed when generated Listening audio is stale after transcript editing', () => {
  const exam = makeExam();
  const group = exam.groups.find((item) => item.part === 3);
  group.transcriptText = 'Woman: The original transcript.';
  group.mediaMetadata = {
    audio: {
      transcriptHash: createHash('sha256')
        .update('Woman: A different transcript.')
        .digest('hex'),
    },
  };
  const result = validateToeicExam(exam);
  expect(result.learnerReady).toBe(false);
  expect(result.issues.some((issue) => issue.code === 'STALE_AUDIO')).toBe(
    true,
  );
});
