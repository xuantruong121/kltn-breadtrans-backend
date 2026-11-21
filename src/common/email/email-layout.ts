/**
 * One HTML layout for BreadTrans emails (owner 2026-11-21: the plan reminder
 * read as bare lines with no way to act). Table layout with inline styles so
 * Gmail, Outlook and phone clients render it the same; every text is escaped
 * here, callers pass plain text.
 */
export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export type EmailContent = {
  /** Shown by mail clients next to the subject, hidden in the body. */
  preheader: string;
  greeting: string;
  paragraphs: string[];
  /** One button; its address is also written out for clients that block buttons. */
  action?: { label: string; url: string };
  signOff: string[];
  /** Why the reader got this email. */
  footer: string;
};

const FONT = 'Arial,Helvetica,sans-serif';

export function renderEmail(content: EmailContent): string {
  const paragraph = (text: string) =>
    `<p style="margin:0 0 16px;">${escapeHtml(text)}</p>`;
  const action = content.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td style="border-radius:8px;background:#d97706;"><a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:12px 24px;font:700 15px/1.2 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(content.action.label)}</a></td></tr></table>` +
      `<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#475569;">Nếu nút trên không mở được, hãy truy cập: <a href="${escapeHtml(content.action.url)}" style="color:#1d4ed8;">${escapeHtml(content.action.url)}</a></p>`
    : '';
  const signOff = content.signOff.map(escapeHtml).join('<br>');
  return [
    '<!doctype html><html lang="vi"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>BreadTrans</title></head>`,
    '<body style="margin:0;padding:0;background:#f1f5f9;">',
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preheader)}</div>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">',
    `<tr><td style="padding:24px 28px 4px;font:700 20px/1.3 ${FONT};color:#b45309;">BreadTrans</td></tr>`,
    `<tr><td style="padding:16px 28px 8px;font:16px/1.6 ${FONT};color:#1e293b;">`,
    paragraph(content.greeting),
    ...content.paragraphs.map(paragraph),
    action,
    `<p style="margin:0 0 8px;">${signOff}</p>`,
    '</td></tr>',
    `<tr><td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;font:13px/1.5 ${FONT};color:#64748b;">${escapeHtml(content.footer)}</td></tr>`,
    '</table></td></tr></table></body></html>',
  ].join('');
}
