/**
 * Compatibility entry point for the original V5 command.
 * The source of truth for Foundation Course content is now the explicit V6
 * authoring script. Keeping this entry point means existing local workflows
 * remain idempotent without retaining the old template generator.
 */
import { materializeFoundationCourses } from './materialize-foundation-course-content-v6';

materializeFoundationCourses().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
