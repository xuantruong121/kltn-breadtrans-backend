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
  const appUrl = 'https://app.example.com/';

  it('the bell and push say when it ends in Vietnam time and that renewing early loses no day', () => {
    const message = planExpiryMessage({
      planName: 'Plus',
      milestone: 3,
      endsAt: endingOnVnDay('2026-11-07'),
      practicedCount: 12,
      streak: 9,
      learnerName: 'Linh',
      appUrl,
    });
    expect(message.title).toBe('Gói Plus hết hạn sau 3 ngày');
    expect(message.body).toBe(
      'Gói Plus hết hạn lúc 15:30 ngày 07/11/2026. Gia hạn trước thời điểm này để gói mới nối tiếp ngay, không mất ngày học nào.',
    );
    expect(message.url).toBe('/plans');
  });

  it('the email greets, says what the learner did, what happens after, and links to the plans page', () => {
    const message = planExpiryMessage({
      planName: 'Plus',
      milestone: 1,
      endsAt: endingOnVnDay('2026-11-05', '20:06'),
      practicedCount: 4,
      streak: 3,
      learnerName: 'Nghĩa',
      appUrl,
    });
    expect(message.emailSubject).toBe(
      'Gói Plus của bạn sẽ hết hạn vào ngày mai',
    );
    expect(message.title).toBe('Gói Plus hết hạn vào ngày mai');
    const html = message.emailHtml;
    expect(html).toContain('Chào Nghĩa,');
    expect(html).toContain(
      'Gói BreadTrans Plus của bạn sẽ hết hạn vào ngày mai, lúc 20:06 ngày 05/11/2026.',
    );
    expect(html).toContain(
      'bạn đã hoàn thành 4 bài luyện tập và đang giữ chuỗi học 3 ngày liên tiếp',
    );
    expect(html).toContain('tài khoản trở về gói Free');
    expect(html).toContain('href="https://app.example.com/plans"');
    expect(html).toContain('Gia hạn gói Plus');
    expect(html).toContain('Đội ngũ BreadTrans');
    expect(html).not.toContain('Trong kỳ này');
  });

  it('the last day, nothing practised, and a name with HTML stays escaped in the email', () => {
    const message = planExpiryMessage({
      planName: 'Pro',
      milestone: 0,
      endsAt: endingOnVnDay('2026-11-04'),
      practicedCount: 0,
      streak: 0,
      learnerName: '<b>Nam</b>',
      appUrl,
    });
    expect(message.title).toBe('Gói Pro hết hạn hôm nay');
    expect(message.emailSubject).toBe('Gói Pro của bạn hết hạn hôm nay');
    expect(message.emailHtml).toContain(
      'hết hạn hôm nay, lúc 15:30 (ngày 04/11/2026)',
    );
    expect(message.emailHtml).not.toContain('đã hoàn thành');
    expect(message.emailHtml).toContain('&lt;b&gt;Nam&lt;/b&gt;');
    expect(message.emailHtml).not.toContain('<b>Nam</b>');
  });

  it('greets plainly when the learner has no name', () => {
    const message = planExpiryMessage({
      planName: 'Plus',
      milestone: 7,
      endsAt: endingOnVnDay('2026-11-11'),
      practicedCount: 0,
      streak: 0,
      learnerName: null,
      appUrl,
    });
    expect(message.emailHtml).toContain('Chào bạn,');
    expect(message.emailSubject).toBe('Gói Plus của bạn sẽ hết hạn sau 7 ngày');
  });

  it('one notification type per plan and milestone', () => {
    expect(planExpiryType(40, 3)).toBe('plan_expiry:40:d3');
  });
});
