CREATE TABLE "ai_process_assignment" (
	"process_key" text PRIMARY KEY NOT NULL,
	"gateway_id" text NOT NULL,
	"primary_model_id" text NOT NULL,
	"fallback_model_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_model_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_process_assignment_log" (
	"id" text PRIMARY KEY NOT NULL,
	"process_key" text NOT NULL,
	"changed_by_user_id" text,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
ALTER TABLE "ai_process_assignment" ADD CONSTRAINT "ai_process_assignment_gateway_id_ai_gateway_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."ai_gateway"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_process_assignment" ADD CONSTRAINT "ai_process_assignment_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_process_assignment_log" ADD CONSTRAINT "ai_process_assignment_log_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_process_assignment_log_process_idx" ON "ai_process_assignment_log" USING btree ("process_key","changed_at");