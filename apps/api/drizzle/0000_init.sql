CREATE TYPE "public"."attempt_status" AS ENUM('IN_PROGRESS', 'SOLVED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "public"."error_type" AS ENUM('DISTRIBUTION', 'SIGN_TRANSFER', 'COMBINING_LIKE_TERMS', 'INVERSE_OPERATION', 'ONE_SIDE_ONLY', 'ARITHMETIC', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('STEP', 'CHAT', 'GREETING', 'FEEDBACK', 'HINT', 'EXPLANATION', 'CELEBRATION', 'FOLLOW_UP', 'NOTICE');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('STUDENT', 'TUTOR', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."tutor_mode" AS ENUM('SOLVING', 'REMEDIATION');--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"problem_id" text,
	"title" text NOT NULL,
	"equation" text NOT NULL,
	"variable" text DEFAULT 'x' NOT NULL,
	"status" "attempt_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"mode" "tutor_mode" DEFAULT 'SOLVING' NOT NULL,
	"hint_level" integer DEFAULT 0 NOT NULL,
	"current_line" text NOT NULL,
	"active_mistake_id" uuid,
	"parent_attempt_id" uuid,
	"target_error_type" "error_type",
	"source_mistake_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"solved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"ok" boolean NOT NULL,
	"latency_ms" integer NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"seq" serial NOT NULL,
	"role" "message_role" NOT NULL,
	"kind" "message_kind" NOT NULL,
	"content" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mistakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"error_type" "error_type" NOT NULL,
	"description" text NOT NULL,
	"previous_line" text NOT NULL,
	"step_input" text NOT NULL,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"corrected" boolean DEFAULT false NOT NULL,
	"corrected_at" timestamp with time zone,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"title_uk" text NOT NULL,
	"equation" text NOT NULL,
	"difficulty" integer NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"order" integer NOT NULL,
	"featured" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_stats" (
	"user_id" uuid NOT NULL,
	"skill" text NOT NULL,
	"mastery" real DEFAULT 0.5 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_stats_user_id_skill_pk" PRIMARY KEY("user_id","skill")
);
--> statement-breakpoint
CREATE TABLE "steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"input" text NOT NULL,
	"latex" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"password_hash" text,
	"name" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_parent_attempt_id_attempts_id_fk" FOREIGN KEY ("parent_attempt_id") REFERENCES "public"."attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_stats" ADD CONSTRAINT "skill_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steps" ADD CONSTRAINT "steps_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempts_user_updated_idx" ON "attempts" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "llm_calls_created_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_user_created_idx" ON "llm_calls" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_attempt_idx" ON "messages" USING btree ("attempt_id","seq");--> statement-breakpoint
CREATE INDEX "mistakes_user_created_idx" ON "mistakes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "steps_attempt_idx" ON "steps" USING btree ("attempt_id","index");