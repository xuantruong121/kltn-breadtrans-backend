const STOP_WORDS = new Set(
  `a an the of in on at to for from with by and or but is are was were be being
  been it its this that these those there here as into over under near next
  while who which their his her our your they he she we you one two three
  some several many photo photograph picture image scene showing shows
  realistic natural style text free original modern large small neat busy
  clean well-lit close-up shot group daily`.split(/\s+/),
);

/** Photo libraries match keywords, not sentences: keep the words that matter. */
export function imageSearchQuery(brief: string, maxWords = 5) {
  const words = brief
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, maxWords).join(' ');
}

/** Libraries require every word, so a query that finds nothing is shortened. */
export function imageSearchQueries(brief: string) {
  const queries = [5, 3, 2].map((words) => imageSearchQuery(brief, words));
  return [...new Set(queries)].filter(Boolean);
}

type Analysis = { candidateId: string; suitable: boolean; score: number };

/** The most suitable candidate, or null when the check accepted none. */
export function bestImageCandidate(analyses: Analysis[]) {
  const [best] = analyses
    .filter((analysis) => analysis.suitable)
    .sort((a, b) => b.score - a.score);
  return best?.candidateId ?? null;
}
