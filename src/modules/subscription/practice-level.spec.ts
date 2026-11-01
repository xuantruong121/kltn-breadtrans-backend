import {
  cefrSpan,
  levelGroup,
  levelLabel,
  isDictationContent,
  parseCefrRange,
  titleWithLevel,
  practiceRequiresPlus,
  requiredPracticePlan,
} from './practice-level';

describe('titleWithLevel', () => {
  it('adds the tag access reads to an untagged title', () => {
    const title = titleWithLevel('Ordering office supplies', 'C1', 'Writing');
    expect(title).toBe('Writing C1 — Ordering office supplies');
    expect(parseCefrRange(title)).toEqual({ min: 'C1', max: 'C1' });
  });

  it('replaces the tag when another level is picked', () => {
    expect(titleWithLevel('Reading A2 — Notices', 'B2', 'Reading')).toBe(
      'Reading B2 — Notices',
    );
  });

  it('keeps a title already at that level', () => {
    expect(titleWithLevel('Nghe chép A2 — Du lịch', 'A2', 'Listening')).toBe(
      'Nghe chép A2 — Du lịch',
    );
  });

  it('never shrinks a range the picked level sits inside', () => {
    expect(titleWithLevel('Reading A1–A2 — Everyday', 'A1', 'Reading')).toBe(
      'Reading A1–A2 — Everyday',
    );
  });

  it('replaces a range when the level is outside it', () => {
    expect(titleWithLevel('Reading A1–A2 — Everyday', 'C1', 'Reading')).toBe(
      'Reading C1 — Everyday',
    );
  });

  it('does not read a level out of the name of the lesson', () => {
    expect(titleWithLevel('Road to B2 fluency', 'A2', 'Reading')).toBe(
      'Reading A2 — Road to B2 fluency',
    );
  });

  it('leaves the title alone without a known level', () => {
    expect(titleWithLevel(' Bài đọc ', '', 'Reading')).toBe('Bài đọc');
    expect(titleWithLevel('Bài đọc', 'ALL', 'Reading')).toBe('Bài đọc');
  });
});

describe('practice level policy (A1/A2 free, B1+ PLUS)', () => {
  it('reads only the explicit CEFR tag at the head of a title or level', () => {
    expect(parseCefrRange('Listening B1 — Work & Meetings')).toEqual({
      min: 'B1',
      max: 'B1',
    });
    expect(parseCefrRange('Reading A1–A2 — Everyday Texts')).toEqual({
      min: 'A1',
      max: 'A2',
    });
    expect(parseCefrRange('Nghe chép A2 — Du lịch và chỉ đường')).toEqual({
      min: 'A2',
      max: 'A2',
    });
    expect(parseCefrRange('B1-C1')).toEqual({ min: 'B1', max: 'C1' });
    // A level mentioned after the separator is not the item's level.
    expect(parseCefrRange('TOEIC Speaking — Read Aloud B2 style')).toBeNull();
    expect(parseCefrRange('Viết câu theo tranh — Tủ tài liệu')).toBeNull();
    expect(parseCefrRange(null)).toBeNull();
  });

  it('A1/A2 are free; anything reaching B1 needs PLUS', () => {
    expect(practiceRequiresPlus({ min: 'A1', max: 'A2' })).toBe(false);
    expect(practiceRequiresPlus({ min: 'B1', max: 'B1' })).toBe(true);
    expect(practiceRequiresPlus({ min: 'A2', max: 'B1' })).toBe(true);
    expect(practiceRequiresPlus({ min: 'C1', max: 'C2' })).toBe(true);
  });

  it('groups and labels; a range across groups has no single group', () => {
    expect(levelGroup({ min: 'A1', max: 'A2' })).toBe('BASIC');
    expect(levelGroup({ min: 'B1', max: 'B2' })).toBe('INTERMEDIATE');
    expect(levelGroup({ min: 'C1', max: 'C1' })).toBe('ADVANCED');
    expect(levelGroup({ min: 'A2', max: 'B1' })).toBeNull();
    expect(levelLabel({ min: 'A1', max: 'A2' })).toBe('Cơ bản · A1–A2');
    expect(levelLabel({ min: 'B1', max: 'B1' })).toBe('Trung cấp · B1');
    expect(levelLabel({ min: 'B2', max: 'C1' })).toBeNull();
  });

  it('exposes one level string per item, or null without a tag', () => {
    expect(cefrSpan(parseCefrRange('Writing B1 — Professional Email'))).toBe(
      'B1',
    );
    expect(cefrSpan(parseCefrRange('Writing B2–C1 — Argument'))).toBe('B2-C1');
    expect(cefrSpan(parseCefrRange('A1-A2'))).toBe('A1-A2');
    expect(cefrSpan(parseCefrRange('Untitled'))).toBeNull();
  });
});

describe('plan matrix (owner 2026-10-30)', () => {
  const r = (v: string) => parseCefrRange(v)!;
  it.each([
    ['READING', 'C2', false, 'FREE'],
    ['LISTENING', 'C1', false, 'FREE'],
    ['LISTENING', 'A2', true, 'FREE'],
    ['LISTENING', 'B1', true, 'PLUS'],
    ['LISTENING', 'C2', true, 'PLUS'],
    ['SPEAKING', 'A1-A2', false, 'FREE'],
    ['SPEAKING', 'B1-B2', false, 'PLUS'],
    ['WRITING', 'B2-C1', false, 'PRO'],
    ['WRITING', 'C2', false, 'PRO'],
  ] as const)('%s %s (dictation %s) -> %s', (skill, level, dictation, plan) => {
    expect(requiredPracticePlan(skill, r(level), { dictation })).toBe(plan);
  });

  it('recognises dictation only from the stored mode', () => {
    expect(isDictationContent({ mode: 'DICTATION' })).toBe(true);
    expect(isDictationContent({ mode: 'DIALOGUE' })).toBe(false);
    expect(isDictationContent(null)).toBe(false);
  });
});
