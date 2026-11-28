import {
  audioToneOf,
  displayTitle,
  filterQuizList,
  filterSpeakingSets,
  quizListFacets,
  speakingSetFacets,
  firstImageByQuiz,
  isTranscriptHolder,
  storedWritingKind,
  taskTypesByQuiz,
  writingKindOf,
} from './skill-cms-list';

const quiz = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Bài ${id}`,
  publicationStatus: 'DRAFT',
  _count: { questions: 3 },
  ...extra,
});

describe('track filter', () => {
  const rows = [
    quiz(1, { tracks: ['IT_SOFTWARE', 'GENERAL'] }),
    quiz(2, { tracks: [] }),
    quiz(3),
  ];
  const ids = (track: string) =>
    filterQuizList(rows, { track }).map((row) => row.id);

  it('finds one track, or what still needs tagging', () => {
    expect(ids('IT_SOFTWARE')).toEqual([1]);
    expect(ids('UNTAGGED')).toEqual([3, 2]);
    expect(ids('ALL')).toEqual([3, 2, 1]);
  });

  it('applies to speaking sets', () => {
    const set = (id: string, tracks: string[]) => ({
      id,
      title: id,
      exerciseCount: 1,
      tracks,
    });
    expect(
      filterSpeakingSets([set('a', ['GENERAL']), set('b', [])], {
        track: 'UNTAGGED',
      }).map((row) => row.id),
    ).toEqual(['b']);
  });
});

describe('a dialogue with clips instead of one recording', () => {
  it('is measured by its clips', () => {
    const dialogue = { bilingualContent: { mode: 'DIALOGUE' } };
    expect(audioToneOf(quiz(1, { ...dialogue, questionsWithAudio: 3 }))).toBe(
      'ok',
    );
    expect(audioToneOf(quiz(2, { ...dialogue, questionsWithAudio: 1 }))).toBe(
      'pending',
    );
    expect(audioToneOf(quiz(3, dialogue))).toBe('none');
  });

  // Review 2026-11-22: a hand-made dialogue keeps its clip on the holder.
  it('is ready when its transcript holder has a clip and there is no recording', () => {
    const dialogue = { bilingualContent: { mode: 'DIALOGUE' } };
    expect(audioToneOf(quiz(1, { ...dialogue, dialogueAudio: true }))).toBe(
      'ok',
    );
    expect(audioToneOf(quiz(2, { ...dialogue, dialogueAudio: false }))).toBe(
      'none',
    );
    // A shared recording, when there is one, decides.
    expect(
      audioToneOf(
        quiz(3, {
          ...dialogue,
          dialogueAudio: true,
          listeningAudioArtifacts: [{ version: 2, status: 'FAILED' }],
        }),
      ),
    ).toBe('error');
    // Only a dialogue quiz reads its holder.
    expect(
      audioToneOf(
        quiz(4, {
          bilingualContent: { mode: 'COMPREHENSION' },
          dialogueAudio: true,
        }),
      ),
    ).toBe('none');
  });
});

describe('skill CMS list rules', () => {
  const rows = [
    quiz(1, {
      title: 'Hội thoại B1 — Đặt phòng',
      practiceLevel: 'INTERMEDIATE',
      publicationStatus: 'PUBLISHED',
      bilingualContent: { mode: 'DIALOGUE' },
      listeningAudioArtifacts: [{ version: 2, status: 'PUBLISHED' }],
    }),
    quiz(2, {
      title: 'Nghe hiểu A2 — Sân bay',
      practiceLevel: 'BASIC',
      bilingualContent: { mode: 'COMPREHENSION' },
      questionsWithAudio: 1,
      _count: { questions: 3 },
    }),
    quiz(3, {
      title: 'Chép chính tả A1 — Số đếm',
      practiceLevel: 'STARTER',
      bilingualContent: { mode: 'DICTATION' },
      _count: { questions: 1 },
    }),
    quiz(4, {
      type: 'WRITING_EMAIL',
      practiceLevel: 'ADVANCED',
      description: 'Email xin nghỉ',
    }),
  ];

  it('derives the audio state by mode', () => {
    expect(audioToneOf(rows[0])).toBe('ok');
    expect(audioToneOf(rows[1])).toBe('pending');
    expect(audioToneOf(rows[2])).toBe('none');
    expect(
      audioToneOf(
        quiz(9, {
          listeningAudioArtifacts: [{ version: 1, status: 'FAILED' }],
        }),
      ),
    ).toBe('error');
  });

  it('filters by search, status, practice level, mode, audio and type', () => {
    const ids = (query: Record<string, string>) =>
      filterQuizList(rows, query).map((row) => row.id);
    expect(ids({ q: 'sân BAY' })).toEqual([2]);
    expect(ids({ q: 'xin nghỉ' })).toEqual([4]);
    expect(ids({ status: 'PUBLISHED' })).toEqual([1]);
    expect(ids({ level: 'STARTER' })).toEqual([3]);
    expect(ids({ level: 'ADVANCED' })).toEqual([4]);
    expect(ids({ mode: 'COMPREHENSION' })).toEqual([4, 2]);
    expect(ids({ audio: 'none' })).toEqual([4, 3]);
    expect(ids({ type: 'WRITING_EMAIL', status: 'ALL' })).toEqual([4]);
  });

  it('sorts newest first by default, and by title, level or size', () => {
    const ids = (sort: string) =>
      filterQuizList(rows, { sort }).map((row) => row.id);
    expect(ids('')).toEqual([4, 3, 2, 1]);
    expect(ids('OLDEST')).toEqual([1, 2, 3, 4]);
    expect(ids('LEVEL')).toEqual([3, 2, 1, 4]);
    expect(ids('FEWEST')).toEqual([3, 4, 2, 1]);
    expect(displayTitle(rows[0])).toBe('Đặt phòng');
  });

  it('counts the whole domain for the header and tabs', () => {
    expect(quizListFacets(rows)).toEqual({
      total: 4,
      published: 1,
      modes: { COMPREHENSION: 2, DICTATION: 1, DIALOGUE: 1 },
      levels: ['STARTER', 'BASIC', 'INTERMEDIATE', 'ADVANCED'],
    });
  });

  it('counts each Writing kind for the Writing list only', () => {
    const writing = [
      quiz(1, { writingKind: 'TRANSLATION' }),
      quiz(2, { writingKind: 'TRANSLATION' }),
      quiz(3, { writingKind: 'PICTURE' }),
      quiz(4, { writingKind: 'EMAIL' }),
    ];
    expect(quizListFacets(writing, { writing: true }).kinds).toEqual({
      TRANSLATION: 2,
      PICTURE: 1,
      SENTENCE: 0,
      EMAIL: 1,
    });
    expect(quizListFacets(writing)).not.toHaveProperty('kinds');
  });
});

describe('speaking set list rules', () => {
  const sets = [
    {
      id: 'a',
      title: 'Giới thiệu bản thân',
      level: 'STARTER',
      publicationStatus: 'PUBLISHED',
      createdAt: '2026-10-01',
      // Edited last: an edit must not move it up the list.
      updatedAt: '2026-11-20',
      exerciseCount: 5,
    },
    {
      id: 'b',
      title: 'Phỏng vấn xin việc',
      level: 'INTERMEDIATE',
      publicationStatus: 'DRAFT',
      createdAt: '2026-10-20',
      updatedAt: '2026-10-20',
      exerciseCount: 2,
    },
  ];

  it('filters and sorts sets', () => {
    // Newest created first, as on the other lists; OLDEST reverses it.
    expect(filterSpeakingSets(sets, {}).map((s) => s.id)).toEqual(['b', 'a']);
    expect(
      filterSpeakingSets(sets, { sort: 'NEWEST' }).map((s) => s.id),
    ).toEqual(['b', 'a']);
    expect(
      filterSpeakingSets(sets, { sort: 'OLDEST' }).map((s) => s.id),
    ).toEqual(['a', 'b']);
    expect(filterSpeakingSets(sets, { q: 'phỏng' }).map((s) => s.id)).toEqual([
      'b',
    ]);
    // Phân loại folded into Lĩnh vực: an old category filter is ignored.
    expect(
      filterSpeakingSets(sets, { category: 'Work' }).map((s) => s.id),
    ).toEqual(['b', 'a']);
    expect(
      filterSpeakingSets(sets, { level: 'STARTER' }).map((s) => s.id),
    ).toEqual(['a']);
    expect(
      filterSpeakingSets(sets, { sort: 'TITLE' }).map((s) => s.id),
    ).toEqual(['a', 'b']);
    expect(
      filterSpeakingSets(sets, { sort: 'FEWEST' }).map((s) => s.id),
    ).toEqual(['b', 'a']);
    expect(speakingSetFacets(sets)).toEqual({
      total: 2,
      published: 1,
      levels: ['STARTER', 'INTERMEDIATE'],
    });
  });
});

describe('firstImageByQuiz', () => {
  it('keeps the first image of each quiz and skips rows without one', () => {
    const images = firstImageByQuiz([
      { quizId: 1, content: { imageUrl: '' } },
      { quizId: 1, content: { imageUrl: 'https://a' } },
      { quizId: 1, content: { imageUrl: 'https://b' } },
      { quizId: 2, content: { prompt: 'no image' } },
      { quizId: null, content: { imageUrl: 'https://c' } },
    ]);
    expect([...images]).toEqual([[1, 'https://a']]);
  });
});

describe('search by Vietnamese title', () => {
  it('keeps rows the frontend matched by id', () => {
    const rows = [
      quiz(1, { title: 'Writing A2' }),
      quiz(2, { title: 'Other' }),
    ];
    const found = filterQuizList(rows as any, { q: 'viết câu', titleIds: '1' });
    expect(found.map((row) => row.id)).toEqual([1]);
  });
});

/**
 * Writing kinds (owner 2026-11-19): "Dịch câu" sits on WRITING_PICTURE, so the
 * old type filter listed it under "Viết theo tranh".
 */
describe('writing kind filter', () => {
  const rows = [
    // "Dịch câu": WRITING_PICTURE under its own topic.
    {
      id: 1,
      type: 'WRITING_PICTURE',
      writingKind: writingKindOf({
        type: 'WRITING_PICTURE',
        isTranslation: true,
        taskTypes: ['SENTENCE_TRANSLATION'],
      }),
    },
    // Picture exercise with images and picture tasks.
    {
      id: 2,
      type: 'WRITING_PICTURE',
      writingKind: writingKindOf({
        type: 'WRITING_PICTURE',
        taskTypes: ['PICTURE_SENTENCE'],
        hasImage: true,
      }),
    },
    // Plain sentences on the picture type.
    {
      id: 3,
      type: 'WRITING_PICTURE',
      writingKind: writingKindOf({
        type: 'WRITING_PICTURE',
        taskTypes: ['SENTENCE'],
      }),
    },
    {
      id: 4,
      type: 'WRITING_EMAIL',
      writingKind: writingKindOf({
        type: 'WRITING_EMAIL',
        taskTypes: ['EMAIL'],
      }),
    },
  ];
  const ids = (kind: string) =>
    filterQuizList(rows, { kind }).map((row) => row.id);

  it('tells the four kinds apart', () => {
    expect(rows.map((row) => row.writingKind)).toEqual([
      'TRANSLATION',
      'PICTURE',
      'SENTENCE',
      'EMAIL',
    ]);
  });

  it('lists picture exercises without the translation ones', () => {
    expect(ids('PICTURE')).toEqual([2]);
    expect(ids('TRANSLATION')).toEqual([1]);
    expect(ids('SENTENCE')).toEqual([3]);
    expect(ids('EMAIL')).toEqual([4]);
    expect(ids('ALL').sort()).toEqual([1, 2, 3, 4]);
  });

  it('still answers the old type filter', () => {
    expect(
      filterQuizList(rows, { type: 'WRITING_PICTURE' })
        .map((row) => row.id)
        .sort(),
    ).toEqual([1, 2, 3]);
  });

  it('knows a translation task even without its topic, and a picture by its image', () => {
    expect(
      writingKindOf({
        type: 'WRITING_PICTURE',
        taskTypes: ['sentence_translation'],
      }),
    ).toBe('TRANSLATION');
    expect(writingKindOf({ type: 'WRITING_PICTURE', hasImage: true })).toBe(
      'PICTURE',
    );
  });

  it('uses the kind saved with the exercise first (QA 2026-11-22)', () => {
    // An empty "Viết câu" reopened as "Viết theo tranh": its kind is now saved.
    expect(
      writingKindOf({
        type: 'WRITING_PICTURE',
        stored: storedWritingKind({ writingKind: 'SENTENCE' }),
        questionCount: 0,
      }),
    ).toBe('SENTENCE');
    // The saved kind wins over what the tasks suggest.
    expect(
      writingKindOf({
        type: 'WRITING_PICTURE',
        stored: 'PICTURE',
        taskTypes: ['SENTENCE'],
      }),
    ).toBe('PICTURE');
    // A saved kind that does not fit the quiz type is ignored.
    expect(
      writingKindOf({
        type: 'WRITING_PICTURE',
        stored: 'EMAIL',
        taskTypes: ['SENTENCE'],
      }),
    ).toBe('SENTENCE');
    expect(writingKindOf({ type: 'WRITING_EMAIL', stored: 'SENTENCE' })).toBe(
      'EMAIL',
    );
  });

  it('reads an empty picture exercise with no saved kind as PICTURE, not SENTENCE', () => {
    expect(
      writingKindOf({
        type: 'WRITING_PICTURE',
        taskTypes: [],
        questionCount: 0,
      }),
    ).toBe('PICTURE');
    expect(storedWritingKind({ writingKind: 'VIDEO' })).toBeUndefined();
    expect(storedWritingKind(null)).toBeUndefined();
    expect(storedWritingKind([{ en: 'x' }])).toBeUndefined();
  });

  it('treats a DIALOGUE question as the transcript holder, not a question', () => {
    expect(isTranscriptHolder({ type: 'DIALOGUE' })).toBe(true);
    expect(isTranscriptHolder({ type: 'MULTIPLE_CHOICE' })).toBe(false);
    expect(isTranscriptHolder({ type: 'DICTATION' })).toBe(false);
  });

  it('collects task types per quiz and skips rows without one', () => {
    const types = taskTypesByQuiz([
      { quizId: 7, content: { taskType: 'PICTURE_SENTENCE' } },
      { quizId: 7, content: { taskType: ' SENTENCE ' } },
      { quizId: 8, content: {} },
      { quizId: null, content: { taskType: 'EMAIL' } },
    ]);
    expect(types.get(7)).toEqual(['PICTURE_SENTENCE', 'SENTENCE']);
    expect(types.has(8)).toBe(false);
  });
});
