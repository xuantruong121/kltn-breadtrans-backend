/** What a learner reads after an admin changes their plan. */
const date = (value: Date) =>
  value.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

const PLAN_URL = '/hub?tab=account-plan';

/**
 * The plan's own name ("BreadTrans Pro"). A version's display name can carry its
 * default length ("BreadTrans Pro — 30 ngày"), which is wrong for an admin grant
 * of another length; the body already gives the end date (owner 20/11).
 */
export const noticePlanName = (sub: {
  planVersion: { plan: { displayName: string } };
}) => sub.planVersion.plan.displayName;

export const grantedNotice = (plan: string, endsAt: Date) => ({
  type: 'SUBSCRIPTION_GRANTED',
  title: `Bạn được tặng gói ${plan}`,
  body: `Gói có hiệu lực đến ${date(endsAt)}.`,
  url: PLAN_URL,
});

export const extendedNotice = (plan: string, endsAt: Date) => ({
  type: 'SUBSCRIPTION_EXTENDED',
  title: `Gói ${plan} đã được gia hạn`,
  body: `Gói có hiệu lực đến ${date(endsAt)}.`,
  url: PLAN_URL,
});

export const revokedNotice = (plan: string) => ({
  type: 'SUBSCRIPTION_REVOKED',
  title: `Gói ${plan} đã bị thu hồi`,
  body: 'Nhắn cho quản trị viên nếu bạn cần được hỗ trợ.',
  url: PLAN_URL,
});
