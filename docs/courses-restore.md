# Restoring courses

Courses, classes and tuition were removed on 2026-11-01 because the thesis supervisor dropped them from the project. This file is enough for an AI agent or a developer to bring them back. Read all of it before changing anything.

**Never write to `kltn_db` without the owner's explicit approval for that exact step.** Rehearse on a disposable harness database first. Read `docs/database-safety.md`.

## What the restore kit holds

| Item | Where |
|---|---|
| Last code with courses | Tag `archive/courses-before-removal`: backend `452c2af`, frontend `8a71d55` |
| Removal commits | Backend and frontend hashes under "Removal commits" |
| Code without GitHub | `backend-before-removal.bundle`, `frontend-before-removal.bundle` |
| Schema before removal | `schema-before-removal.prisma` |
| SQL that recreates the structure | `docs/courses-restore.sql` in this repo, same as `restore-schema.sql` |
| Data of the 20 tables | `courses-data.dump` (`pg_dump -Fc --data-only`) |
| Whole database before removal | `kltn_db_PRE_COURSES_REMOVAL_PROTECTED_*.dump` |
| Row counts | `row-counts.txt` |
| PRO entitlement row | `plan-entitlement.txt` |
| File list on R2 | `r2-files.txt`: 3 course covers, 16 lesson media, 16 materials. The files stay on R2 |
| Checksums | `SHA256SUMS.txt` |

Files without a repo path are in `D:\Study\KLTN\.local-backups\courses-removal\`. They are not in git. If that folder is gone, the code and structure still restore from the tag, but the data does not.

## What was removed

**Tables (20):** `Course`, `Class`, `Enrollment`, `Payment`, `Lesson`, `Material`, `CourseActivity`, `CourseLesson`, `CourseLessonSection`, `CourseLessonExercise`, `CourseLessonQuestion`, `CourseLessonReference`, `CourseLessonMedia`, `CourseLessonAttempt`, `CourseLessonExerciseAnswer`, `Assignment`, `AssignmentSubmission`, `Announcement`, `WatchTracking`, `UserBilling`.

**Columns:** `Quiz.courseId`, `PayOSPaymentIntent.coursePaymentId`.

**Enums dropped:** `CourseStatus`, `ClassStatus`, `EnrollmentStatus`, `PaymentStatus`, `PaymentActivationIssue`, `CourseLessonStatus`, `CourseLessonSectionType`, `CourseLessonExerciseType`, `CourseLessonAttemptStatus`, `AssignmentType`.

**Enum values:** `PlanFeatureKey.COURSE_LIBRARY_ACCESS`, `PayOSPaymentIntentType.COURSE`, `IssueReportArea.COURSE`.

**Data row:** the `COURSE_LIBRARY_ACCESS` row of plan version 1 in `PlanEntitlement`.

**Migration:** `prisma/migrations/20261101120000_remove_courses`.

**Backend code:** `src/modules/course`, the empty `src/modules/teacher`, `courses-enabled.guard`, Admin course endpoints, course AI endpoints and Gemini methods, tuition emails, the course step in diagnostic advice, course seed data, and 47 one-off scripts. `git diff archive/courses-before-removal <removal head> --stat` lists every file.

**Frontend code:** routes `/courses`, `/my-courses`, `/classes`, `/learn`, Admin `/admin/courses`, `/admin/assignments`, `/admin/enroll`; `src/lib/course`, `src/components/course`, `src/modules/learn`, `course.service.ts`, `learn.service.ts`, `CourseAiWorkspaceDialog`, `PublicFloatingPet`, `featureFlags.ts`; the Admin recent-activity panel and the enrolment chart; `returnTo` links back to lessons.

**Environment:** `COURSES_ENABLED`, `NEXT_PUBLIC_COURSES_ENABLED`. Both must be `true` after a restore, because the old code hides courses by default.

**Redirects to remove:** `removedRoutes` in the frontend `next.config.ts`.

## Removal commits

Backend, oldest first: `8ce53f4`, `7a05317`, `64e3c7c`, `4162173`. Keep the commit that adds this file.

Frontend: `e7e8c68`.

## Steps

Run them in this order, on a harness clone first.

### 1. Check the kit

```bash
cd D:/Study/KLTN/.local-backups/courses-removal
sha256sum -c SHA256SUMS.txt
git bundle verify backend-before-removal.bundle
git bundle verify frontend-before-removal.bundle
```

### 2. Restore the code

Work on a new branch in each repo. Use `git revert --no-edit` on the removal commits, newest first. If later work makes that conflict, take the deleted files from the tag with `git checkout archive/courses-before-removal -- <path>` and merge by hand. The tag is the reference for how each file looked.

If the tag is missing, get it from the bundle:

```bash
git fetch D:/Study/KLTN/.local-backups/courses-removal/backend-before-removal.bundle archive/courses-before-removal:refs/tags/archive/courses-before-removal
```

Keep the migration folder `20261101120000_remove_courses`: the database has already applied it. If a revert deleted it, put it back:

```bash
git checkout <removal head> -- prisma/migrations/20261101120000_remove_courses
```

### 3. Add a new migration for the structure

Create `prisma/migrations/<timestamp>_restore_courses/migration.sql` with the content of `docs/courses-restore.sql`. Then confirm `prisma/schema.prisma` matches `schema-before-removal.prisma`, apart from any change made after the removal. New enum values must commit before a row uses them, so step 5 runs after the migration, not inside it.

Use `npx prisma migrate deploy`. It needs no shadow database. **Never pass `--shadow-database-url` pointing at a real database.**

### 4. Load the data

Copy the dump into the Postgres container, then:

```bash
pg_restore -U postgres -d <database> --data-only --disable-triggers --no-owner courses-data.dump
```

Do not restore the whole-database dump over a live database. It is the fallback for a disaster, and it would discard everything that happened after the removal.

### 5. Add the entitlement back

```sql
INSERT INTO "PlanEntitlement" ("planVersionId", "featureKey", enabled, unit, "updatedAt")
SELECT 1, 'COURSE_LIBRARY_ACCESS', true, 'CONTENT_ACCESS', now()
WHERE NOT EXISTS (
  SELECT 1 FROM "PlanEntitlement"
  WHERE "planVersionId" = 1 AND "featureKey" = 'COURSE_LIBRARY_ACCESS'
);
```

### 6. Turn courses on

Set `COURSES_ENABLED=true` in the backend `.env` and `NEXT_PUBLIC_COURSES_ENABLED=true` in the frontend `.env`. Run `npx prisma generate`, then restart the API, the worker and the frontend. The owner restarts their own servers.

### 7. Check

- Row counts of the 20 tables match `row-counts.txt`.
- `GET /courses` returns courses 1, 8 and 12.
- `/courses` and `/admin/courses` open in the browser.
- A course cover loads. The URLs in `r2-files.txt` must still answer 200.
- Full backend Jest and e2e, then frontend `npm run ci:check`.

## Limits

- The dump is from 2026-11-01. Attempts after that date never existed, because the tables were gone.
- Code written after the removal does not know about courses. The longer the wait, the more merging step 2 needs.
- Teachers and classrooms stay retired even after a restore. Those tables are historical storage only, as they were before the removal.
- Rehearsed on the harness on 2026-11-01. See "Rehearsal".

## Rehearsal

2026-11-01, fresh harness clone of `kltn_db`, following this file:

```
TABLES_BEFORE=127
TABLES_AFTER_REMOVAL=107
TABLES_AFTER_RESTORE=127
ROW_COUNT_DIFF=_prisma_migrations only (one extra row)
GET_COURSES=12,8,1
BROWSER_COURSES_PAGE=PASS (3 titles shown)
R2_COVER=200
```

`GET /courses` and the pages ran from tag code with both flags on. The rehearsal did not run full Jest on the restored code, and it took the code straight from the tag, so `git revert` on top of later work is NOT_RUN.

The first attempt exposed a wrong column, fixed in step 5: `CONTENT_ACCESS` belongs in `unit`, not `scope`.

In Git Bash, do not export `MSYS_NO_PATHCONV=1` for a whole script. It breaks `cmd //c` and `taskkill //PID`. Set it on the `docker` command only.
