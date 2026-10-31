import {
  audioToneOf,
  displayTitle,
  filterQuizList,
  filterSpeakingSets,
  quizListFacets,
  speakingSetFacets,
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
});

describe('skill CMS list rules', () => {
  const rows = [
    quiz(1, {
      title: 'Hội thoại B1 — Đặt phòng',
      publicationStatus: 'PUBLISHED',
      bilingualContent: { mode: 'DIALOGUE' },
      listeningAudioArtifacts: [{ version: 2, status: 'PUBLISHED' }],
    }),
    quiz(2, {
      title: 'Nghe hiểu A2 — Sân bay',
      bilingualContent: { mode: 'COMPREHENSION' },
      questionsWithAudio: 1,
      _count: { questions: 3 },
    }),
    quiz(3, {
      title: 'Chép chính tả A1 — Số đếm',
      bilingualContent: { mode: 'DICTATION' },
      _count: { questions: 1 },
    }),
    quiz(4, {
      type: 'WRITING_EMAIL',
      level: 'B2',
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

  it('filters by search, status, level from the title, mode, audio and type', () => {
    const ids = (query: Record<string, string>) =>
      filterQuizList(rows, query).map((row) => row.id);
    expect(ids({ q: 'sân BAY' })).toEqual([2]);
    expect(ids({ q: 'xin nghỉ' })).toEqual([4]);
    expect(ids({ status: 'PUBLISHED' })).toEqual([1]);
    expect(ids({ level: 'A1' })).toEqual([3]);
    expect(ids({ level: 'B2' })).toEqual([4]);
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
      levels: ['A1', 'A2', 'B1', 'B2'],
    });
  });
});

describe('speaking set list rules', () => {
  const sets = [
    {
      id: 'a',
      title: 'Giới thiệu bản thân',
      category: 'Daily',
      level: 'A1',
      publicationStatus: 'PUBLISHED',
      updatedAt: '2026-10-01',
      exerciseCount: 5,
    },
    {
      id: 'b',
      title: 'Phỏng vấn xin việc',
      category: 'Work',
      level: 'B2',
      publicationStatus: 'DRAFT',
      updatedAt: '2026-10-20',
      exerciseCount: 2,
    },
  ];

  it('filters and sorts sets', () => {
    expect(filterSpeakingSets(sets, {}).map((s) => s.id)).toEqual(['b', 'a']);
    expect(filterSpeakingSets(sets, { q: 'work' }).map((s) => s.id)).toEqual([
      'b',
    ]);
    expect(filterSpeakingSets(sets, { level: 'A1' }).map((s) => s.id)).toEqual([
      'a',
    ]);
    expect(
      filterSpeakingSets(sets, { sort: 'TITLE' }).map((s) => s.id),
    ).toEqual(['a', 'b']);
    expect(
      filterSpeakingSets(sets, { sort: 'FEWEST' }).map((s) => s.id),
    ).toEqual(['b', 'a']);
    expect(speakingSetFacets(sets)).toEqual({
      total: 2,
      published: 1,
      levels: ['A1', 'B2'],
    });
  });
});
