import { progressReport } from './progress-report.logic';

const at = (day: number) => new Date(Date.UTC(2026, 10, day));
const event = (scorePercent: number, day: number) => ({
  skill: 'SPEAKING' as const,
  scorePercent,
  createdAt: at(day),
});
const current = {
  LISTENING: 'BASIC',
  READING: 'BASIC',
  SPEAKING: 'INTERMEDIATE',
  WRITING: 'BASIC',
} as const;

describe('progressReport', () => {
  it('counts attempts, the average and levels gained', () => {
    const report = progressReport({
      events: [event(50, 1), event(70, 2)],
      startLevels: { SPEAKING: 'BASIC' },
      currentLevels: current,
    });
    const speaking = report.find((r) => r.skill === 'SPEAKING')!;
    expect(speaking.attempts).toBe(2);
    expect(speaking.average).toBe(60);
    expect(speaking.levelsGained).toBe(1);
    expect(report.find((r) => r.skill === 'READING')!.average).toBeNull();
  });

  it('compares the last three attempts with the three before, by date', () => {
    const report = progressReport({
      events: [
        event(80, 6),
        event(40, 1),
        event(50, 2),
        event(60, 3),
        event(70, 4),
        event(90, 5),
      ],
      startLevels: {},
      currentLevels: current,
    });
    expect(report.find((r) => r.skill === 'SPEAKING')!.trend).toBe(30);
  });

  it('has no trend with too few attempts and no gain without a start', () => {
    const report = progressReport({
      events: [event(40, 1), event(50, 2), event(60, 3)],
      startLevels: {},
      currentLevels: current,
    });
    const speaking = report.find((r) => r.skill === 'SPEAKING')!;
    expect(speaking.trend).toBeNull();
    expect(speaking.levelsGained).toBe(0);
  });
});
