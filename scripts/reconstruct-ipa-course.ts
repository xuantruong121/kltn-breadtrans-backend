import 'dotenv/config';
import {
  disconnectFoundationCourseMaterializer,
  materializePronunciationCourse,
} from './materialize-foundation-course-content-v6';

/**
 * Rebuild the historically verified Course #12 from authored source and
 * preserved R2 media. This command never clears course data or changes any
 * other course's publication state.
 */
async function main() {
  const result = await materializePronunciationCourse();
  if (
    result.courseId !== 12 ||
    result.lessonCount !== 8 ||
    result.mediaCount !== 8 ||
    result.status !== 'PUBLISHED'
  ) {
    throw new Error(`IPA recovery verification failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ IPA_COURSE_RECOVERY: 'PASS', ...result }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectFoundationCourseMaterializer();
  });
