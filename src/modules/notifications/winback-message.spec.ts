import { isWinbackDay, winbackMessage, winbackType } from './winback-message';

describe('isWinbackDay', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00+07:00`);

  it('fires three Vietnam days after the last day of the plan', () => {
    const endsAt = new Date('2026-11-01T15:00:00+07:00'); // last day 01/11
    expect(isWinbackDay(endsAt, day('2026-11-04'), 3)).toBe(true);
    expect(isWinbackDay(endsAt, day('2026-11-03'), 3)).toBe(false);
    expect(isWinbackDay(endsAt, day('2026-11-05'), 3)).toBe(false);
  });

  it('counts a plan ending at midnight as ending the day before', () => {
    const endsAt = new Date('2026-11-02T00:00:00+07:00'); // last day 01/11
    expect(isWinbackDay(endsAt, day('2026-11-04'), 3)).toBe(true);
  });
});

describe('winbackMessage', () => {
  const message = winbackMessage({
    planName: 'Plus',
    code: 'QUAYLAI-7KQ4M2',
    percentOff: 20,
    validTo: new Date('2026-11-11T09:00:00+07:00'),
    learnerName: 'An <b>',
  });

  it('names the code, the discount and the deadline', () => {
    expect(message.title).toBe('Mã giảm 20% để học tiếp');
    expect(message.body).toContain('QUAYLAI-7KQ4M2');
    expect(message.body).toContain('09:00 ngày 11/11/2026');
    expect(message.body).toContain('chỉ dành cho tài khoản của bạn');
  });

  it('links to the plans page with the code filled in', () => {
    expect(message.url).toBe('/plans?promo=QUAYLAI-7KQ4M2');
  });

  it('escapes the learner name in the email', () => {
    expect(message.emailHtml).toContain('Chào An &lt;b&gt;,');
  });

  it('uses one notification type per ended plan', () => {
    expect(winbackType(42)).toBe('winback:42');
  });
});
