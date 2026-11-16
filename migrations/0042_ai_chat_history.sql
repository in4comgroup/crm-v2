CREATE TABLE "ai_chat_message" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"feedback" text,
	"feedback_comment" text,
	"feedback_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ai_chat_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"ingest_mode" text DEFAULT 'on' NOT NULL,
	"ingested_seq" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ai_chat_message" ADD CONSTRAINT "ai_chat_message_thread_id_ai_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."ai_chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_thread" ADD CONSTRAINT "ai_chat_thread_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_thread" ADD CONSTRAINT "ai_chat_thread_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_chat_message_thread_seq_uq" ON "ai_chat_message" USING btree ("thread_id","seq");--> statement-breakpoint
CREATE INDEX "ai_chat_thread_user_list_idx" ON "ai_chat_thread" USING btree ("organization_id","user_id","last_message_at") WHERE "ai_chat_thread"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "ai_chat_thread_last_message_idx" ON "ai_chat_thread" USING btree ("last_message_at");