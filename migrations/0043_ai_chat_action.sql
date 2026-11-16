CREATE TABLE "ai_chat_action" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text,
	"message_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"draft" jsonb NOT NULL,
	"confirmed_values" jsonb,
	"results" jsonb,
	"source_item_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ai_chat_action" ADD CONSTRAINT "ai_chat_action_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_action" ADD CONSTRAINT "ai_chat_action_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_action" ADD CONSTRAINT "ai_chat_action_thread_id_ai_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."ai_chat_thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_chat_action_user_idx" ON "ai_chat_action" USING btree ("organization_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_chat_action_thread_idx" ON "ai_chat_action" USING btree ("thread_id");