import {
  canApply,
  canonicalGroupHash,
  confirmReview,
  confirmationRefusal,
  explanationRequestOf,
  groupStatusOf,
  invalidateReview,
  judgeExplanation,
  judgePart1Vision,
  judgeSolve,
  part1DraftHash,
  part1PublishRefusal,
  pendingStep,
  quoteFound,
  reviewKindFor,
  solveRequestOf,
  validateExplanationOutput,
  validatePart1VisionOutput,
  validateSolveOutput,
  vendorOfModel,
  type SolveAnswer,
} from './toeic-answer-review.logic';
import type { GroupReview } from './toeic-answer-review.types';
import {
  independentReviewOf,
  okStep,
} from './toeic-answer-review.fixtures-spec';

const part3Group = () => ({
  transcript:
    'M: The printer on the third floor is broken again.\nW: I will call the technician this afternoon.',
  questions: [
    {
      text: 'What will the woman do?',
      options: [
        'Call a technician',
        'Buy a printer',
        'Move to another floor',
        'Cancel a meeting',
      ],
      correctIndex: 0,
      explanation: 'Người phụ nữ nói sẽ gọi kỹ thuật viên chiều nay.',
    },
  ],
});

const answer = (overrides: Partial<SolveAnswer> = {}): SolveAnswer => ({
  id: 'q32',
  choice: 0,
  alsoCorrect: [],
  answerable: true,
  evidence: ['I will call the technician'],
  reasoning: 'She says she will call.',
  evidenceSupportsAnswer: true,
  ...overrides,
});

describe('reviewer payloads', () => {
  it('the solver never sees the key or the explanation', () => {
    const payload = JSON.stringify(
      solveRequestOf(3, [{ group: part3Group(), firstQuestionNumber: 32 }]),
    );
    expect(payload).not.toMatch(/correctIndex|correctAnswer|explanation/);
    expect(payload).not.toContain('kỹ thuật viên');
    expect(payload).toContain('q32');
    expect(payload).toContain('printer on the third floor');
  });

  it('the explanation check gets the stimulus and explanation, never the key', () => {
    const payload = explanationRequestOf(3, [
      { group: part3Group(), firstQuestionNumber: 32 },
    ]);
    const text = JSON.stringify(payload);
    expect(text).not.toMatch(/correctIndex|correctAnswer/);
    expect(payload.groups[0].stimulus).toContain('technician');
    expect(payload.groups[0].questions[0].explanation).toContain(
      'kỹ thuật viên',
    );
  });

  it('Part 5 sends no stimulus field at all', () => {
    const payload = explanationRequestOf(5, [
      {
        group: {
          questions: [
            {
              text: 'The report _____ late.',
              options: ['was', 'were', 'be', 'being'],
              correctIndex: 0,
              explanation: 'Chủ ngữ số ít nên dùng was.',
            },
          ],
        },
        firstQuestionNumber: 101,
      },
    ]);
    expect('stimulus' in payload.groups[0]).toBe(false);
  });
});

describe('validateSolveOutput', () => {
  const expected = [{ id: 'q32', optionCount: 4, part: 3 }];
  const reply = (row: Record<string, unknown>) => ({
    answers: [{ ...answer(), ...row }],
  });

  it('accepts a well-formed reply', () => {
    expect(validateSolveOutput(expected, reply({})).ok).toBe(true);
  });

  it.each([
    [{ answers: [] }, 'missing id'],
    [{ answers: [answer(), answer()] }, 'duplicate id'],
    [reply({ id: 'q99' }), 'unknown id'],
    [reply({ choice: 4 }), 'choice out of range'],
    [reply({ choice: 1.5 }), 'choice out of range'],
    [reply({ alsoCorrect: [0] }), 'alsoCorrect invalid'],
    [reply({ alsoCorrect: [1, 1] }), 'alsoCorrect invalid'],
    [reply({ answerable: 'yes' }), 'answerable not boolean'],
    [reply({ evidence: 'quote' }), 'evidence not a string list'],
    [reply({ evidence: [] }), 'no evidence quoted'],
    [reply({ reasoning: ' ' }), 'reasoning empty'],
    [reply({ evidenceSupportsAnswer: 1 }), 'evidenceSupportsAnswer'],
    [{ nope: true }, 'no answers array'],
  ])('fails closed on %j', (output, reason) => {
    const result = validateSolveOutput(expected, output);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain(reason);
  });

  it('Part 5 is exempt from quoting evidence', () => {
    expect(
      validateSolveOutput([{ id: 'q101', optionCount: 4, part: 5 }], {
        answers: [answer({ id: 'q101', evidence: [] })],
      }).ok,
    ).toBe(true);
  });
});

describe('judgeSolve', () => {
  const judge = (overrides: Partial<SolveAnswer>, key = 0) =>
    judgeSolve({
      part: 3,
      stimulus: part3Group().transcript,
      questionText: 'What will the woman do?',
      key,
      answer: answer(overrides),
    }).verdict;

  it('checks in the order of the contract', () => {
    expect(judge({ answerable: false, choice: 2 })).toBe('UNANSWERABLE');
    expect(judge({ choice: -1 })).toBe('REVIEW_INVALID');
    expect(judge({ alsoCorrect: [1] })).toBe('AMBIGUOUS');
    expect(judge({ choice: 2 })).toBe('DISAGREE');
    expect(judge({ evidence: ['He will repair it himself'] })).toBe(
      'EVIDENCE_NOT_FOUND',
    );
    expect(judge({ evidenceSupportsAnswer: false })).toBe(
      'EVIDENCE_INSUFFICIENT',
    );
    expect(judge({})).toBe('AGREE');
  });

  it('matches quotes despite case, curly quotes and an ellipsis', () => {
    expect(
      quoteFound('“The PRINTER … is broken”', part3Group().transcript),
    ).toBe(true);
    expect(quoteFound('the fax is broken', part3Group().transcript)).toBe(
      false,
    );
  });
});

describe('judgeExplanation', () => {
  const base = {
    id: 'q32',
    claimedChoice: 0,
    supportsClaim: true,
    containsContradiction: false,
    reasoning: 'ok',
  };
  it('agrees only when the explanation defends the key without contradiction', () => {
    expect(judgeExplanation(0, base).verdict).toBe('AGREE');
    expect(judgeExplanation(0, { ...base, claimedChoice: 2 }).causes).toEqual([
      'WRONG_CHOICE',
    ]);
    expect(
      judgeExplanation(0, { ...base, supportsClaim: false }).causes,
    ).toEqual(['DOES_NOT_SUPPORT']);
    expect(
      judgeExplanation(0, { ...base, containsContradiction: true }).verdict,
    ).toBe('EXPLANATION_MISMATCH');
  });

  it('validates the reply fail-closed', () => {
    const expected = [{ id: 'q32', optionCount: 4, part: 3 }];
    expect(validateExplanationOutput(expected, { checks: [base] }).ok).toBe(
      true,
    );
    expect(
      validateExplanationOutput(expected, {
        checks: [{ ...base, claimedChoice: 7 }],
      }).ok,
    ).toBe(false);
    expect(
      validateExplanationOutput(expected, {
        checks: [{ ...base, supportsClaim: 'true' }],
      }).ok,
    ).toBe(false);
  });
});

describe('provenance', () => {
  it('reads the vendor from the real model, not the provider name', () => {
    expect(vendorOfModel('cloudflare', '@cf/openai/gpt-oss-120b')).toBe(
      'openai',
    );
    expect(vendorOfModel('cloudflare', '@cf/google/gemma-3-12b-it')).toBe(
      'google',
    );
    expect(vendorOfModel('openai-compatible', 'qwen2.5:7b')).toBeNull();
    expect(vendorOfModel('openai-compatible', 'qwen2.5:7b', 'Alibaba')).toBe(
      'alibaba',
    );
    expect(vendorOfModel('gemini', 'gemini-3.5-flash-lite')).toBe('google');
  });

  it('is independent only for a known, different vendor', () => {
    expect(reviewKindFor('openai', 'google')).toBe('INDEPENDENT');
    expect(reviewKindFor('google', 'google')).toBe('SAME_PROVIDER');
    expect(reviewKindFor(null, 'google')).toBe('SAME_PROVIDER');
    // A batch the Cloudflare stand-in wrote is not independently reviewed by Cloudflare.
    expect(reviewKindFor('openai', 'openai')).toBe('SAME_PROVIDER');
  });
});

describe('groupStatusOf', () => {
  const agree = [{ questionNumber: 1, verdict: 'AGREE' as const }];
  it('Part 2-7: independent, degraded, rejected or unreviewed', () => {
    const solve = okStep();
    const explanation = okStep('gemini', 'g', 'SAME_PROVIDER');
    expect(
      groupStatusOf(
        3,
        { independentSolve: solve, explanationCheck: explanation },
        agree,
      ),
    ).toBe('REVIEWED_INDEPENDENT');
    expect(
      groupStatusOf(
        3,
        {
          independentSolve: okStep('gemini', 'g', 'SAME_PROVIDER'),
          explanationCheck: explanation,
        },
        agree,
      ),
    ).toBe('REVIEWED_DEGRADED');
    expect(
      groupStatusOf(3, { independentSolve: solve }, [
        { questionNumber: 1, verdict: 'DISAGREE' },
      ]),
    ).toBe('REJECTED');
    expect(groupStatusOf(3, { independentSolve: solve }, agree)).toBe(
      'UNREVIEWED',
    );
    expect(
      groupStatusOf(
        3,
        { independentSolve: { ...solve, status: 'UNAVAILABLE' } },
        [],
      ),
    ).toBe('UNREVIEWED');
    // Part 2-7 never waits for Part 1's confirmation.
    for (const steps of [{}, { independentSolve: solve }])
      expect(groupStatusOf(4, steps, agree)).not.toBe('NEEDS_ADMIN_CONFIRM');
  });

  it('Part 1 is never independent or degraded', () => {
    const vision = okStep('gemini', 'g', 'SAME_PROVIDER');
    expect(groupStatusOf(1, { part1VisionReview: vision }, agree)).toBe(
      'NEEDS_ADMIN_CONFIRM',
    );
    expect(
      groupStatusOf(1, { part1VisionReview: vision }, [
        { questionNumber: 1, verdict: 'DISAGREE' },
      ]),
    ).toBe('REJECTED');
    expect(groupStatusOf(1, {}, [])).toBe('UNREVIEWED');
    // Even an independent-looking solve step never makes Part 1 independent.
    expect(
      groupStatusOf(
        1,
        { independentSolve: okStep(), explanationCheck: okStep() },
        agree,
      ),
    ).toBe('UNREVIEWED');
  });

  it('pendingStep resumes from the step that did not finish', () => {
    const review = independentReviewOf(3, part3Group(), 32);
    expect(pendingStep(review)).toBeNull();
    expect(
      pendingStep({
        ...review,
        steps: { independentSolve: review.steps.independentSolve },
      }),
    ).toBe('explanationCheck');
    expect(
      pendingStep({
        ...review,
        steps: {
          ...review.steps,
          explanationCheck: { ...okStep(), status: 'UNAVAILABLE' },
        },
      }),
    ).toBe('explanationCheck');
    expect(pendingStep({ steps: {}, verdicts: [] })).toBe('independentSolve');
  });
});

describe('canonicalGroupHash', () => {
  it('ignores key order and whitespace, changes with content', () => {
    const group = part3Group();
    const shuffled = {
      questions: [
        {
          explanation: `  ${group.questions[0].explanation}  `,
          correctIndex: 0,
          options: group.questions[0].options,
          text: group.questions[0].text,
        },
      ],
      transcript: group.transcript.replace(/ /g, '   '),
    };
    expect(canonicalGroupHash(3, shuffled)).toBe(canonicalGroupHash(3, group));
    const keyChanged = part3Group();
    keyChanged.questions[0].correctIndex = 1;
    expect(canonicalGroupHash(3, keyChanged)).not.toBe(
      canonicalGroupHash(3, group),
    );
    const explanationChanged = part3Group();
    explanationChanged.questions[0].explanation += ' Thêm.';
    expect(canonicalGroupHash(3, explanationChanged)).not.toBe(
      canonicalGroupHash(3, group),
    );
  });

  it('changes when the photo bytes change behind the same URL and asset id', () => {
    const group = { imageBrief: 'desk', questions: part3Group().questions };
    const image = { r2Key: 'ai/x.jpg', url: 'https://r2/x.jpg' };
    expect(part1DraftHash(group, { ...image, sha256: 'aaa' })).not.toBe(
      part1DraftHash(group, { ...image, sha256: 'bbb' }),
    );
  });
});

describe('review lifecycle', () => {
  it('invalidateReview files the old result as history and clears it', () => {
    const review = confirmReview(
      { ...independentReviewOf(3, part3Group()), status: 'REVIEWED_DEGRADED' },
      { by: 1, at: 'now', method: 'AFTER_DEGRADED_REVIEW' },
    );
    const next = invalidateReview(review, 'new-hash', 'ADMIN_EDIT');
    expect(next).toMatchObject({
      status: 'UNREVIEWED',
      contentHash: 'new-hash',
      steps: {},
      verdicts: [],
    });
    expect(next.confirmed).toBeUndefined();
    expect(next.history).toHaveLength(1);
    expect(next.history[0]).toMatchObject({
      contentHash: review.contentHash,
      status: 'ADMIN_CONFIRMED',
      staleReason: 'ADMIN_EDIT',
      confirmed: expect.objectContaining({ method: 'AFTER_DEGRADED_REVIEW' }),
    });
    expect(next.history[0].verdicts).toHaveLength(1);
  });
});

describe('confirmation rules', () => {
  const degraded = (): GroupReview => ({
    ...independentReviewOf(3, part3Group()),
    status: 'REVIEWED_DEGRADED',
  });
  const legacy = (hash: string): GroupReview => ({
    status: 'UNREVIEWED',
    contentHash: hash,
    steps: {},
    verdicts: [],
    edits: [],
    history: [],
  });
  const part1 = (
    status: GroupReview['status'],
    visionOk: boolean,
  ): GroupReview => ({
    status,
    contentHash: 'h1',
    steps: visionOk
      ? { part1VisionReview: okStep('gemini', 'g', 'SAME_PROVIDER') }
      : { part1VisionReview: { ...okStep(), status: 'UNAVAILABLE' } },
    verdicts: visionOk ? [{ questionNumber: 1, verdict: 'AGREE' }] : [],
    edits: [],
    history: [],
  });

  it('accepts exactly the four rows of the table', () => {
    const d = degraded();
    expect(
      confirmationRefusal({
        part: 3,
        review: d,
        method: 'AFTER_DEGRADED_REVIEW',
        currentHash: d.contentHash,
      }),
    ).toBeNull();
    expect(
      confirmationRefusal({
        part: 3,
        review: legacy('h'),
        method: 'MANUAL_REVIEW',
        currentHash: 'h',
      }),
    ).toBeNull();
    expect(
      confirmationRefusal({
        part: 1,
        review: part1('NEEDS_ADMIN_CONFIRM', true),
        method: 'AFTER_VISION',
        currentHash: 'h1',
      }),
    ).toBeNull();
    expect(
      confirmationRefusal({
        part: 1,
        review: part1('UNREVIEWED', false),
        method: 'MANUAL_NO_VISION',
        currentHash: 'h1',
      }),
    ).toBeNull();
  });

  it('refuses every other combination', () => {
    const rejected = { ...degraded(), status: 'REJECTED' as const };
    expect(
      confirmationRefusal({
        part: 3,
        review: rejected,
        method: 'MANUAL_REVIEW',
        currentHash: rejected.contentHash,
      }),
    ).toContain('bác bỏ');
    expect(
      confirmationRefusal({
        part: 1,
        review: part1('NEEDS_ADMIN_CONFIRM', true),
        method: 'AFTER_DEGRADED_REVIEW',
        currentHash: 'h1',
      }),
    ).not.toBeNull();
    expect(
      confirmationRefusal({
        part: 1,
        review: part1('UNREVIEWED', false),
        method: 'AFTER_VISION',
        currentHash: 'h1',
      }),
    ).not.toBeNull();
    expect(
      confirmationRefusal({
        part: 1,
        review: part1('NEEDS_ADMIN_CONFIRM', true),
        method: 'AFTER_VISION',
        currentHash: 'h1',
        anyQuestionFailed: true,
      }),
    ).toContain('FAILED');
    // An outage-interrupted review is retried, not confirmed by hand.
    const interrupted: GroupReview = {
      ...legacy('h'),
      steps: { independentSolve: { ...okStep(), status: 'UNAVAILABLE' } },
    };
    expect(
      confirmationRefusal({
        part: 3,
        review: interrupted,
        method: 'MANUAL_REVIEW',
        currentHash: 'h',
      }),
    ).not.toBeNull();
    const d = degraded();
    expect(
      confirmationRefusal({
        part: 3,
        review: d,
        method: 'AFTER_DEGRADED_REVIEW',
        currentHash: 'other',
      }),
    ).toContain('thay đổi');
  });

  it('a confirmation records method, status of origin and the hash', () => {
    const d = degraded();
    const confirmed = confirmReview(d, {
      by: 9,
      at: 't',
      method: 'AFTER_DEGRADED_REVIEW',
    });
    expect(confirmed.status).toBe('ADMIN_CONFIRMED');
    expect(confirmed.confirmed).toEqual({
      by: 9,
      at: 't',
      method: 'AFTER_DEGRADED_REVIEW',
      fromStatus: 'REVIEWED_DEGRADED',
      contentHash: d.contentHash,
    });
  });
});

describe('canApply', () => {
  const group = part3Group();
  const hash = canonicalGroupHash(3, group);
  const reviewed = independentReviewOf(3, group);
  const decide = (
    review: GroupReview | null,
    currentHash = hash,
    structureOk = true,
    part = 3,
  ) => canApply({ part, review, currentHash, structureOk });

  it('covers all seven statuses', () => {
    expect(decide(reviewed).ok).toBe(true);
    expect(decide({ ...reviewed, status: 'REVIEWED_DEGRADED' }).ok).toBe(false);
    expect(decide({ ...reviewed, status: 'NEEDS_ADMIN_CONFIRM' }).ok).toBe(
      false,
    );
    expect(decide({ ...reviewed, status: 'REJECTED' }).ok).toBe(false);
    expect(decide({ ...reviewed, status: 'UNREVIEWED' }).ok).toBe(false);
    expect(decide(null).ok).toBe(false);
    expect(decide({ ...reviewed, status: 'EDITED_BY_ADMIN' }).ok).toBe(true);
    const confirmed = confirmReview(
      { ...reviewed, status: 'REVIEWED_DEGRADED' },
      { by: 1, at: 't', method: 'AFTER_DEGRADED_REVIEW' },
    );
    expect(decide(confirmed).ok).toBe(true);
  });

  it('refuses a stale hash, broken structure or an invalid confirmation', () => {
    expect(decide(reviewed, 'other').reason).toBe('HASH_MISMATCH');
    expect(
      decide({ ...reviewed, status: 'EDITED_BY_ADMIN' }, hash, false).reason,
    ).toBe('STRUCTURE_INVALID');
    const confirmed = confirmReview(
      { ...reviewed, status: 'REVIEWED_DEGRADED' },
      { by: 1, at: 't', method: 'AFTER_DEGRADED_REVIEW' },
    );
    expect(decide(confirmed, hash, false).reason).toBe('STRUCTURE_INVALID');
    expect(decide(confirmed, 'other').reason).toBe('HASH_MISMATCH');
    expect(
      decide({
        ...confirmed,
        confirmed: { ...confirmed.confirmed!, method: 'AFTER_VISION' },
      }).reason,
    ).toBe('CONFIRMATION_INVALID');
    // An independent status needs an independent solve step.
    expect(
      decide({
        ...reviewed,
        steps: {
          ...reviewed.steps,
          independentSolve: okStep('gemini', 'g', 'SAME_PROVIDER'),
        },
      }).ok,
    ).toBe(false);
  });

  it('a Part 1 candidate waits for its Draft gate but still needs structure', () => {
    expect(decide(null, hash, true, 1).ok).toBe(true);
    expect(decide(null, hash, false, 1).ok).toBe(false);
  });
});

describe('Part 1 Vision and publish gate', () => {
  it('judges the Vision pick against the key', () => {
    const base = {
      choice: 2,
      alsoCorrect: [],
      answerable: true,
      reasoning: 'r',
    };
    expect(judgePart1Vision(2, base).verdict).toBe('AGREE');
    expect(judgePart1Vision(1, base).verdict).toBe('DISAGREE');
    expect(judgePart1Vision(2, { ...base, alsoCorrect: [0] }).verdict).toBe(
      'AMBIGUOUS',
    );
    expect(judgePart1Vision(2, { ...base, answerable: false }).verdict).toBe(
      'UNANSWERABLE',
    );
    expect(validatePart1VisionOutput({ ...base, choice: 4 }).ok).toBe(false);
  });

  it('publishes only a confirmed group with the same photo bytes', () => {
    const review: GroupReview = confirmReview(
      {
        status: 'NEEDS_ADMIN_CONFIRM',
        contentHash: 'h',
        steps: { part1VisionReview: okStep('gemini', 'g', 'SAME_PROVIDER') },
        verdicts: [{ questionNumber: 1, verdict: 'AGREE' }],
        edits: [],
        history: [],
      },
      { by: 1, at: 't', method: 'AFTER_VISION' },
    );
    const gate = (over: Partial<Parameters<typeof part1PublishRefusal>[0]>) =>
      part1PublishRefusal({
        review,
        currentHash: 'h',
        questionFailed: false,
        imageSha256Stored: 'aaa',
        imageSha256Now: 'aaa',
        ...over,
      });
    expect(gate({})).toBeNull();
    expect(gate({ imageSha256Now: 'bbb' })).toBe('IMAGE_CHANGED');
    expect(gate({ imageSha256Now: null })).toBe('IMAGE_VERSION_UNKNOWN');
    expect(gate({ imageSha256Stored: undefined })).toBe(
      'IMAGE_VERSION_UNKNOWN',
    );
    expect(gate({ currentHash: 'other' })).toBe('HASH_MISMATCH');
    expect(gate({ questionFailed: true })).toBe('QUESTION_FAILED');
    expect(gate({ review: { ...review, status: 'NEEDS_ADMIN_CONFIRM' } })).toBe(
      'NOT_CONFIRMED',
    );
  });
});
