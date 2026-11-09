CREATE TYPE "public"."check_outcome" AS ENUM('DONE', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."step_phase" AS ENUM('SOLUTION', 'CHECK');--> statement-breakpoint
ALTER TYPE "public"."tutor_mode" ADD VALUE 'CHECKING';--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "check" "check_outcome";--> statement-breakpoint
ALTER TABLE "mistakes" ADD COLUMN "phase" "step_phase" DEFAULT 'SOLUTION' NOT NULL;--> statement-breakpoint
ALTER TABLE "steps" ADD COLUMN "phase" "step_phase" DEFAULT 'SOLUTION' NOT NULL;