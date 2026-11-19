import {
  isSkippedRecipient,
  parseSkipDomains,
  recipientDomain,
} from './email-recipient.logic';

describe('parseSkipDomains', () => {
  it('reads a comma list, lower-cased, without "@" or "*."', () => {
    expect(
      parseSkipDomains(' BreadTrans.com, @demo.vn ,*.qa.local,, '),
    ).toEqual(['breadtrans.com', 'demo.vn', 'qa.local']);
    expect(parseSkipDomains(undefined)).toEqual([]);
  });
});

describe('isSkippedRecipient', () => {
  const extra = ['breadtrans.com'];

  it('skips the configured domains and their subdomains', () => {
    expect(isSkippedRecipient('student3@breadtrans.com', extra)).toBe(true);
    expect(isSkippedRecipient('Student3@BreadTrans.COM', extra)).toBe(true);
    expect(isSkippedRecipient('a@mail.breadtrans.com', extra)).toBe(true);
  });

  it('always skips the reserved test names, even with nothing configured', () => {
    expect(isSkippedRecipient('probe@breadtrans.local', [])).toBe(true);
    expect(isSkippedRecipient('a@example.com', [])).toBe(true);
    expect(isSkippedRecipient('a@shop.example.org', [])).toBe(true);
    expect(isSkippedRecipient('a@x.test', [])).toBe(true);
    expect(isSkippedRecipient('a@x.invalid', [])).toBe(true);
  });

  it('sends to real domains, and a look-alike is not a match', () => {
    expect(isSkippedRecipient('owner@gmail.com', extra)).toBe(false);
    expect(isSkippedRecipient('a@notbreadtrans.com', extra)).toBe(false);
    expect(isSkippedRecipient('a@breadtrans.com.vn', extra)).toBe(false);
  });

  it('leaves an address without a domain to the mail server', () => {
    expect(recipientDomain('no-at-sign')).toBeNull();
    expect(isSkippedRecipient('no-at-sign', extra)).toBe(false);
  });
});
