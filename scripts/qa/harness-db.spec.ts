import { harnessDbName } from './harness-db';

/** Which harness database fixtures write to (owner 2026-11-20). */
describe('harnessDbName', () => {
  const marker = (value: string | null) => () => value;

  it('prefers HARNESS_DB', () => {
    expect(harnessDbName({ HARNESS_DB: 'goal_qa' }, marker('dev_qa'))).toBe(
      'goal_qa',
    );
  });

  it('follows the running QA backend when HARNESS_DB is unset', () => {
    expect(harnessDbName({ TEMP: '/tmp' }, marker('dev_qa\n'))).toBe('dev_qa');
  });

  it('falls back to the shared clone, and never names a real database', () => {
    expect(harnessDbName({}, marker(null))).toBe('harness_clone');
    expect(harnessDbName({}, marker('kltn_db'))).toBe('harness_clone');
    expect(harnessDbName({}, marker('dev qa; drop'))).toBe('harness_clone');
  });
});
