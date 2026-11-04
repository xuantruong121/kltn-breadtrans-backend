import { daysLeft, lockedAfterExpiry } from './expiry-summary.logic';

describe('lockedAfterExpiry', () => {
  it('lists only what FREE does not open, grouped by skill and level label, most used first', () => {
    const groups = lockedAfterExpiry([
      { skill: 'WRITING', levelSource: 'Writing B1 — Complaint Email' },
      { skill: 'WRITING', levelSource: 'Writing B2 — Problem & Solution' },
      { skill: 'SPEAKING', levelSource: 'B1-B2' },
      { skill: 'SPEAKING', levelSource: 'C1' },
      { skill: 'WRITING', levelSource: 'Writing A2 — Postcard' },
      { skill: 'READING', levelSource: 'Reading C1 — Policy' },
      { skill: 'LISTENING', levelSource: 'Conversation B1 — Hotel' },
      {
        skill: 'LISTENING',
        levelSource: 'Dictation B1 — Office',
        dictation: true,
      },
    ]);
    expect(groups).toEqual([
      {
        skill: 'WRITING',
        levelGroup: 'INTERMEDIATE',
        requiredPlan: 'PLUS',
        label: 'Viết Trung cấp',
        count: 2,
      },
      {
        skill: 'SPEAKING',
        levelGroup: 'INTERMEDIATE',
        requiredPlan: 'PLUS',
        label: 'Nói Trung cấp',
        count: 1,
      },
      {
        skill: 'SPEAKING',
        levelGroup: 'ADVANCED',
        requiredPlan: 'PRO',
        label: 'Nói Nâng cao',
        count: 1,
      },
      {
        skill: 'LISTENING',
        levelGroup: 'INTERMEDIATE',
        requiredPlan: 'PLUS',
        label: 'Nghe chép Trung cấp',
        count: 1,
      },
    ]);
  });

  it('an item without a level tag is left out rather than guessed', () => {
    expect(
      lockedAfterExpiry([{ skill: 'WRITING', levelSource: 'Untitled' }]),
    ).toEqual([]);
  });
});

describe('daysLeft', () => {
  const now = new Date('2026-11-04T10:00:00Z');
  it('rounds up, and is 0 once the plan has ended', () => {
    expect(daysLeft(new Date('2026-11-07T09:00:00Z'), now)).toBe(3);
    expect(daysLeft(new Date('2026-11-04T10:30:00Z'), now)).toBe(1);
    expect(daysLeft(new Date('2026-11-04T09:00:00Z'), now)).toBe(0);
  });
});
