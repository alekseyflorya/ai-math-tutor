ALTER TABLE "attempts" ADD COLUMN "busy_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "busy_token" uuid;