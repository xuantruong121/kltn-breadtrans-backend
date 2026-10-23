/**
 * Relink Basic course cover images to their surviving R2 objects.
 *
 * The incident destroyed Course.thumbnail values. The cover objects themselves
 * survived in the media bucket under the deterministic prefix
 * `catalog/courses/course-<id>/cover/`, so this is a priority-1 reuse: no
 * image is generated or replaced.
 *
 * The canonical URLs are the ones declared by the V6 content materializer
 * (scripts/materialize-foundation-course-content-v6.ts, courseSpecs), which
 * remains the owner of course content. This script only restores the cover
 * reference, because that materializer refuses to run once authored
 * CourseLesson content exists (MATERIALIZER_ALLOW_OVERWRITE guard) and
 * forcing a content rewrite would risk the restored IPA curriculum.
 *
 * Every target is HEAD-checked on R2 before the database is touched, and a
 * cover that already resolves is left untouched. Idempotent.
 *
 * Usage:
 *   npx ts-node scripts/relink-course-covers.ts
 *   npx ts-node scripts/relink-course-covers.ts --check
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const checkOnly = process.argv.includes('--check');

/** Mirrors courseSpecs[].thumbnail in the V6 materializer. */
const CANONICAL_COVERS: Record<number, string> = {
  1: 'catalog/courses/course-1/cover/v2-c85e2a13a7d6956f.jpg',
  8: 'catalog/courses/course-8/cover/v2-19c44391cc6450c5.jpg',
  12: 'catalog/courses/course-12/cover/v2-1e69646244474471.jpg',
};

function publicUrl(key: string) {
  const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  if (!base) throw new Error('R2_PUBLIC_URL is not configured');
  return `${base}/${key}`;
}

async function resolves(url: string) {
  try {
    const response = await fetch(url, { method: 'GET' });
    const length = Number(response.headers.get('content-length') ?? '0');
    return {
      ok: response.ok && length > 0,
      status: response.status,
      bytes: length,
      contentType: response.headers.get('content-type'),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      bytes: 0,
      contentType: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const [rawId, key] of Object.entries(CANONICAL_COVERS)) {
      const courseId = Number(rawId);
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, title: true, thumbnail: true },
      });
      if (!course) {
        console.log(`  course ${courseId}: NOT PRESENT (skipped)`);
        continue;
      }

      const target = publicUrl(key);
      if (course.thumbnail === target) {
        const live = await resolves(target);
        console.log(
          `  course ${courseId}: already linked (${live.ok ? `${live.bytes} bytes ${live.contentType}` : `UNRESOLVABLE http ${live.status}`})`,
        );
        continue;
      }

      const live = await resolves(target);
      if (!live.ok) {
        console.log(
          `  course ${courseId}: REFUSING — surviving object does not resolve (http ${live.status}, ${live.bytes} bytes)`,
        );
        continue;
      }
      if (checkOnly) {
        console.log(
          `  course ${courseId}: would relink -> ${key} (${live.bytes} bytes ${live.contentType})`,
        );
        continue;
      }
      await prisma.course.update({
        where: { id: courseId },
        data: { thumbnail: target },
      });
      console.log(
        `  course ${courseId}: RELINKED -> ${key} (${live.bytes} bytes ${live.contentType})`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

console.log(`Course cover relink${checkOnly ? ' (check only)' : ''}:`);
void main().catch((error) => {
  console.error(
    'Cover relink failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
