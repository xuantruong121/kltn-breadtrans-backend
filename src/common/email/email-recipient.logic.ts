/**
 * Addresses no mail is sent to. Seed and demo accounts use domains nobody owns
 * (student1@breadtrans.com, probes @breadtrans.local); mail to them only comes
 * back to the sender as a bounce. Pure: no I/O.
 *
 * Always skipped: the names reserved for tests (RFC 2606, RFC 6761). Also
 * skipped: the domains in EMAIL_SKIP_DOMAINS (comma list) and their subdomains.
 */

const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];
const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost', 'local'];

/** "a.com, @b.vn ,*.c.local" -> ["a.com", "b.vn", "c.local"] */
export function parseSkipDomains(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((d) =>
      d
        .trim()
        .toLowerCase()
        .replace(/^(\*\.|@)/, ''),
    )
    .filter(Boolean);
}

/** Lower-case domain of an address, or null without one. */
export function recipientDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  const domain =
    at === -1
      ? ''
      : email
          .slice(at + 1)
          .trim()
          .toLowerCase();
  return domain || null;
}

export function isSkippedRecipient(
  email: string,
  skipDomains: string[],
): boolean {
  const domain = recipientDomain(email);
  if (!domain) return false;
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (RESERVED_TLDS.includes(tld)) return true;
  return [...RESERVED_DOMAINS, ...skipDomains].some(
    (d) => domain === d || domain.endsWith(`.${d}`),
  );
}
