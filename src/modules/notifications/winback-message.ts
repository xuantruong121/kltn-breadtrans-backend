/**
 * The win-back message: sent a few Vietnam days after a paid plan ended to a
 * learner who has not bought again, with a personal discount code. Pure.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Notification type, one per ended subscription, so a rerun sends nothing new. */
export const winbackType = (subscriptionId: number) =>
  `winback:${subscriptionId}`;

/** Vietnam calendar day number of a moment. */
const vnDay = (date: Date) =>
  Math.floor((date.getTime() + VN_OFFSET_MS) / DAY_MS);

/**
 * A plan ending at `endsAt` gets its win-back on the Vietnam day that starts
 * at `dayStart` when that day is exactly `afterDays` after the plan's last day.
 */
export function isWinbackDay(
  endsAt: Date,
  dayStart: Date,
  afterDays: number,
): boolean {
  // A plan ending exactly at midnight ends at the close of the previous day.
  const lastDay = vnDay(new Date(endsAt.getTime() - 1));
  return vnDay(dayStart) - lastDay === afterDays;
}

const two = (n: number) => String(n).padStart(2, '0');
function vnDateTime(date: Date) {
  const local = new Date(date.getTime() + VN_OFFSET_MS);
  return `${two(local.getUTCHours())}:${two(local.getUTCMinutes())} ngày ${two(local.getUTCDate())}/${two(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}`;
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export function winbackMessage(input: {
  planName: string;
  code: string;
  percentOff: number;
  validTo: Date;
  learnerName?: string | null;
}) {
  const until = vnDateTime(input.validTo);
  const title = `Mã giảm ${input.percentOff}% để học tiếp`;
  const body = `Gói ${input.planName} của bạn đã hết hạn. Dùng mã ${input.code} để giảm ${input.percentOff}% khi mua lại gói bất kỳ, hạn dùng đến ${until}. Mã chỉ dành cho tài khoản của bạn.`;
  const greeting = input.learnerName
    ? `Chào ${input.learnerName},`
    : 'Chào bạn,';
  return {
    title,
    body,
    url: `/plans?promo=${encodeURIComponent(input.code)}`,
    emailSubject: `BreadTrans - ${title}`,
    emailHtml: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p><p>Nhập mã ở trang Gói dịch vụ trong ứng dụng BreadTrans.</p>`,
  };
}
