/**
 * A learner's record in the vocabulary arena, from their settled matches
 * (GameBattle rows with status 'settled'; cancelled matches were refunded and
 * do not count). Each settled match escrowed `stake` from both players: the
 * winner gets 2 x stake back (net +stake), the loser loses the stake and a
 * draw refunds both. Pure: no Prisma, no I/O.
 */
export type SettledBattle = {
  p1Id: number;
  p2Id: number;
  stake: number;
  winnerRole: string | null;
  winnerUserId: number | null;
  settledAt: Date | null;
};

export type ArenaStats = {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  /** Whole percent of played matches won; null before the first match. */
  winRate: number | null;
  /** Wins in a row up to the latest match; a loss or a draw ends it. */
  currentWinStreak: number;
  longestWinStreak: number;
  /** Bánh Mì won minus Bánh Mì lost in the arena. */
  netBanh: number;
};

type Outcome = 'win' | 'loss' | 'draw';

function outcomeFor(userId: number, battle: SettledBattle): Outcome {
  if (battle.winnerRole === 'draw' || battle.winnerUserId === null)
    return 'draw';
  return battle.winnerUserId === userId ? 'win' : 'loss';
}

export function arenaStats(
  userId: number,
  battles: SettledBattle[],
): ArenaStats {
  const mine = battles
    .filter((b) => b.p1Id === userId || b.p2Id === userId)
    .sort(
      (a, b) => (a.settledAt?.getTime() ?? 0) - (b.settledAt?.getTime() ?? 0),
    );
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let netBanh = 0;
  let run = 0;
  let longest = 0;
  for (const battle of mine) {
    const outcome = outcomeFor(userId, battle);
    const stake = Math.round(battle.stake);
    if (outcome === 'win') {
      wins += 1;
      netBanh += stake;
      run += 1;
      longest = Math.max(longest, run);
    } else {
      if (outcome === 'loss') {
        losses += 1;
        netBanh -= stake;
      } else draws += 1;
      run = 0;
    }
  }
  const played = mine.length;
  return {
    played,
    wins,
    losses,
    draws,
    winRate: played ? Math.round((wins / played) * 100) : null,
    currentWinStreak: run,
    longestWinStreak: longest,
    netBanh,
  };
}
