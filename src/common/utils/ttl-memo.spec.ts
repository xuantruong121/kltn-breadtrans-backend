import { TtlMemo } from './ttl-memo';

describe('TtlMemo', () => {
  afterEach(() => jest.useRealTimers());

  it('loads a key once while it is fresh, and shares a load in flight', async () => {
    const memo = new TtlMemo<number, string>(60_000);
    const load = jest.fn(() => Promise.resolve('quiz'));
    const [a, b] = await Promise.all([memo.get(1, load), memo.get(1, load)]);
    expect([a, b, await memo.get(1, load)]).toEqual(['quiz', 'quiz', 'quiz']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads again once the entry is older than the TTL', async () => {
    jest.useFakeTimers({ now: 1_000 });
    const memo = new TtlMemo<number, number>(1_000);
    const load = jest.fn(() => Promise.resolve(Date.now()));
    await memo.get(1, load);
    jest.setSystemTime(2_001);
    await memo.get(1, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failed load', async () => {
    const memo = new TtlMemo<number, string>(60_000);
    await expect(
      memo.get(1, () => Promise.reject(new Error('db down'))),
    ).rejects.toThrow('db down');
    await expect(memo.get(1, () => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('keeps at most `max` entries, dropping the oldest', async () => {
    const memo = new TtlMemo<number, number>(60_000, 2);
    const load = jest.fn(() => Promise.resolve(0));
    await memo.get(1, load);
    await memo.get(2, load);
    await memo.get(3, load);
    await memo.get(1, load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
