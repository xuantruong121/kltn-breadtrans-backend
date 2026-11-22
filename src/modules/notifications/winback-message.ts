import { renderEmail } from '../../common/email/email-layout';

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

/**
 * The bell and push text (short) and the email (owner 2026-11-21: one tone and
 * layout for every email). `appUrl` is the web app's address, for the button.
 */
export function winbackMessage(input: {
  planName: string;
  code: string;
  percentOff: number;
  validTo: Date;
  learnerName?: string | null;
  appUrl: string;
}) {
  const until = vnDateTime(input.validTo);
  const title = `Mã giảm ${input.percentOff}% để học tiếp`;
  const body = `Gói ${input.planName} của bạn đã hết hạn. Dùng mã ${input.code} để giảm ${input.percentOff}% khi mua lại gói bất kỳ, hạn dùng đến ${until}. Mã chỉ dành cho tài khoản của bạn.`;
  const path = `/plans?promo=${encodeURIComponent(input.code)}`;
  const name = input.learnerName?.trim();
  const emailHtml = renderEmail({
    preheader: `Giảm ${input.percentOff}% cho lần mua gói tiếp theo, hạn dùng đến ${until}.`,
    greeting: name ? `Chào ${name},` : 'Chào bạn,',
    paragraphs: [
      `Gói ${input.planName} của bạn đã kết thúc. Để bạn tiếp tục lộ trình đang học dở, BreadTrans gửi tặng mã giảm ${input.percentOff}% cho lần mua gói tiếp theo:`,
      { code: input.code },
      `Mã áp dụng cho mọi gói, dùng được đến ${until} và chỉ dành cho tài khoản của bạn. Tiến độ và kết quả học tập trước đây vẫn được giữ nguyên.`,
    ],
    action: {
      label: 'Dùng mã ngay',
      url: `${input.appUrl.replace(/\/+$/, '')}${path}`,
    },
    signOff: ['Chúc bạn học tốt,', 'Đội ngũ BreadTrans'],
    footer:
      'Bạn nhận được email này vì gói của bạn trên BreadTrans vừa kết thúc. Đây là email tự động, vui lòng không trả lời.',
  });
  return {
    title,
    body,
    url: path,
    emailSubject: `Tặng bạn mã giảm ${input.percentOff}% để tiếp tục học cùng BreadTrans`,
    emailHtml,
  };
}
