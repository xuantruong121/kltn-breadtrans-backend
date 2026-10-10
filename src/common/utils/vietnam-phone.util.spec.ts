import { isValidVietnamPhone, normalizeVietnamPhone } from './vietnam-phone.util';

describe('VietnamPhoneUtil', () => {
  it('validates standard 10-digit mobile numbers', () => {
    expect(isValidVietnamPhone('0987654321')).toBe(true);
    expect(isValidVietnamPhone('0901234567')).toBe(true);
    expect(isValidVietnamPhone('0398765432')).toBe(true);
    expect(isValidVietnamPhone('0771234567')).toBe(true);
    expect(isValidVietnamPhone('0868889999')).toBe(true);
  });

  it('validates numbers with country code (+84 or 84)', () => {
    expect(isValidVietnamPhone('+84987654321')).toBe(true);
    expect(isValidVietnamPhone('84987654321')).toBe(true);
  });

  it('validates numbers with separators and spaces', () => {
    expect(isValidVietnamPhone('098 765 4321')).toBe(true);
    expect(isValidVietnamPhone('098-765-4321')).toBe(true);
    expect(isValidVietnamPhone('(098) 765-4321')).toBe(true);
  });

  it('rejects invalid numbers, letters, or short inputs', () => {
    expect(isValidVietnamPhone('123')).toBe(false);
    expect(isValidVietnamPhone('abc')).toBe(false);
    expect(isValidVietnamPhone('098abc4321')).toBe(false);
    expect(isValidVietnamPhone('0123456789')).toBe(false);
    expect(isValidVietnamPhone('')).toBe(false);
    expect(isValidVietnamPhone(null as any)).toBe(false);
  });

  it('normalizes to E.164 and display formats', () => {
    const norm = normalizeVietnamPhone('0987654321');
    expect(norm).toEqual({
      e164: '+84987654321',
      display: '0987654321',
    });

    const normWithPlus = normalizeVietnamPhone('+84987654321');
    expect(normWithPlus).toEqual({
      e164: '+84987654321',
      display: '0987654321',
    });
  });
});
