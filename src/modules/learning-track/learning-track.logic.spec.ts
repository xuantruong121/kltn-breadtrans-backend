import {
  activeTrackChips,
  buildTrackUsage,
  GENERAL_TRACK,
  isPermutation,
  isTrackUsed,
  newTrackCode,
  newTrackSortOrder,
  normalizeTrackCode,
  normalizeTrackName,
  quizUsageSkill,
  sortOrderAt,
  trackChangeRefusal,
  unavailableTracks,
} from './learning-track.logic';

describe('track code and name normalisers', () => {
  it('turns a Vietnamese name into a stable code', () => {
    expect(normalizeTrackCode(' Văn phòng – Kinh doanh ')).toBe(
      'VAN_PHONG_KINH_DOANH',
    );
    expect(normalizeTrackCode('Đời sống hằng ngày')).toBe('DOI_SONG_HANG_NGAY');
    expect(normalizeTrackCode('---')).toBe('');
  });

  it('keys names without diacritics, case or extra spaces', () => {
    expect(normalizeTrackName('  Sinh viên –   Học thuật ')).toBe(
      'sinh vien – hoc thuat',
    );
    expect(normalizeTrackName('CÔNG NGHỆ thông tin')).toBe(
      normalizeTrackName('Công nghệ Thông Tin'),
    );
  });
});

describe('newTrackCode', () => {
  it('uses the given code, normalised', () => {
    expect(newTrackCode('Y tế', 'y-te')).toBe('Y_TE');
  });

  it('makes one from the name when none is given', () => {
    expect(newTrackCode('Y tế – Điều dưỡng')).toBe('Y_TE_DIEU_DUONG');
    expect(newTrackCode('Y tế', '   ')).toBe('Y_TE');
  });

  it('cuts a long name to 40 characters without a trailing underscore', () => {
    const code = newTrackCode(`${'a'.repeat(39)} b c`);
    expect(code).toBe('A'.repeat(39));
  });

  it('refuses an empty or too long code', () => {
    expect(newTrackCode('Y tế', '!!!')).toBeNull();
    expect(newTrackCode('Y tế', 'A'.repeat(41))).toBeNull();
    expect(newTrackCode('–')).toBeNull();
  });
});

describe('trackChangeRefusal', () => {
  it('never lets GENERAL be deactivated, deleted or recoded', () => {
    expect(trackChangeRefusal(GENERAL_TRACK, 'deactivate')).toMatch(/luôn bật/);
    expect(trackChangeRefusal(GENERAL_TRACK, 'delete')).toMatch(/không xoá/);
    expect(trackChangeRefusal(GENERAL_TRACK, 'changeCode')).toMatch(
      /không đổi được/,
    );
  });

  it('lets other tracks be deactivated or deleted, never recoded', () => {
    expect(trackChangeRefusal('IT_SOFTWARE', 'deactivate')).toBeNull();
    expect(trackChangeRefusal('IT_SOFTWARE', 'delete')).toBeNull();
    expect(trackChangeRefusal('IT_SOFTWARE', 'changeCode')).not.toBeNull();
  });
});

describe('unavailableTracks', () => {
  it('refuses a new code that is not active', () => {
    expect(unavailableTracks(['A', 'OFF'], [], ['A'])).toEqual(['OFF']);
  });

  it('keeps an inactive code the item already has', () => {
    expect(unavailableTracks(['OFF', 'A'], ['OFF'], ['A'])).toEqual([]);
  });

  it('refuses an unknown code', () => {
    expect(unavailableTracks(['NOPE'], ['A'], ['A'])).toEqual(['NOPE']);
  });
});

describe('isPermutation', () => {
  const current = ['A', 'B', 'GENERAL'];

  it('accepts every code once, in any order', () => {
    expect(isPermutation(current, ['GENERAL', 'B', 'A'])).toBe(true);
  });

  it('refuses a missing, repeated or unknown code', () => {
    expect(isPermutation(current, ['A', 'B'])).toBe(false);
    expect(isPermutation(current, ['A', 'A', 'B'])).toBe(false);
    expect(isPermutation(current, ['A', 'B', 'C'])).toBe(false);
  });

  it('numbers the new order 10, 20, 30', () => {
    expect([0, 1, 2].map(sortOrderAt)).toEqual([10, 20, 30]);
  });
});

describe('newTrackSortOrder', () => {
  it('goes after the others and before GENERAL when GENERAL is last', () => {
    expect(
      newTrackSortOrder([
        { code: 'A', sortOrder: 10 },
        { code: 'B', sortOrder: 50 },
        { code: GENERAL_TRACK, sortOrder: 1000 },
      ]),
    ).toEqual({ sortOrder: 60 });
  });

  it('moves GENERAL down when it would no longer be last', () => {
    expect(
      newTrackSortOrder([
        { code: 'A', sortOrder: 10 },
        { code: GENERAL_TRACK, sortOrder: 20 },
      ]),
    ).toEqual({ sortOrder: 20, generalSortOrder: 30 });
  });

  it('goes last when an admin moved GENERAL up', () => {
    expect(
      newTrackSortOrder([
        { code: GENERAL_TRACK, sortOrder: 10 },
        { code: 'A', sortOrder: 20 },
      ]),
    ).toEqual({ sortOrder: 30 });
  });
});

describe('activeTrackChips', () => {
  it('keeps active tracks only, by sortOrder then name', () => {
    expect(
      activeTrackChips([
        { code: 'B', name: 'Bán hàng', sortOrder: 20, isActive: true },
        { code: 'OFF', name: 'Đã tắt', sortOrder: 5, isActive: false },
        { code: 'A2', name: 'Ăn uống', sortOrder: 10, isActive: true },
        { code: 'A1', name: 'An toàn', sortOrder: 10, isActive: true },
      ]),
    ).toEqual([
      { code: 'A1', name: 'An toàn', sortOrder: 10 },
      { code: 'A2', name: 'Ăn uống', sortOrder: 10 },
      { code: 'B', name: 'Bán hàng', sortOrder: 20 },
    ]);
  });
});

describe('track usage', () => {
  it('counts quiz tags by quiz type, set tags and learners', () => {
    const usage = buildTrackUsage({
      codes: ['IT_SOFTWARE', 'GENERAL', 'UNUSED'],
      quizTags: [
        { track: 'IT_SOFTWARE', quizType: 'LISTENING_PRACTICE' },
        { track: 'IT_SOFTWARE', quizType: 'BILINGUAL_READING' },
        { track: 'IT_SOFTWARE', quizType: 'WRITING_PICTURE' },
        { track: 'IT_SOFTWARE', quizType: 'WRITING_EMAIL' },
        { track: 'GENERAL', quizType: 'TOEIC' },
        { track: 'GENERAL', quizType: null },
      ],
      speakingSets: [{ track: 'GENERAL', count: 7 }],
      learners: [
        { track: 'IT_SOFTWARE', count: 2 },
        { track: 'GENERAL', count: 5 },
      ],
    });
    expect(usage.get('IT_SOFTWARE')).toEqual({
      listening: 1,
      reading: 1,
      writing: 2,
      speaking: 0,
      learners: 2,
    });
    expect(usage.get('GENERAL')).toEqual({
      listening: 0,
      reading: 0,
      writing: 0,
      speaking: 7,
      learners: 5,
    });
    expect(isTrackUsed(usage.get('UNUSED')!)).toBe(false);
    expect(isTrackUsed(usage.get('GENERAL')!)).toBe(true);
  });

  it('maps each skill quiz type to its column', () => {
    expect(quizUsageSkill('LISTENING_PRACTICE')).toBe('listening');
    expect(quizUsageSkill('BILINGUAL_READING')).toBe('reading');
    expect(quizUsageSkill('WRITING_EMAIL')).toBe('writing');
    expect(quizUsageSkill('TOEIC_FOUR_SKILL')).toBeNull();
  });
});
