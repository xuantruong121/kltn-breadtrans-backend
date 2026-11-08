import { arenaStats, type SettledBattle } from './arena-stats.logic';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 8, 10, minute));
const battle = (
  minute: number,
  winnerUserId: number | null,
  stake = 20,
  players: [number, number] = [1, 2],
): SettledBattle => ({
  p1Id: players[0],
  p2Id: players[1],
  stake,
  winnerRole:
    winnerUserId === null ? 'draw' : winnerUserId === players[0] ? 'p1' : 'p2',
  winnerUserId,
  settledAt: at(minute),
});

describe('arenaStats', () => {
  it('starts empty: no matches, no win rate', () => {
    expect(arenaStats(1, [])).toEqual({
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: null,
      currentWinStreak: 0,
      longestWinStreak: 0,
      netBanh: 0,
    });
  });

  it('counts wins, losses and draws, and nets the stakes', () => {
    const stats = arenaStats(1, [
      battle(1, 1, 20),
      battle(2, 2, 50),
      battle(3, null, 100),
      battle(4, 1, 100),
    ]);
    expect(stats).toMatchObject({
      played: 4,
      wins: 2,
      losses: 1,
      draws: 1,
      winRate: 50,
    });
    // +20 -50 +0 +100
    expect(stats.netBanh).toBe(70);
  });

  it('orders by settledAt, whatever order the rows come in', () => {
    const stats = arenaStats(1, [
      battle(5, 1),
      battle(1, 2),
      battle(3, 1),
      battle(4, 1),
    ]);
    expect(stats.currentWinStreak).toBe(3);
    expect(stats.longestWinStreak).toBe(3);
  });

  it('a draw or a loss ends the current streak, the longest stays', () => {
    const stats = arenaStats(1, [
      battle(1, 1),
      battle(2, 1),
      battle(3, 1),
      battle(4, null),
      battle(5, 1),
    ]);
    expect(stats.currentWinStreak).toBe(1);
    expect(stats.longestWinStreak).toBe(3);
  });

  it('counts the learner as either player and ignores matches without them', () => {
    const stats = arenaStats(7, [
      battle(1, 7, 20, [7, 2]),
      battle(2, 7, 50, [3, 7]),
      battle(3, 3, 100, [3, 4]),
    ]);
    expect(stats).toMatchObject({ played: 2, wins: 2, netBanh: 70 });
  });

  it('a forfeit is a settled win or loss like any other', () => {
    const forfeit = { ...battle(1, 2, 50), winnerRole: 'p2' };
    expect(arenaStats(1, [forfeit])).toMatchObject({ losses: 1, netBanh: -50 });
  });
});
