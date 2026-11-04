import {
  expiryMilestone,
  planExpiryMessage,
  planExpiryType,
} from './plan-expiry-message';

// 09:00 job on 2026-11-04 (Vietnam): the day starts at 2026-11-03T17:00Z.
const dayStart = new Date('2026-11-04T00:00:00+07:00');
const endingOnVnDay = (day: string, time = '15:30') =>
  new Date(`${day}T${time}:00+07:00`);

describe('expiryMilestone', () => {
  it.each([
    ['2026-11-11', 7],
    ['2026-11-07', 3],
    ['2026-11-05', 1],
    ['2026-11-04', 0],
  ])('a plan ending on %s reaches milestone D-%i', (day, milestone) => {
    expect(expiryMilestone(endingOnVnDay(day), dayStart)).toBe(milestone);
  });

  it('other days are not milestones', () => {
    for (const day of ['2026-11-06', '2026-11-08', '2026-11-12'])
      expect(expiryMilestone(endingOnVnDay(day), dayStart)).toBeNull();
  });

  it('counts Vietnam days: 23:30 Vietnam time is still that day', () => {
    expect(
      expiryMilestone(endingOnVnDay('2026-11-05', '23:30'), dayStart),
    ).toBe(1);
  });

  it('a plan ending exactly at midnight ends on the day before', () => {
    expect(
      expiryMilestone(new Date('2026-11-05T00:00:00+07:00'), dayStart),
    ).toBe(0);
  });
});

describe('planExpiryMessage', () => {
  it('says what the learner did, when it ends in Vietnam time, and that renewing loses no day', () => {
    const message = planExpiryMessage({
      planName: 'Plus',
      milestone: 3,
      endsAt: endingOnVnDay('2026-11-07'),
      practicedCount: 12,
      streak: 9,
      learnerName: 'Linh',
    });
    expect(message.title).toBe('Gói Plus còn 3 ngày');
    expect(message.body).toContain('đã luyện 12 bài, chuỗi học đang là 9 ngày');
    expect(message.body).toContain('15:30 ngày 07/11/2026');
    expect(message.body).toContain('gói mới bắt đầu đúng lúc');
    expect(message.url).toBe('/plans');
  });

  it('the last day, nothing practised, and a name with HTML stays escaped in the email', () => {
    const message = planExpiryMessage({
      planName: 'Pro',
      milestone: 0,
      endsAt: endingOnVnDay('2026-11-04'),
      practicedCount: 0,
      streak: 0,
      learnerName: '<b>Nam</b>',
    });
    expect(message.title).toBe('Gói Pro hết hạn hôm nay');
    expect(message.body).not.toContain('đã luyện');
    expect(message.emailHtml).toContain('&lt;b&gt;Nam&lt;/b&gt;');
    expect(message.emailHtml).not.toContain('<b>Nam</b>');
  });

  it('one notification type per plan and milestone', () => {
    expect(planExpiryType(40, 3)).toBe('plan_expiry:40:d3');
  });
});
