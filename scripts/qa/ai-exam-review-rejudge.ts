/**
 * Re-judges the refused items of a live run with the current evidence rule.
 * Reads the runner's JSON only; calls no provider. Prints the items left for
 * human-style triage.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/ai-exam-review-rejudge.ts <live.json> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { judgeSolve, quoteFound } from '../../src/modules/toeic/toeic-answer-review.logic';

const [input, output] = process.argv.slice(2);
const data = JSON.parse(readFileSync(input, 'utf8'));
const rows: any[] = data.triage.refused;

const outcome: Record<string, number> = {};
const rejudged = rows.map((item) => {
  const options = (item.question?.options ?? []).map(String);
  const key = item.question?.correctIndex;
  let now: string = item.verdict;
  let note = '';
  if (item.verdict === 'EVIDENCE_INSUFFICIENT' && item.part === 5) {
    now = 'AGREE';
    note = 'Part 5: evidence support no longer required';
  } else if (item.verdict === 'EVIDENCE_NOT_FOUND') {
    // These passed answerable, ambiguity and choice === key before evidence.
    const judged = judgeSolve({
      part: item.part,
      stimulus: item.stimulus ?? undefined,
      questionText: item.question?.text,
      options,
      key,
      answer: {
        id: 'q',
        choice: item.solve?.choice,
        alsoCorrect: item.solve?.alsoCorrect ?? [],
        answerable: true,
        evidence: item.solve?.evidence ?? [],
        reasoning: item.solve?.reasoning ?? 'r',
        // Not recorded in this run: the next check could still refuse.
        evidenceSupportsAnswer: true,
      },
    });
    now = judged.verdict === 'AGREE' ? 'PASSES_EVIDENCE_EXISTENCE' : judged.verdict;
    note =
      judged.verdict === 'AGREE'
        ? 'quotes now found; evidenceSupportsAnswer NOT_RECORDED'
        : judged.detail;
  }
  outcome[`${item.part}:${item.verdict}->${now}`] =
    (outcome[`${item.part}:${item.verdict}->${now}`] ?? 0) + 1;
  return {
    ...item,
    rejudged: now,
    note,
    missingQuotes:
      now === 'EVIDENCE_NOT_FOUND'
        ? (item.solve?.evidence ?? []).filter(
            (quote: string) =>
              !quoteFound(
                quote,
                [item.stimulus, item.question?.text, ...options].join('\n'),
              ),
          )
        : [],
  };
});
writeFileSync(output, JSON.stringify({ outcome, rejudged }, null, 2));
console.log(JSON.stringify(outcome, null, 2));
