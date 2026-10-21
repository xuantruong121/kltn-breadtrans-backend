/** Phase 8.16: deterministic completeness review for AI lesson candidates.
 * Candidate-only guidance for the Admin review panel — never a Publish gate
 * and never an "AI quality score". */

export type AiSectionCandidate = {
  type: string;
  heading?: string;
  content?: string;
  paragraphs?: string[];
  bullets?: string[];
  examples?: Array<{
    text?: string;
    translation?: string;
    explanation?: string;
  }>;
};

export type AiExerciseCandidate = {
  title?: string;
  questions?: Array<{ prompt?: string }>;
};

const THIN_THEORY_CHARS = 160;

const normalize = (value?: string) =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const explanationLength = (section: AiSectionCandidate) =>
  [section.content ?? '', ...(section.paragraphs ?? [])].join(' ').trim()
    .length;

const sectionLabel = (section: AiSectionCandidate, index: number) =>
  section.heading?.trim() || `Mục ${index + 1}`;

/** Lightweight objective coverage: an objective counts as covered when a
 * meaningful word from it appears anywhere in the generated content. */
const objectiveCovered = (objective: string, haystack: string) => {
  const words = normalize(objective)
    .split(' ')
    .filter((word) => word.length > 3);
  if (!words.length) return true;
  return words.some((word) => haystack.includes(word));
};

export function reviewLessonContentCandidate(candidate: {
  sections?: AiSectionCandidate[];
  guidedPractice?: AiExerciseCandidate | null;
  finalCheck?: AiExerciseCandidate | null;
  objectives?: string[];
}) {
  const warnings: string[] = [];
  const sections = candidate.sections ?? [];

  sections.forEach((section, index) => {
    const label = sectionLabel(section, index);
    if (!section.heading?.trim())
      warnings.push(`Mục ${index + 1} chưa có tiêu đề.`);
    if (!explanationLength(section))
      warnings.push(`Mục “${label}” chưa có nội dung chính.`);
    else if (
      section.type === 'THEORY' &&
      explanationLength(section) < THIN_THEORY_CHARS &&
      !(section.bullets ?? []).length
    )
      warnings.push(
        `Nội dung phần Lý thuyết “${label}” còn khá ngắn. Hãy bổ sung giải thích hoặc ý chính.`,
      );
    if (section.type === 'EXAMPLE' && !(section.examples ?? []).length)
      warnings.push(`Mục ví dụ “${label}” chưa có ví dụ minh họa.`);

    const exampleTexts = (section.examples ?? [])
      .map((example) => normalize(example.text))
      .filter(Boolean);
    if (new Set(exampleTexts).size !== exampleTexts.length)
      warnings.push(`Mục “${label}” có ví dụ trùng lặp.`);
  });

  const headings = sections
    .map((section) => normalize(section.heading))
    .filter(Boolean);
  if (new Set(headings).size !== headings.length)
    warnings.push('Có hai mục nội dung trùng tiêu đề.');

  const guidedPrompts = (candidate.guidedPractice?.questions ?? [])
    .map((question) => normalize(question.prompt))
    .filter(Boolean);
  const finalPrompts = (candidate.finalCheck?.questions ?? [])
    .map((question) => normalize(question.prompt))
    .filter(Boolean);
  const duplicateQuestions = finalPrompts.filter((prompt) =>
    guidedPrompts.includes(prompt),
  ).length;
  if (duplicateQuestions)
    warnings.push(
      `Kiểm tra cuối bài có ${duplicateQuestions} câu trùng với phần Luyện tập.`,
    );

  const objectives = (candidate.objectives ?? []).filter((objective) =>
    objective?.trim(),
  );
  if (sections.length && objectives.length) {
    const haystack = normalize(
      sections
        .flatMap((section) => [
          section.heading ?? '',
          section.content ?? '',
          ...(section.paragraphs ?? []),
          ...(section.bullets ?? []),
          ...(section.examples ?? []).flatMap((example) => [
            example.text ?? '',
            example.explanation ?? '',
          ]),
        ])
        .join(' '),
    );
    const uncovered = objectives.filter(
      (objective) => !objectiveCovered(objective, haystack),
    );
    if (uncovered.length)
      warnings.push(
        `Chưa thấy nội dung cho mục tiêu: ${uncovered
          .map((objective) => `“${objective.trim()}”`)
          .join(', ')}.`,
      );
  }

  return { warnings, duplicateQuestionCount: duplicateQuestions };
}
