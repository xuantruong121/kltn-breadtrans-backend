import {
  listeningMasterFor,
  listeningMasterUrl,
  masterMatchesGroups,
} from './toeic-listening-master';

describe('TOEIC Listening master registry', () => {
  const master = listeningMasterFor(1)!;
  const groupIds = master.timeline
    .filter((s) => s.kind === 'GROUP')
    .map((s) => s.groupId!);

  it('exam 1 has a master covering questions 1-100 once, in order, with a continuous timeline', () => {
    const numbers = master.timeline
      .filter((s) => s.kind === 'GROUP')
      .flatMap((s) => s.questionNumbers!);
    expect(numbers).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(groupIds).toHaveLength(54);
    for (let i = 1; i < master.timeline.length; i += 1)
      expect(master.timeline[i].start).toBeGreaterThanOrEqual(
        master.timeline[i - 1].start,
      );
    expect(master.timeline.at(-1)!.end).toBeLessThanOrEqual(
      master.durationSeconds + 1,
    );
    expect(master.timeline[0].kind).toBe('INTRO');
  });

  it('is offered only while it matches the exam groups exactly, in order', () => {
    expect(masterMatchesGroups(master, groupIds)).toBe(true);
    expect(masterMatchesGroups(master, [...groupIds].reverse())).toBe(false);
    expect(masterMatchesGroups(master, groupIds.slice(1))).toBe(false);
  });

  it('builds the URL from the configured public base, and none without one', () => {
    const saved = {
      base: process.env.TOEIC_LISTENING_MASTER_BASE_URL,
      r2: process.env.R2_PUBLIC_URL,
    };
    process.env.TOEIC_LISTENING_MASTER_BASE_URL = 'http://cdn.test/bucket/';
    expect(listeningMasterUrl(master)).toBe(
      `http://cdn.test/bucket/${master.key}`,
    );
    delete process.env.TOEIC_LISTENING_MASTER_BASE_URL;
    delete process.env.R2_PUBLIC_URL;
    expect(listeningMasterUrl(master)).toBeNull();
    if (saved.base !== undefined)
      process.env.TOEIC_LISTENING_MASTER_BASE_URL = saved.base;
    if (saved.r2 !== undefined) process.env.R2_PUBLIC_URL = saved.r2;
  });

  it('no master for an exam that has none', () => {
    expect(listeningMasterFor(999)).toBeNull();
  });
});
