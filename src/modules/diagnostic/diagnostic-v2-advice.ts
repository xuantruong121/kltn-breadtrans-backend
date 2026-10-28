/**
 * D1 advice for FOUR_SKILL_PLACEMENT_V2 (DEF-004 decided as D1: advisory
 * scores and evidence-based advice, never a named level).
 *
 * Every finding is derived from evidence the attempt actually holds:
 *   - Listening / Reading / Language Use: which items were answered wrongly,
 *     grouped by the construct each item was authored to measure;
 *   - Speaking / Writing: the rubric criteria (0-4) of graded tasks and the
 *     grader's own per-criterion feedback, quoted as returned.
 * A skill without a valid score (skipped, pending, failed) is never called a
 * weakness. No score threshold maps to a level; the only fixed number is the
 * "balanced" spread of 10 points, which is one objective item.
 *
 * Learning resources are references to existing published content. This
 * module never invents them: the caller resolves each reference against the
 * database and the learner's entitlements, and unresolved ones are dropped.
 *
 * Pure: no Prisma, no I/O.
 */
import type { FourSkillKey, FourSkillResult } from './diagnostic-four-skill';

export const ADVICE_VERSION = 'D1_ADVICE_V1';

export type ResourceKind =
  | 'LISTENING_QUIZ'
  | 'READING_QUIZ'
  | 'WRITING_QUIZ'
  | 'SPEAKING_EXERCISE'
  | 'COURSE';

export type ResourceRef = { kind: ResourceKind; id: number };

export type ResolvedResource = ResourceRef & {
  title: string;
  route: string;
  /** OPEN: usable now. LOCKED: exists and is published, but needs a plan. */
  access: 'OPEN' | 'LOCKED';
  /** Learner-facing requirement when LOCKED, e.g. "Cần gói PRO". */
  requirement: string | null;
  /** Speaking: the practice set the exercise belongs to (the catalog unit). */
  setKey?: string | null;
  /** Speaking: the set's authored CEFR level, for the display title. */
  cefrLevel?: string | null;
};

export type ResourceResolver = (ref: ResourceRef) => ResolvedResource | null;

type AreaDef = {
  key: string;
  label: string;
  why: string;
  action: string;
  resources: ResourceRef[];
};

const quiz = (kind: ResourceKind, id: number): ResourceRef => ({ kind, id });

/** Objective areas, keyed by the authored `construct` of each item. */
const OBJECTIVE_AREAS: Record<
  string,
  { constructs: string[]; def: AreaDef }[]
> = {
  LISTENING: [
    {
      constructs: ['gist'],
      def: {
        key: 'LISTENING_GIST',
        label: 'Nắm ý chính của đoạn nghe',
        why: 'Khi chưa nắm được đoạn nghe nói về việc gì, bạn dễ chọn đáp án có từ quen tai nhưng sai ý.',
        action:
          'Nghe lần đầu chỉ để trả lời "đoạn này nói về việc gì, ai đang nói với ai", rồi mới nghe lại để kiểm tra chi tiết.',
        resources: [quiz('LISTENING_QUIZ', 26), quiz('LISTENING_QUIZ', 1)],
      },
    },
    {
      constructs: ['specific detail'],
      def: {
        key: 'LISTENING_DETAIL',
        label: 'Nghe chi tiết cụ thể (thời gian, địa điểm, con số)',
        why: 'Các câu hỏi chi tiết cần bắt đúng một thông tin; nghe sót một từ là chọn sai.',
        action:
          'Đọc câu hỏi trước khi nghe để biết cần bắt thông tin gì, và luyện nghe chép để quen bắt chính xác từng từ.',
        resources: [quiz('LISTENING_QUIZ', 23), quiz('LISTENING_QUIZ', 24)],
      },
    },
    {
      constructs: ['purpose', 'speaker intention', 'inference'],
      def: {
        key: 'LISTENING_INTENT',
        label: 'Hiểu mục đích, ý định và điều người nói ngụ ý',
        why: 'Những câu này không có đáp án nói thẳng trong bài; bạn cần suy ra từ cách người nói diễn đạt.',
        action:
          'Sau mỗi đoạn hội thoại, tự hỏi "người nói muốn đạt được điều gì?" và tìm câu trong bài làm căn cứ cho câu trả lời.',
        resources: [quiz('LISTENING_QUIZ', 27), quiz('LISTENING_QUIZ', 12)],
      },
    },
  ],
  READING: [
    {
      constructs: ['main idea'],
      def: {
        key: 'READING_MAIN_IDEA',
        label: 'Xác định ý chính của đoạn văn',
        why: 'Câu hỏi ý chính cần nhìn cả đoạn; chọn theo một câu đơn lẻ thường dẫn tới đáp án quá hẹp.',
        action:
          'Đọc lướt câu đầu và câu cuối mỗi đoạn, tóm tắt đoạn văn trong một câu trước khi xem các lựa chọn.',
        resources: [quiz('READING_QUIZ', 13), quiz('READING_QUIZ', 2)],
      },
    },
    {
      constructs: ['specific detail'],
      def: {
        key: 'READING_DETAIL',
        label: 'Tìm thông tin chi tiết trong văn bản',
        why: 'Đáp án chi tiết nằm ở một vị trí cụ thể trong bài; chọn theo trí nhớ thay vì đối chiếu dễ sai.',
        action:
          'Gạch từ khoá trong câu hỏi, tìm đúng câu chứa từ khoá đó (hoặc từ đồng nghĩa) và so từng lựa chọn với câu ấy.',
        resources: [quiz('READING_QUIZ', 2), quiz('READING_QUIZ', 13)],
      },
    },
    {
      constructs: ['meaning in context', 'reference'],
      def: {
        key: 'READING_CONTEXT',
        label: 'Hiểu nghĩa của từ và đại từ theo ngữ cảnh',
        why: 'Nghĩa của một từ hay "it/they/this" phụ thuộc vào câu xung quanh, không phải nghĩa quen thuộc nhất.',
        action:
          'Khi gặp từ hoặc đại từ được hỏi, đọc lại câu trước và câu sau, thay thử từng lựa chọn vào câu để kiểm tra.',
        resources: [quiz('READING_QUIZ', 6), quiz('COURSE', 8)],
      },
    },
    {
      constructs: ['inference'],
      def: {
        key: 'READING_INFERENCE',
        label: 'Suy luận từ thông tin trong bài',
        why: 'Câu suy luận đòi hỏi kết luận có căn cứ trong bài, không phải kiến thức hay suy đoán bên ngoài.',
        action:
          'Với mỗi lựa chọn, tìm câu trong bài làm căn cứ; loại những lựa chọn không có câu nào chứng minh.',
        resources: [quiz('READING_QUIZ', 6), quiz('READING_QUIZ', 16)],
      },
    },
  ],
  LANGUAGE_USE: [
    {
      constructs: ['grammar'],
      def: {
        key: 'LANGUAGE_USE_GRAMMAR',
        label: 'Ngữ pháp nền tảng',
        why: 'Một số câu ngữ pháp trong phần bổ trợ chưa đúng; phần này không tính vào điểm tổng nhưng ảnh hưởng tới Nói và Viết.',
        action:
          'Xem lại giải thích của các câu sai ở phần đối chiếu đáp án, rồi học bài ngữ pháp tương ứng.',
        resources: [quiz('COURSE', 8)],
      },
    },
    {
      constructs: ['vocabulary'],
      def: {
        key: 'LANGUAGE_USE_VOCABULARY',
        label: 'Từ vựng và cách kết hợp từ',
        why: 'Một số câu từ vựng trong phần bổ trợ chưa đúng; phần này không tính vào điểm tổng.',
        action:
          'Ghi lại các từ trong câu sai cùng câu ví dụ, rồi ôn theo chủ đề.',
        resources: [quiz('COURSE', 8)],
      },
    },
  ],
};

/** Productive areas, keyed by rubric criterion. */
const CRITERION_AREAS: Record<
  'SPEAKING' | 'WRITING',
  Record<string, AreaDef>
> = {
  SPEAKING: {
    task_fulfilment: {
      key: 'SPEAKING_TASK',
      label: 'Trả lời đủ các ý đề bài yêu cầu',
      why: 'Bài nói được chấm trước hết theo việc bạn có trả lời đúng và đủ những gì đề hỏi hay không.',
      action:
        'Trong thời gian chuẩn bị, liệt kê nhanh các ý đề bài yêu cầu và nói lần lượt từng ý, kèm một lý do hoặc ví dụ.',
      resources: [quiz('SPEAKING_EXERCISE', 16), quiz('SPEAKING_EXERCISE', 17)],
    },
    intelligibility: {
      key: 'SPEAKING_INTELLIGIBILITY',
      label: 'Phát âm rõ để người nghe hiểu',
      why: 'Khi một số từ khó nghe rõ, người nghe phải đoán ý và câu trả lời mất điểm dù nội dung đúng.',
      action:
        'Luyện các âm cuối và trọng âm từ, ghi âm lại và so sánh với mẫu.',
      resources: [quiz('COURSE', 12), quiz('SPEAKING_EXERCISE', 11)],
    },
    fluency: {
      key: 'SPEAKING_FLUENCY',
      label: 'Nói liền mạch, ít ngắt quãng',
      why: 'Các khoảng dừng dài hoặc bắt đầu lại nhiều lần làm bài nói khó theo dõi.',
      action:
        'Trả lời các câu hỏi ngắn trong thời gian giới hạn, dùng cụm nối như "first", "because", "for example" để không bị ngắt mạch.',
      resources: [quiz('SPEAKING_EXERCISE', 16), quiz('SPEAKING_EXERCISE', 17)],
    },
    language_use: {
      key: 'SPEAKING_LANGUAGE',
      label: 'Dùng từ vựng và ngữ pháp khi nói',
      why: 'Lỗi ngữ pháp hoặc vốn từ hạn chế làm ý bạn muốn nói kém chính xác.',
      action:
        'Ôn các cấu trúc câu cơ bản và luyện dùng chúng trong câu trả lời ngắn có lý do.',
      resources: [quiz('SPEAKING_EXERCISE', 16), quiz('COURSE', 8)],
    },
  },
  WRITING: {
    task_achievement: {
      key: 'WRITING_TASK',
      label: 'Đáp ứng đủ yêu cầu của đề viết',
      why: 'Đề viết có các ý bắt buộc; thiếu một ý là bài mất điểm dù câu văn đúng.',
      action:
        'Trước khi viết, gạch dưới từng yêu cầu của đề và kiểm tra lại sau khi viết xong rằng mỗi yêu cầu đều có câu đáp ứng.',
      resources: [quiz('WRITING_QUIZ', 17), quiz('WRITING_QUIZ', 4)],
    },
    organisation: {
      key: 'WRITING_ORGANISATION',
      label: 'Sắp xếp ý và liên kết câu',
      why: 'Ý đúng nhưng sắp xếp lộn xộn hoặc thiếu từ nối khiến người đọc khó theo dõi lập luận.',
      action:
        'Dùng bố cục mở – thân – kết; mỗi lý do một đoạn hoặc một câu chủ đề, nối bằng "firstly", "also", "however".',
      resources: [quiz('WRITING_QUIZ', 17), quiz('WRITING_QUIZ', 19)],
    },
    vocabulary: {
      key: 'WRITING_VOCABULARY',
      label: 'Dùng từ chính xác và đa dạng',
      why: 'Lặp từ hoặc dùng từ chưa đúng nghĩa làm bài viết kém rõ ràng.',
      action:
        'Sau khi viết, đánh dấu các từ lặp lại và thay bằng từ cụ thể hơn; ghi lại các cụm từ hay gặp theo chủ đề.',
      resources: [quiz('COURSE', 8), quiz('WRITING_QUIZ', 17)],
    },
    grammar: {
      key: 'WRITING_GRAMMAR',
      label: 'Độ chính xác ngữ pháp',
      why: 'Lỗi chia động từ, thì hoặc cấu trúc câu làm giảm độ rõ ràng và độ tin cậy của bài viết.',
      action:
        'Đọc lại bài, kiểm tra riêng từng loại lỗi: thì của động từ, chủ ngữ – động từ, mạo từ.',
      resources: [quiz('COURSE', 8), quiz('WRITING_QUIZ', 17)],
    },
  },
};

const GENERAL_PRACTICE: Partial<Record<FourSkillKey, ResourceRef>> = {
  SPEAKING: quiz('SPEAKING_EXERCISE', 16),
  WRITING: quiz('WRITING_QUIZ', 17),
};

/** Every reference this module can cite, for the caller to resolve in one batch. */
export function allAdviceResourceRefs(): ResourceRef[] {
  const refs: ResourceRef[] = [];
  for (const groups of Object.values(OBJECTIVE_AREAS))
    for (const group of groups) refs.push(...group.def.resources);
  for (const byCriterion of Object.values(CRITERION_AREAS))
    for (const def of Object.values(byCriterion)) refs.push(...def.resources);
  refs.push(...Object.values(GENERAL_PRACTICE));
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type ObjectiveItemEvidence = {
  section: string | null | undefined;
  construct: string | null | undefined;
  isCorrect: boolean;
};

export type ProductiveTaskEvidence = {
  skill: 'SPEAKING' | 'WRITING';
  questionId: number;
  status: string;
  criteria: Record<string, number> | null | undefined;
  criterionFeedback: Record<string, string> | null | undefined;
  provider: string | null | undefined;
};

export type AdviceFinding = {
  skill: FourSkillKey;
  areaKey: string;
  area: string;
  evidence: string;
};

export type AdvicePriority = AdviceFinding & {
  rank: number;
  why: string;
  action: string;
  /** The grader's own per-criterion comments on this learner's responses. */
  graderFeedback: string[];
  resources: ResolvedResource[];
};

export type UnassessedReason =
  'SKIPPED' | 'PENDING_GRADING' | 'GRADING_FAILED' | 'NOT_SUBMITTED';

export type DiagnosticAdvice = {
  version: typeof ADVICE_VERSION;
  basis: 'D1_ADVISORY_SCORES_ONLY';
  profile: {
    assessed: FourSkillKey[];
    strongest: FourSkillKey[];
    weakest: FourSkillKey[];
    /** Spread of the assessed required skills is at most one objective item. */
    balanced: boolean;
    spread: number | null;
  };
  strengths: AdviceFinding[];
  priorities: AdvicePriority[];
  /** Language Use: supporting advice only (weight 0). */
  supplemental: AdvicePriority[];
  unassessed: Array<{
    skill: FourSkillKey;
    reason: UnassessedReason;
    /** General preparation, explicitly not a diagnosed weakness. */
    generalPractice: ResolvedResource | null;
  }>;
  /** True when a productive finding rests on the mock grader (never real advice). */
  mockGraderEvidence: boolean;
  noWeaknessFound: boolean;
};

const REQUIRED: FourSkillKey[] = [
  'LISTENING',
  'READING',
  'SPEAKING',
  'WRITING',
];
const BALANCED_SPREAD = 10; // one objective item out of ten
const MAX_PRIORITIES = 3;
const MAX_RESOURCES = 2;
const CRITERION_MAX = 4;

type Candidate = AdviceFinding & {
  weight: number; // higher = more urgent within the skill
  def: AreaDef;
  graderFeedback: string[];
};

function objectiveFindings(
  skill: FourSkillKey,
  items: ObjectiveItemEvidence[],
) {
  const groups = OBJECTIVE_AREAS[skill] ?? [];
  const weaknesses: Candidate[] = [];
  const strengths: AdviceFinding[] = [];
  for (const group of groups) {
    const own = items.filter(
      (item) =>
        item.section === skill &&
        group.constructs.includes((item.construct ?? '').trim().toLowerCase()),
    );
    if (!own.length) continue;
    const wrong = own.filter((item) => !item.isCorrect).length;
    if (wrong > 0)
      weaknesses.push({
        skill,
        areaKey: group.def.key,
        area: group.def.label,
        evidence: `Sai ${wrong}/${own.length} câu thuộc dạng này.`,
        weight: wrong / own.length + wrong / 100,
        def: group.def,
        graderFeedback: [],
      });
    else if (own.length >= 2)
      strengths.push({
        skill,
        areaKey: group.def.key,
        area: group.def.label,
        evidence: `Đúng ${own.length}/${own.length} câu thuộc dạng này.`,
      });
  }
  weaknesses.sort((a, b) => b.weight - a.weight);
  return { weaknesses, strengths };
}

function productiveFindings(
  skill: 'SPEAKING' | 'WRITING',
  tasks: ProductiveTaskEvidence[],
) {
  const graded = tasks.filter(
    (t) => t.skill === skill && t.status === 'GRADED',
  );
  const defs = CRITERION_AREAS[skill];
  const means: Array<{ key: string; mean: number; feedback: string[] }> = [];
  for (const key of Object.keys(defs)) {
    const values = graded
      .map((t) => t.criteria?.[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    // A criterion is used only when every graded task reports it.
    if (!graded.length || values.length !== graded.length) continue;
    means.push({
      key,
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      feedback: graded
        .map((t) => t.criterionFeedback?.[key]?.trim())
        .filter((v): v is string => !!v),
    });
  }
  const weaknesses: Candidate[] = [];
  const strengths: AdviceFinding[] = [];
  if (!means.length) return { weaknesses, strengths };
  const fmt = (m: number) => (Number.isInteger(m) ? String(m) : m.toFixed(1));
  const min = Math.min(...means.map((m) => m.mean));
  const max = Math.max(...means.map((m) => m.mean));
  const n = graded.length;
  if (min === max) {
    if (min < CRITERION_MAX) {
      // Every criterion equal and below the maximum: no single area stands
      // out, so the advice is the task criterion, stated as such.
      const first = means[0];
      const def = defs[first.key];
      weaknesses.push({
        skill,
        areaKey: def.key,
        area: def.label,
        evidence: `Các tiêu chí đều đạt ${fmt(min)}/4 trung bình qua ${n} bài; chưa có tiêu chí nào nổi bật hơn.`,
        weight: (CRITERION_MAX - min) / CRITERION_MAX,
        def,
        graderFeedback: first.feedback,
      });
    }
    return { weaknesses, strengths };
  }
  for (const m of means.filter((m) => m.mean === min).slice(0, 2)) {
    const def = defs[m.key];
    weaknesses.push({
      skill,
      areaKey: def.key,
      area: def.label,
      evidence: `Tiêu chí thấp nhất: ${fmt(m.mean)}/4 trung bình qua ${n} bài (cao nhất ${fmt(max)}/4).`,
      weight: (CRITERION_MAX - m.mean) / CRITERION_MAX,
      def,
      graderFeedback: m.feedback,
    });
  }
  for (const m of means.filter((m) => m.mean === max)) {
    const def = defs[m.key];
    strengths.push({
      skill,
      areaKey: def.key,
      area: def.label,
      evidence: `Tiêu chí cao nhất: ${fmt(m.mean)}/4 trung bình qua ${n} bài.`,
    });
  }
  return { weaknesses, strengths };
}

function unassessedReason(
  s: FourSkillResult['skills'][FourSkillKey],
): UnassessedReason {
  if (s.tasksPending > 0 || s.state === 'PENDING_GRADING')
    return 'PENDING_GRADING';
  if (s.tasksFailed > 0 || s.state === 'GRADING_FAILED')
    return 'GRADING_FAILED';
  if (s.tasksSkipped > 0) return 'SKIPPED';
  return 'NOT_SUBMITTED';
}

export function buildDiagnosticAdvice(input: {
  fourSkill: FourSkillResult;
  objective: ObjectiveItemEvidence[];
  productive: ProductiveTaskEvidence[];
  resolve: ResourceResolver;
}): DiagnosticAdvice {
  const { fourSkill, resolve } = input;
  const resourcesFor = (def: AreaDef) =>
    def.resources
      .map(resolve)
      .filter((r): r is ResolvedResource => r !== null)
      .sort((a, b) =>
        a.access === b.access ? 0 : a.access === 'OPEN' ? -1 : 1,
      )
      .slice(0, MAX_RESOURCES);

  const assessed = REQUIRED.filter(
    (s) => fourSkill.skills[s].state === 'COMPLETE',
  );
  const scores = assessed.map((s) => fourSkill.skills[s].score as number);
  const spread =
    scores.length >= 2 ? Math.max(...scores) - Math.min(...scores) : null;
  const balanced = spread !== null && spread <= BALANCED_SPREAD;
  const strongest =
    scores.length >= 2 && !balanced
      ? assessed.filter(
          (s) => fourSkill.skills[s].score === Math.max(...scores),
        )
      : [];
  const weakest =
    scores.length >= 2 && !balanced
      ? assessed.filter(
          (s) => fourSkill.skills[s].score === Math.min(...scores),
        )
      : [];

  const perSkill = new Map<FourSkillKey, Candidate[]>();
  const strengths: AdviceFinding[] = [];
  let mockGraderEvidence = false;
  for (const skill of assessed) {
    const found =
      skill === 'SPEAKING' || skill === 'WRITING'
        ? productiveFindings(skill, input.productive)
        : objectiveFindings(skill, input.objective);
    if (
      (skill === 'SPEAKING' || skill === 'WRITING') &&
      input.productive.some(
        (t) =>
          t.skill === skill &&
          t.status === 'GRADED' &&
          (t.provider ?? '').toLowerCase().includes('mock'),
      )
    )
      mockGraderEvidence = true;
    perSkill.set(skill, found.weaknesses);
    strengths.push(...found.strengths);
  }

  // Lowest-scoring skill first; one area per skill per round.
  const order = [...assessed].sort(
    (a, b) =>
      (fourSkill.skills[a].score as number) -
        (fourSkill.skills[b].score as number) ||
      REQUIRED.indexOf(a) - REQUIRED.indexOf(b),
  );
  const priorities: AdvicePriority[] = [];
  for (let round = 0; priorities.length < MAX_PRIORITIES; round += 1) {
    let added = false;
    for (const skill of order) {
      const candidate = perSkill.get(skill)?.[round];
      if (!candidate || priorities.length >= MAX_PRIORITIES) continue;
      priorities.push({
        rank: priorities.length + 1,
        skill: candidate.skill,
        areaKey: candidate.areaKey,
        area: candidate.area,
        evidence: candidate.evidence,
        why: candidate.def.why,
        action: candidate.def.action,
        graderFeedback: candidate.graderFeedback,
        resources: resourcesFor(candidate.def),
      });
      added = true;
    }
    if (!added) break;
  }

  const supplemental: AdvicePriority[] =
    fourSkill.skills.LANGUAGE_USE.state === 'COMPLETE'
      ? objectiveFindings('LANGUAGE_USE', input.objective)
          .weaknesses.slice(0, 1)
          .map((c, i) => ({
            rank: i + 1,
            skill: c.skill,
            areaKey: c.areaKey,
            area: c.area,
            evidence: c.evidence,
            why: c.def.why,
            action: c.def.action,
            graderFeedback: [],
            resources: resourcesFor(c.def),
          }))
      : [];

  const unassessed = REQUIRED.filter((s) => !assessed.includes(s)).map(
    (skill) => {
      const reason = unassessedReason(fourSkill.skills[skill]);
      const general = GENERAL_PRACTICE[skill];
      return {
        skill,
        reason,
        generalPractice:
          general && (reason === 'SKIPPED' || reason === 'NOT_SUBMITTED')
            ? resolve(general)
            : null,
      };
    },
  );

  return {
    version: ADVICE_VERSION,
    basis: 'D1_ADVISORY_SCORES_ONLY',
    profile: { assessed, strongest, weakest, balanced, spread },
    strengths,
    priorities,
    supplemental,
    unassessed,
    mockGraderEvidence,
    noWeaknessFound: assessed.length > 0 && priorities.length === 0,
  };
}
