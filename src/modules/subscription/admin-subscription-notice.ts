/** What a learner reads after an admin changes their plan. */
const date = (value: Date) =>
  value.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

const PLAN_URL = '/hub?tab=account-plan';

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
