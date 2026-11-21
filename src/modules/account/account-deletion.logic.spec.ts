import {
  DELETION_GRACE_DAYS,
  KEPT_TABLES,
  cancelTokenKey,
  deletionScheduledAt,
  hasKeptRecords,
  isRecordingKey,
  ownedRecordingKey,
  shellEmail,
} from './account-deletion.logic';

describe('account deletion logic (owner 2026-11-16)', () => {
  describe('deletionScheduledAt (owner 2026-11-21: purge at 00:02)', () => {
    // Vietnam time is UTC+7: 00:00 on day D is 17:00Z on day D-1.
    it('schedules 00:00 Vietnam time after 7 full days, inside the 20-day limit', () => {
      // 15:00 on 21/11 in Vietnam.
      const at = new Date('2026-11-21T08:00:00.000Z');
      expect(DELETION_GRACE_DAYS).toBe(7);
      // 00:00 on 29/11 in Vietnam.
      expect(deletionScheduledAt(at).toISOString()).toBe(
        '2026-11-28T17:00:00.000Z',
      );
    });

    it('counts the request day by Vietnam time at both ends of the day', () => {
      // 00:01 on 21/11 in Vietnam (still 20/11 in UTC).
      expect(
        deletionScheduledAt(new Date('2026-11-20T17:01:00.000Z')).toISOString(),
      ).toBe('2026-11-28T17:00:00.000Z');
      // 23:59 on 21/11 in Vietnam.
      expect(
        deletionScheduledAt(new Date('2026-11-21T16:59:00.000Z')).toISOString(),
      ).toBe('2026-11-28T17:00:00.000Z');
    });

    it('always leaves at least 7 full days, across a month end', () => {
      // 23:59 on 30/11 in Vietnam -> 00:00 on 08/12.
      const at = new Date('2026-11-30T16:59:00.000Z');
      const scheduled = deletionScheduledAt(at);
      expect(scheduled.toISOString()).toBe('2026-12-07T17:00:00.000Z');
      expect(scheduled.getTime() - at.getTime()).toBeGreaterThanOrEqual(
        7 * 86_400_000,
      );
    });
  });

  it('gives the shell an address that is unique and not a mailbox', () => {
    const now = new Date(1_700_000_000_000);
    expect(shellEmail(42, now)).toBe(
      'deleted-42-1700000000000@deleted.invalid',
    );
  });

  it('namespaces the cancel token in Redis', () => {
    expect(cancelTokenKey('abc')).toBe('account:deletion:cancel:abc');
  });

  it('keeps an account as a shell when any kept table has a row', () => {
    const none = Object.fromEntries(KEPT_TABLES.map((t) => [t, 0])) as Record<
      (typeof KEPT_TABLES)[number],
      number
    >;
    expect(hasKeptRecords(none)).toBe(false);
    expect(hasKeptRecords({ ...none, banhTransaction: 1 })).toBe(true);
    expect(hasKeptRecords({ ...none, currencyTransaction: 2 })).toBe(true);
  });

  it('keeps orders, payments, plans, the ledger and used promos', () => {
    expect([...KEPT_TABLES].sort()).toEqual(
      [
        'banhTransaction',
        'currencyTransaction',
        'marketOrder',
        'marketPhysicalRedemption',
        'payOSPaymentIntent',
        'planPurchase',
        'promoRedemption',
        'subscription',
      ].sort(),
    );
  });

  describe('ownedRecordingKey (security review 2026-11-21)', () => {
    const speaking = (key: string | null) => ({
      kind: 'speaking' as const,
      key,
    });
    const diagnostic = (key: string) => ({
      kind: 'diagnostic' as const,
      key,
      assessmentId: 5,
      attemptId: 61,
    });

    it("keeps the learner's own speaking recordings and upload intents", () => {
      for (const key of [
        'premium/speaking/practice/19/0b8f.wav',
        'premium/speaking/practice/legacy/19/a.webm',
        'premium/speaking/practice/pending/19/abc.wav',
        'speaking/pending/19/abc.wav',
      ])
        expect(ownedRecordingKey(speaking(key), 19)).toBe(key);
    });

    it('keeps a diagnostic answer only under its own assessment and attempt', () => {
      expect(
        ownedRecordingKey(
          diagnostic('premium/speaking/diagnostic/5/61/12/x.webm'),
          19,
        ),
      ).toBe('premium/speaking/diagnostic/5/61/12/x.webm');
      expect(
        ownedRecordingKey(
          diagnostic('premium/speaking/diagnostic/5/62/12/x.webm'),
          19,
        ),
      ).toBeNull();
    });

    it("never returns another user's recording, shared media or a typed value", () => {
      for (const key of [
        'premium/speaking/practice/20/0b8f.wav', // another learner
        'premium/speaking/practice/190/0b8f.wav', // id prefix of another id
        'premium/listening/quiz-12/audio/v1/full.mp3', // paid listening audio
        'ai/toeic-exams/exam-5/writing/1.jpg', // exam media
        'avatars/x.png',
        'https://cdn.example.com/premium/speaking/practice/19/a.wav',
        '/premium/speaking/practice/19/a.wav',
        'premium/speaking/practice/19/../20/a.wav',
        'premium\\speaking\\practice\\19\\a.wav',
        '',
      ])
        expect(ownedRecordingKey(speaking(key), 19)).toBeNull();
      expect(ownedRecordingKey(speaking(null), 19)).toBeNull();
    });

    it('retries only recording keys from the queue', () => {
      expect(isRecordingKey('premium/speaking/practice/19/a.wav')).toBe(true);
      expect(isRecordingKey('premium/speaking/diagnostic/5/61/1/a.webm')).toBe(
        true,
      );
      expect(
        isRecordingKey('premium/listening/quiz-12/audio/v1/full.mp3'),
      ).toBe(false);
      expect(isRecordingKey('ai/toeic-exams/exam-5/writing/1.jpg')).toBe(false);
      expect(isRecordingKey('premium/speaking/practice/../../x')).toBe(false);
      expect(isRecordingKey('')).toBe(false);
    });
  });
});
