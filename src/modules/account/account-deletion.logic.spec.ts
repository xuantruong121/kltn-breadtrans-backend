import {
  DELETION_GRACE_DAYS,
  KEPT_TABLES,
  cancelTokenKey,
  deletionScheduledAt,
  hasKeptRecords,
  shellEmail,
  storageKeyOf,
} from './account-deletion.logic';

describe('account deletion logic (owner 2026-11-16)', () => {
  it('schedules the purge 7 days after the request, inside the 20-day limit', () => {
    const at = new Date('2026-11-16T10:00:00.000Z');
    expect(DELETION_GRACE_DAYS).toBe(7);
    expect(deletionScheduledAt(at).toISOString()).toBe(
      '2026-11-23T10:00:00.000Z',
    );
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

  describe('storageKeyOf', () => {
    const base = 'https://cdn.example.com/';
    it('takes a bare key as is', () => {
      expect(storageKeyOf('premium/speaking/1/a.webm', base)).toBe(
        'premium/speaking/1/a.webm',
      );
      expect(storageKeyOf('/avatars/x.png', base)).toBe('avatars/x.png');
    });
    it('turns our public URL back into a key', () => {
      expect(
        storageKeyOf('https://cdn.example.com/avatars/a%20b.png?v=2', base),
      ).toBe('avatars/a b.png');
    });
    it('never returns a key for another host or an empty value', () => {
      expect(
        storageKeyOf('https://lh3.googleusercontent.com/a/photo', base),
      ).toBeNull();
      expect(storageKeyOf('https://cdn.example.com.evil/x', base)).toBeNull();
      expect(storageKeyOf('', base)).toBeNull();
      expect(storageKeyOf(null, base)).toBeNull();
      expect(storageKeyOf('https://cdn.example.com/x', '')).toBeNull();
    });
  });
});
