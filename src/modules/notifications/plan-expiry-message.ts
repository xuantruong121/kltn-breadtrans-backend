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

export function planExpiryMessage(input: {
  planName: string;
  milestone: PlanExpiryMilestone;
  endsAt: Date;
  practicedCount: number;
  streak: number;
  learnerName?: string | null;
}) {
  const ending = vnDateTime(input.endsAt);
  const title =
    input.milestone === 0
      ? `Gói ${input.planName} hết hạn hôm nay`
      : `Gói ${input.planName} còn ${input.milestone} ngày`;
  const done =
    input.practicedCount > 0
      ? `Trong kỳ này bạn đã luyện ${input.practicedCount} bài${input.streak > 1 ? `, chuỗi học đang là ${input.streak} ngày` : ''}. `
      : '';
  const body = `${done}Gói hết hạn lúc ${ending}. Gia hạn ngay bây giờ không mất ngày nào: gói mới bắt đầu đúng lúc gói hiện tại kết thúc.`;
  const greeting = input.learnerName
    ? `Chào ${input.learnerName},`
    : 'Chào bạn,';
  return {
    title,
    body,
    url: '/plans',
    emailSubject: `BreadTrans - ${title}`,
    emailHtml: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p><p>Gia hạn tại trang Gói dịch vụ trong ứng dụng BreadTrans.</p>`,
  };
}
