import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
void (async () => {
  const arts = await p.listeningAudioArtifact.findMany({
    where: { status: 'PUBLISHED' },
    select: {
      id: true,
      quizId: true,
      version: true,
      durationMs: true,
      timeline: true,
    },
    orderBy: { quizId: 'asc' },
  });
  for (const a of arts) {
    const t = (a.timeline as any[]) ?? [];
    const n = t.length;
    const off = t.filter(
      (x) => typeof x.startMs === 'number' && typeof x.endMs === 'number',
    ).length;
    let mono = true,
      inRange = true,
      prev = -1;
    const win = new Set<string>();
    for (const x of t) {
      if (typeof x.startMs !== 'number') continue;
      if (x.startMs < prev) mono = false;
      if (
        x.startMs < 0 ||
        x.endMs <= x.startMs ||
        (a.durationMs && x.endMs > a.durationMs + 1500)
      )
        inRange = false;
      prev = x.endMs;
      win.add(`${x.startMs}-${x.endMs}`);
    }
    console.log(
      `quiz ${String(a.quizId).padEnd(3)} artifact#${a.id} v${a.version} entries=${n} withOffsets=${off} distinct=${win.size} monotonic=${mono} inRange=${inRange} durationMs=${a.durationMs} SEEK_PASS=${off === n && n > 0 && mono && inRange && win.size === n}`,
    );
  }
})().finally(() => p.$disconnect());
