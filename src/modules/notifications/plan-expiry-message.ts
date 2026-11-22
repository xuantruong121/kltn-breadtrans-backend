import { renderEmail } from '../../common/email/email-layout';

/**
 * Reminders before a paid plan ends (no automatic renewal: plans are bought
 * 30/90/180 days at a time). Sent 7, 3 and 1 days before and on the last day,
 * counted in Vietnam calendar days, with what the learner did in the plan.
 */
export const PLAN_EXPIRY_MILESTONES = [7, 3, 1, 0] as const;
export type PlanExpiryMilestone = (typeof PLAN_EXPIRY_MILESTONES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Vietnam calendar day number of a moment (days since epoch, UTC+7). */
const vnDay = (date: Date) =>
  Math.floor((date.getTime() + VN_OFFSET_MS) / DAY_MS);

/**
 * The milestone a plan ending at `endsAt` has reached on the Vietnam day that
 * starts at `dayStart`, or null on any other day.
 */
export function expiryMilestone(
  endsAt: Date,
  dayStart: Date,
): PlanExpiryMilestone | null {
  // A plan ending exactly at midnight ends at the close of the previous day.
  const lastDay = vnDay(new Date(endsAt.getTime() - 1));
  const daysLeft = lastDay - vnDay(dayStart);
  return (PLAN_EXPIRY_MILESTONES as readonly number[]).includes(daysLeft)
    ? (daysLeft as PlanExpiryMilestone)
    : null;
}

/** Notification type, unique per plan and milestone, so a rerun sends nothing new. */
export const planExpiryType = (
  subscriptionId: number,
  milestone: PlanExpiryMilestone,
) => `plan_expiry:${subscriptionId}:d${milestone}`;

const two = (n: number) => String(n).padStart(2, '0');
/** "20:06" and "22/11/2026" in Vietnam time. */
function vnTimeAndDate(date: Date) {
  const local = new Date(date.getTime() + VN_OFFSET_MS);
  return {
    time: `${two(local.getUTCHours())}:${two(local.getUTCMinutes())}`,
    date: `${two(local.getUTCDate())}/${two(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}`,
  };
}

/** "hết hạn hôm nay" / "sẽ hết hạn vào ngày mai" / "sẽ hết hạn sau 3 ngày". */
function whenItEnds(milestone: PlanExpiryMilestone) {
  if (milestone === 0) return 'hết hạn hôm nay';
  if (milestone === 1) return 'sẽ hết hạn vào ngày mai';
  return `sẽ hết hạn sau ${milestone} ngày`;
}

/**
 * The bell and push text (short) and the email (owner 2026-11-21: the old
 * email read as two blunt lines, "Trong kỳ này…" was unclear and nothing
 * could be clicked). `appUrl` is the web app's address, for the email button.
 */
export function planExpiryMessage(input: {
  planName: string;
  milestone: PlanExpiryMilestone;
  endsAt: Date;
  practicedCount: number;
  streak: number;
  learnerName?: string | null;
  appUrl: string;
}) {
  const plan = input.planName;
  const { time, date } = vnTimeAndDate(input.endsAt);
  const when = whenItEnds(input.milestone);
  const title = `Gói ${plan} ${when.replace(/^sẽ /, '')}`;
  const body = `Gói ${plan} hết hạn lúc ${time} ngày ${date}. Gia hạn trước thời điểm này để gói mới nối tiếp ngay, không mất ngày học nào.`;
  const name = input.learnerName?.trim();
  const plansUrl = `${input.appUrl.replace(/\/+$/, '')}/plans`;
  const progress =
    input.practicedCount > 0
      ? `Từ khi bắt đầu gói, bạn đã hoàn thành ${input.practicedCount} bài luyện tập${
          input.streak > 1
            ? ` và đang giữ chuỗi học ${input.streak} ngày liên tiếp`
            : ''
        }. Hãy tiếp tục giữ nhịp học này nhé!`
      : null;
  const emailHtml = renderEmail({
    preheader: `Gia hạn trước ${time} ngày ${date} để việc học không bị gián đoạn.`,
    greeting: name ? `Chào ${name},` : 'Chào bạn,',
    paragraphs: [
      input.milestone === 0
        ? `Gói BreadTrans ${plan} của bạn hết hạn hôm nay, lúc ${time} (ngày ${date}).`
        : `Gói BreadTrans ${plan} của bạn ${when}, lúc ${time} ngày ${date}.`,
      ...(progress ? [progress] : []),
      'Nếu gia hạn trước thời điểm trên, gói mới sẽ bắt đầu ngay khi gói hiện tại kết thúc, nên bạn không mất ngày học nào.',
      `Sau khi gói hết hạn, tài khoản trở về gói Free. Các nội dung dành cho gói ${plan} sẽ tạm khoá, còn tiến độ và kết quả học tập của bạn vẫn được giữ nguyên.`,
    ],
    action: { label: `Gia hạn gói ${plan}`, url: plansUrl },
    signOff: ['Chúc bạn học tốt,', 'Đội ngũ BreadTrans'],
    footer: `Bạn nhận được email này vì đang dùng gói ${plan} trên BreadTrans. Đây là email tự động, vui lòng không trả lời.`,
  });
  return {
    title,
    body,
    url: '/plans',
    emailSubject: `Gói ${plan} của bạn ${when}`,
    emailHtml,
  };
}
