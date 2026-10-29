/**
 * Writing practice grading quality (deterministic): the server-side rules that
 * hold whatever the grader says. The grader is a fixed reply here; how a real
 * model scores these texts is not tested (no provider call).
 */
import {
  buildPracticeWritingRequest,
  lengthBand,
  lengthCapApplies,
  practiceWritingTask,
  validatePracticeWritingResult,
} from './practice-writing-grading';

const email = practiceWritingTask(
  {
    taskType: 'EMAIL',
    prompt:
      'Bạn có cuộc họp với chị Hà lúc 2 P.M. thứ Năm nhưng có lịch khám bác sĩ. Viết email 100–140 từ xin đổi lịch: nêu lý do, đề xuất hai giờ thay thế và đề nghị xác nhận.',
    wordRange: [100, 140],
    requirements: ['reason', 'two alternatives', 'confirmation request'],
    rubric: { grammar: 2, vocabulary: 2, organization: 2, taskAchievement: 4 },
    sampleResponse:
      'Dear Ms. Ha, I am writing about our meeting on Thursday at 2 P.M. ...',
  },
  'fallback',
)!;

const words = (n: number, word = 'word') =>
  Array.from({ length: n }, () => word).join(' ');

/** A fixed grader reply: [grammar, vocabulary, organization, taskAchievement]. */
function reply(
  scores: [number, number, number, number],
  taskRelevance: string = 'ON_TASK',
  extra: Record<string, unknown> = {},
) {
  const keys = ['grammar', 'vocabulary', 'organization', 'taskAchievement'];
  return {
    criteria: keys.map((key, i) => ({
      key,
      score: scores[i],
      comment: `Nhận xét cho mục ${key}.`,
    })),
    strengths: ['Lời lẽ lịch sự.'],
    corrections: [],
    feedback: 'Bài viết rõ ràng, phù hợp với tình huống.',
    suggestions: ['Thêm một câu cảm ơn ở cuối.'],
    taskRelevance,
    relevanceEvidence: 'Bài nêu lý do và đề xuất giờ khác như đề yêu cầu.',
    ...extra,
  };
}

const grade = (raw: unknown, answer: string) =>
  validatePracticeWritingResult(
    raw,
    email,
    answer,
    buildPracticeWritingRequest(email, answer).facts,
  );

const onTarget = words(120);

describe('Writing practice grading quality (deterministic rules)', () => {
  it('A. a correct answer that differs from the reference keeps full marks; the grader is told not to compare with the sample', () => {
    const request = buildPracticeWritingRequest(email, onTarget);
    expect(request.systemInstruction).toContain(
      'Never reward or penalise similarity to it',
    );
    const r = grade(reply([2, 2, 2, 4]), onTarget);
    expect(r.ok && r.value.score).toBe(10);
    expect(r.ok && r.value.scoreAdjustment).toBeUndefined();
  });

  it('B. a fluent but off-topic text: task criterion 0 and total capped at 4/10', () => {
    const r = grade(reply([2, 2, 2, 3], 'OFF_TOPIC'), onTarget);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.value.criteria.find((c) => c.key === 'taskAchievement')?.score,
    ).toBe(0);
    expect(r.value.score).toBeLessThanOrEqual(4);
    expect(r.value.scoreAdjustment).toEqual({
      reason: 'OFF_TOPIC',
      providerScore: 9,
      cap: 4,
    });
    expect(r.value.feedback).toMatch(/^Bài viết chưa đúng yêu cầu của đề/);
  });

  it('C. correct content with grammar errors loses grammar points only', () => {
    const r = grade(reply([0, 2, 2, 4]), onTarget);
    expect(r.ok && r.value.score).toBe(8);
    expect(r.ok && r.value.scoreAdjustment).toBeUndefined();
  });

  it('D. good grammar but an incomplete task keeps the grader task score (PARTIAL is not capped)', () => {
    const r = grade(reply([2, 2, 2, 2], 'PARTIAL'), onTarget);
    expect(r.ok && r.value.score).toBe(8);
    expect(r.ok && r.value.relevance?.verdict).toBe('PARTIAL');
  });

  it('E. far too short: the total is capped at 5/10; criterion scores stay as graded', () => {
    const r = grade(reply([2, 2, 2, 4]), words(30));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.criteria.map((c) => c.score)).toEqual([2, 2, 2, 4]);
    expect(r.value.score).toBe(5);
    expect(r.value.scoreAdjustment).toEqual({
      reason: 'TOO_SHORT',
      providerScore: 10,
      cap: 5,
    });
    expect(r.value.feedback).toMatch(
      /^Bài viết chỉ có 30 từ, ít hơn nhiều so với yêu cầu tối thiểu 100 từ, nên tổng điểm tối đa là 5\/10\./,
    );
  });

  it('F. an overlong answer is not capped; the grader is told length is never a language error', () => {
    expect(lengthBand(200, [100, 140])).toBe('ABOVE');
    const request = buildPracticeWritingRequest(email, words(200));
    expect(JSON.parse(request.prompt).facts.length).toBe('ABOVE');
    expect(request.systemInstruction).toContain(
      'Length is never a grammar or vocabulary error',
    );
    expect(grade(reply([2, 2, 2, 4]), words(200)).ok).toBe(true);
    const r = grade(reply([2, 2, 2, 4]), words(200));
    expect(r.ok && r.value.score).toBe(10);
  });

  it('H. an incomplete response: off-topic and length rules combine, the lower cap wins', () => {
    const r = grade(reply([2, 2, 1, 3], 'OFF_TOPIC'), words(20));
    expect(r.ok && r.value.score).toBeLessThanOrEqual(4);
    expect(r.ok && r.value.scoreAdjustment?.reason).toBe('OFF_TOPIC');
  });

  it('I. style is not a server rule: two equally graded answers in different styles score the same', () => {
    const formal = `Dear Ms. Ha, ${words(110)}`;
    const informal = `Hi Ha, ${words(110)}`;
    const a = grade(reply([2, 2, 2, 4]), formal);
    const b = grade(reply([2, 2, 2, 4]), informal);
    expect(a.ok && b.ok && a.value.score === b.value.score).toBe(true);
  });

  it('J. a reply without a relevance verdict or with unaccented evidence is rejected (the grader is asked again)', () => {
    const noVerdict = grade(reply([2, 2, 2, 4], 'MAYBE'), onTarget);
    expect(!noVerdict.ok && noVerdict.reason).toBe('TASK_RELEVANCE_MISSING');
    const plain = grade(
      reply([2, 2, 2, 4], 'ON_TASK', { relevanceEvidence: 'Bai lam dung de' }),
      onTarget,
    );
    expect(!plain.ok && plain.reason).toBe('RELEVANCE_EVIDENCE_MISSING');
  });

  it('the grader is told to penalise each mistake once and receives the length band', () => {
    const request = buildPracticeWritingRequest(email, words(70));
    expect(request.systemInstruction).toContain(
      'Penalise each mistake under ONE criterion only',
    );
    expect(JSON.parse(request.prompt).facts).toMatchObject({
      wordCount: 70,
      length: 'BELOW',
    });
    expect(request.responseSchema.required).toEqual(
      expect.arrayContaining(['taskRelevance', 'relevanceEvidence']),
    );
  });
});

describe('FAR_BELOW boundaries (minimum 60 words: two thirds = 40)', () => {
  const task60 = practiceWritingTask(
    {
      taskType: 'EMAIL',
      prompt: 'Viết email 60–90 từ.',
      wordRange: [60, 90],
      rubric: {
        grammar: 2,
        vocabulary: 2,
        organization: 2,
        taskAchievement: 4,
      },
    },
    'fallback',
  )!;
  const score = (
    n: number,
    raw: [number, number, number, number] = [2, 2, 2, 4],
    relevance = 'ON_TASK',
  ) => {
    const text = n ? words(n) : '';
    const r = validatePracticeWritingResult(
      reply(raw, relevance),
      task60,
      text,
      buildPracticeWritingRequest(task60, text).facts,
    );
    if (!r.ok) throw new Error(r.reason);
    return r.value;
  };

  it('classifies around two thirds and the range exactly', () => {
    expect(lengthBand(39, [60, 90])).toBe('FAR_BELOW');
    expect(lengthBand(40, [60, 90])).toBe('BELOW');
    expect(lengthBand(41, [60, 90])).toBe('BELOW');
    expect(lengthBand(60, [60, 90])).toBe('WITHIN');
    expect(lengthBand(91, [60, 90])).toBe('ABOVE');
    expect(lengthBand(0, [60, 90])).toBe('FAR_BELOW');
    // A minimum of 100: 66 is below two thirds (66.67), 67 is not.
    expect(lengthBand(66, [100, 140])).toBe('FAR_BELOW');
    expect(lengthBand(67, [100, 140])).toBe('BELOW');
  });

  it('just below two thirds is capped; exactly and just above are not', () => {
    expect(score(39).score).toBe(5);
    expect(score(40).score).toBe(10);
    expect(score(41).score).toBe(10);
  });

  it('exactly the minimum and above the maximum are not capped', () => {
    expect(score(60).score).toBe(10);
    expect(score(120).score).toBe(10);
    expect(score(120).scoreAdjustment).toBeUndefined();
  });

  it('zero words: the cap applies at the grading layer (the API refuses an empty answer earlier)', () => {
    expect(score(0).score).toBe(5);
  });

  it('a raw score already under the cap is kept and records no adjustment', () => {
    const v = score(20, [1, 1, 1, 1]);
    expect(v.score).toBe(4);
    expect(v.scoreAdjustment).toBeUndefined();
  });

  it('a raw score above the cap is lowered to exactly 5', () => {
    expect(score(20, [2, 2, 1, 3]).score).toBe(5);
  });

  it('OFF_TOPIC and FAR_BELOW together: the lower cap (4) wins and nothing is added', () => {
    const v = score(20, [2, 2, 2, 3], 'OFF_TOPIC');
    expect(v.score).toBe(4);
    expect(v.scoreAdjustment?.reason).toBe('OFF_TOPIC');
    expect(v.feedback).toMatch(/^Bài viết chưa đúng yêu cầu của đề/);
  });

  it('tasks without a meaningful minimum are never length-capped', () => {
    const sentence = practiceWritingTask(
      {
        taskType: 'SENTENCE',
        prompt: 'meeting / tomorrow',
        requiredKeywords: ['meeting', 'tomorrow'],
        rubric: { grammar: 4, naturalness: 2, taskCompletion: 4 },
      },
      'fallback',
    )!;
    expect(lengthCapApplies(sentence)).toBe(false);
    const picture = practiceWritingTask(
      {
        taskType: 'PICTURE_SENTENCE',
        prompt: 'p',
        wordRange: [1, 40],
        rubric: { grammar: 4, vocabulary: 2, taskCompletion: 4 },
      },
      'fallback',
    )!;
    expect(lengthCapApplies(picture)).toBe(false);
    expect(lengthCapApplies(task60)).toBe(true);
    // A valid very short keyword sentence keeps its full score.
    const text = 'The meeting is tomorrow.';
    const r = validatePracticeWritingResult(
      {
        criteria: [
          { key: 'grammar', score: 4, comment: 'Câu đúng ngữ pháp.' },
          { key: 'naturalness', score: 2, comment: 'Câu tự nhiên.' },
          { key: 'taskCompletion', score: 4, comment: 'Dùng đủ hai từ.' },
        ],
        strengths: ['Ngắn gọn.'],
        corrections: [],
        feedback: 'Câu đúng và đủ yêu cầu của đề.',
        suggestions: [],
        taskRelevance: 'ON_TASK',
        relevanceEvidence: 'Câu dùng cả meeting và tomorrow.',
      },
      sentence,
      text,
      buildPracticeWritingRequest(sentence, text).facts,
    );
    expect(r.ok && r.value.score).toBe(10);
  });
});
