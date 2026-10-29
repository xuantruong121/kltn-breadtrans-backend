/**
 * Writing practice grading quality (deterministic): the server-side rules that
 * hold whatever the grader says. The grader is a fixed reply here; how a real
 * model scores these texts is not tested (no provider call).
 */
import {
  buildPracticeWritingRequest,
  lengthBand,
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

  it('E. far too short: task criterion capped at half; slightly short is left to the grader', () => {
    expect(lengthBand(30, [100, 140])).toBe('FAR_BELOW');
    expect(lengthBand(80, [100, 140])).toBe('BELOW');
    const short = words(30);
    const r = grade(reply([2, 2, 2, 4]), short);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const task = r.value.criteria.find((c) => c.key === 'taskAchievement')!;
    expect(task.score).toBe(2);
    expect(task.comment).toMatch(/^Bài chỉ có 30 từ/);
    expect(r.value.scoreAdjustment).toEqual({
      reason: 'TOO_SHORT',
      providerScore: 10,
      cap: 8,
    });
    expect(
      grade(reply([2, 2, 2, 4]), words(80)).ok &&
        grade(reply([2, 2, 2, 4]), words(80)),
    ).toMatchObject({ value: { score: 10 } });
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
