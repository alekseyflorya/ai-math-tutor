ALTER TABLE "attempts" ADD CONSTRAINT "attempts_active_mistake_id_mistakes_id_fk" FOREIGN KEY ("active_mistake_id") REFERENCES "public"."mistakes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_source_mistake_id_mistakes_id_fk" FOREIGN KEY ("source_mistake_id") REFERENCES "public"."mistakes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempts_parent_idx" ON "attempts" USING btree ("parent_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_one_open_per_problem_idx" ON "attempts" USING btree ("user_id","problem_id") WHERE "attempts"."status" = 'IN_PROGRESS';--> statement-breakpoint
CREATE INDEX "mistakes_attempt_idx" ON "mistakes" USING btree ("attempt_id");