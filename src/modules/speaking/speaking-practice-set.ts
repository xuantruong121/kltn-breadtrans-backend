export interface SpeakingPracticeSetDefinition {
  key: string;
  title: string;
  description: string;
}

export interface SpeakingPracticeSetSource {
  id: number;
  title: string;
  practiceSet?: { id: string; title: string; description: string } | null;
}

/**
 * The catalog grouping used by both the Speaking API and cross-skill progress:
 * the practice set the exercise belongs to (practiceSetId). The old grouping
 * by title and legacy category string was the stopgap until that column came;
 * it went with the category columns (2026-11-22). Every write path puts an
 * exercise in a set, so one without a set (an old row, or a set removed
 * outside the CMS) stands alone under its own title.
 */
export function resolveSpeakingPracticeSet(
  exercise: SpeakingPracticeSetSource,
): SpeakingPracticeSetDefinition {
  if (exercise.practiceSet)
    return {
      key: exercise.practiceSet.id,
      title: exercise.practiceSet.title,
      description: exercise.practiceSet.description,
    };
  return {
    key: `exercise-${exercise.id}`,
    title: exercise.title,
    description: 'Bài luyện nói theo câu.',
  };
}
