import { decideRenewal, upgradeConversionMs, vnDate } from './renewal.logic';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-04T10:00:00.000Z');
const at = (days: number) => new Date(now.getTime() + days * DAY);

const plus = { planCode: 'PLUS', priceVnd: 69_000, durationDays: 30 };
const pro = { planCode: 'PRO', priceVnd: 149_000, durationDays: 30 };
const term = (
  id: number,
  plan: typeof plus,
  startsInDays: number,
  endsInDays: number,
) => ({
  id,
  planCode: plan.planCode,
  priceVnd: plan.priceVnd,
  durationDays: plan.durationDays,
  startsAt: at(startsInDays),
  endsAt: at(endsInDays),
});

describe('decideRenewal', () => {
  it('no paid plan: starts now for its full length', () => {
    expect(decideRenewal({ now, purchase: plus, paid: [] })).toEqual({
      kind: 'NEW',
      startsAt: now,
      endsAt: at(30),
    });
  });

  it('same plan while one runs: queued to start exactly when it ends, no day lost', () => {
    const decision = decideRenewal({
      now,
      purchase: plus,
      paid: [term(7, plus, -20, 10)],
    });
    expect(decision).toEqual({
      kind: 'RENEW',
      startsAt: at(10),
      endsAt: at(40),
      afterSubscriptionId: 7,
    });
  });

  it('PLUS to PRO: PRO starts now and the PLUS days left are converted at the daily-price ratio', () => {
    const decision = decideRenewal({
      now,
      purchase: pro,
      paid: [term(7, plus, -20, 10)],
    });
    // 10 PLUS days at 2,300 VND/day = 23,000 VND = 4.63 PRO days at 4,966.67 VND/day.
    const converted = Math.floor(10 * DAY * (69_000 / 149_000));
    expect(decision).toEqual({
      kind: 'UPGRADE',
      startsAt: now,
      endsAt: new Date(now.getTime() + 30 * DAY + converted),
      endSubscriptionId: 7,
      previousEndsAt: at(10),
      convertedMs: converted,
    });
  });

  it('a long plan converts at its own daily price', () => {
    const plus180 = { planCode: 'PLUS', priceVnd: 331_000, durationDays: 180 };
    const converted = upgradeConversionMs(90 * DAY, plus180, pro);
    expect(converted).toBe(
      Math.floor(90 * DAY * (331_000 / 180 / (149_000 / 30))),
    );
  });

  it('a plan without a price (granted) converts to nothing rather than inventing days', () => {
    expect(
      upgradeConversionMs(
        10 * DAY,
        { priceVnd: null, durationDays: 30 },
        { priceVnd: 149_000, durationDays: 30 },
      ),
    ).toBe(0);
  });

  it('PRO to PLUS while PRO runs is refused', () => {
    const decision = decideRenewal({
      now,
      purchase: plus,
      paid: [term(9, pro, -5, 25)],
    });
    expect(decision).toMatchObject({ kind: 'REFUSED', reason: 'DOWNGRADE' });
  });

  it('one queued plan at most', () => {
    const decision = decideRenewal({
      now,
      purchase: plus,
      paid: [term(7, plus, -20, 10), term(8, plus, 10, 40)],
    });
    expect(decision).toMatchObject({
      kind: 'REFUSED',
      reason: 'QUEUED_EXISTS',
    });
  });

  it('two plans in effect at once is refused, never guessed', () => {
    const decision = decideRenewal({
      now,
      purchase: plus,
      paid: [term(7, plus, -20, 10), term(8, pro, -1, 29)],
    });
    expect(decision).toMatchObject({ kind: 'REFUSED', reason: 'OVERLAP' });
  });
});

describe('vnDate', () => {
  it('formats in Vietnam time, so a plan ending at 20:00 UTC shows the next day', () => {
    expect(vnDate(new Date('2026-12-04T20:00:00.000Z'))).toBe('05/12/2026');
    expect(vnDate(new Date('2026-12-04T10:00:00.000Z'))).toBe('04/12/2026');
  });
});
