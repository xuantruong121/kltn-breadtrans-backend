import 'dotenv/config';
import {
  disconnectFoundationCourseMaterializer,
  materializeFoundationCourses,
} from './materialize-foundation-course-content-v6';

/**
 * Rebuild the authored V6 content for the canonical Basic courses that the
 * IPA-only recovery command does not cover (Course 1 "English Foundations
 * A1–A2" and Course 8 "Grammar & Vocabulary Builder").
 *
 * The V6 materializer is the single owner of these courses' authored content
 * and of their cover images, which point at already-surviving R2 objects
 * (catalog/courses/course-<id>/cover/v2-*.jpg). Running it relinks those
 * covers instead of generating replacements.
 *
 * Non-destructive: the materializer deletes no Course, Lesson, Exercise,
 * Question, Attempt, Enrollment, Progress or media rows. It only rebuilds the
 * lesson reference rows it owns and demotes non-target published courses to
 * DRAFT.
 */
async function main() {
  const result = await materializeFoundationCourses();
  console.log(
    JSON.stringify({ FOUNDATION_COURSE_RECOVERY: 'DONE', result }, null, 1),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectFoundationCourseMaterializer();
  });
