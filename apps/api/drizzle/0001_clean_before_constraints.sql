-- Data cleanup before the constraints of the next migration.
-- 1. References to mistakes that no longer exist would block the new foreign keys.
UPDATE "attempts" SET "active_mistake_id" = NULL
WHERE "active_mistake_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "mistakes" m WHERE m."id" = "attempts"."active_mistake_id");--> statement-breakpoint
UPDATE "attempts" SET "source_mistake_id" = NULL
WHERE "source_mistake_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "mistakes" m WHERE m."id" = "attempts"."source_mistake_id");--> statement-breakpoint
-- 2. At most one open attempt per student and curriculum problem: the most recently updated one
--    stays open, older duplicates are marked abandoned (their steps and messages are kept).
UPDATE "attempts" a SET "status" = 'ABANDONED'
WHERE a."status" = 'IN_PROGRESS'
  AND a."problem_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "attempts" b
    WHERE b."user_id" = a."user_id"
      AND b."problem_id" = a."problem_id"
      AND b."status" = 'IN_PROGRESS'
      AND (b."updated_at" > a."updated_at" OR (b."updated_at" = a."updated_at" AND b."id" > a."id"))
  );
