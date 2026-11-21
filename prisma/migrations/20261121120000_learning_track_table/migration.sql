-- Lĩnh vực becomes a table admins manage (owner 2026-11-21, plan
-- note-plan/Ke-hoach-admin-linh-vuc-va-tai-khoan-2026-11-21.md, part 1a).
-- The six enum values become rows with the same codes, so every stored
-- choice and tag keeps its value. Speaking set tags move from the set's
-- first exercise (ContentTrackTag SPEAKING_SET) to the set itself
-- (SpeakingSetTrack). Selective rollback: docs/migrations/learning-track-rollback.sql.

-- 1. Both columns become TEXT, keeping every value.
ALTER TABLE "LearnerProfile" ALTER COLUMN "track" DROP DEFAULT;
ALTER TABLE "LearnerProfile" ALTER COLUMN "track" TYPE TEXT USING "track"::text;
ALTER TABLE "LearnerProfile" ALTER COLUMN "track" SET DEFAULT 'GENERAL';
ALTER TABLE "ContentTrackTag" ALTER COLUMN "track" TYPE TEXT USING "track"::text;

-- 2. The enum goes before the table is created: PostgreSQL gives every table
-- a row type of the same name, which would clash with it.
DROP TYPE "LearningTrack";

-- 3. The table and its six rows. Names and descriptions are the ones the
-- onboarding screen showed; the default track is "Chung" and sorts last.
-- nameNormalized is normalizeTrackName(name) (learning-track.logic.ts);
-- learning-track.migration.spec.ts checks every row.
CREATE TABLE "LearningTrack" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningTrack_pkey" PRIMARY KEY ("code")
);

CREATE UNIQUE INDEX "LearningTrack_nameNormalized_key" ON "LearningTrack"("nameNormalized");

INSERT INTO "LearningTrack" ("code", "name", "nameNormalized", "description", "sortOrder") VALUES
    ('IT_SOFTWARE', 'Công nghệ thông tin', 'cong nghe thong tin', 'Phần mềm, kỹ thuật, sản phẩm số', 10),
    ('OFFICE_BUSINESS', 'Văn phòng – Kinh doanh', 'van phong – kinh doanh', 'Hành chính, kế toán, nhân sự, quản lý', 20),
    ('SALES_CUSTOMER_SERVICE', 'Bán hàng – CSKH', 'ban hang – cskh', 'Tư vấn, chăm sóc và hỗ trợ khách hàng', 30),
    ('HOSPITALITY_TOURISM', 'Nhà hàng – Khách sạn – Du lịch', 'nha hang – khach san – du lich', 'Lễ tân, phục vụ, hướng dẫn viên', 40),
    ('STUDENT_ACADEMIC', 'Sinh viên – Học thuật', 'sinh vien – hoc thuat', 'Học tập, nghiên cứu, thi chứng chỉ', 50),
    ('GENERAL', 'Chung', 'chung', 'Bài luyện đa dạng chủ đề', 1000);

-- 4. Choices and tags point at the table. A track in use cannot be deleted.
CREATE INDEX "LearnerProfile_track_idx" ON "LearnerProfile"("track");

ALTER TABLE "LearnerProfile" ADD CONSTRAINT "LearnerProfile_track_fkey" FOREIGN KEY ("track") REFERENCES "LearningTrack"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContentTrackTag" ADD CONSTRAINT "ContentTrackTag_track_fkey" FOREIGN KEY ("track") REFERENCES "LearningTrack"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Speaking set tags, on the set. Deleting a set deletes its tags.
CREATE TABLE "SpeakingSetTrack" (
    "setId" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeakingSetTrack_pkey" PRIMARY KEY ("setId","track")
);

CREATE INDEX "SpeakingSetTrack_track_idx" ON "SpeakingSetTrack"("track");

ALTER TABLE "SpeakingSetTrack" ADD CONSTRAINT "SpeakingSetTrack_setId_fkey" FOREIGN KEY ("setId") REFERENCES "SpeakingPracticeSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SpeakingSetTrack" ADD CONSTRAINT "SpeakingSetTrack_track_fkey" FOREIGN KEY ("track") REFERENCES "LearningTrack"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. The old speaking set tags, from the tagged exercise to its set.
INSERT INTO "SpeakingSetTrack" ("setId", "track", "createdById", "createdAt")
SELECT e."practiceSetId", t."track", t."createdById", t."createdAt"
FROM "ContentTrackTag" t
JOIN "SpeakingExercise" e ON e.id = t."contentId"
WHERE t."contentType" = 'SPEAKING_SET' AND e."practiceSetId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 7. Stop if a tag found no set: step 9 would delete it with nothing kept.
DO $$
DECLARE
    unmatched INTEGER;
BEGIN
    SELECT COUNT(*) INTO unmatched
    FROM "ContentTrackTag" t
    LEFT JOIN "SpeakingExercise" e ON e.id = t."contentId"
    WHERE t."contentType" = 'SPEAKING_SET' AND e."practiceSetId" IS NULL;
    IF unmatched > 0 THEN
        RAISE EXCEPTION 'learning_track_table: % SPEAKING_SET tag(s) point at no exercise in a speaking set; nothing was changed', unmatched;
    END IF;
END $$;

-- 8. Skill practice sets still without a tag take one from their old
-- speaking category (Phân loại, folded into Lĩnh vực). Existing tags win.
INSERT INTO "SpeakingSetTrack" ("setId", "track")
SELECT s.id,
       CASE c.code
           WHEN 'BUSINESS' THEN 'OFFICE_BUSINESS'
           WHEN 'ACADEMIC' THEN 'STUDENT_ACADEMIC'
           ELSE 'GENERAL'
       END
FROM "SpeakingPracticeSet" s
JOIN "SpeakingCategory" c ON c.id = s."categoryId"
WHERE s.scope = 'SKILL_PRACTICE'
  AND NOT EXISTS (SELECT 1 FROM "SpeakingSetTrack" st WHERE st."setId" = s.id);

-- 9. ContentTrackTag now holds quiz tags only.
DELETE FROM "ContentTrackTag" WHERE "contentType" = 'SPEAKING_SET';
