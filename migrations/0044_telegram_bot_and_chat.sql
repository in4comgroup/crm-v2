CREATE TABLE "telegram_bind_code" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_id" text NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tg_user_id" text NOT NULL,
	"tg_username" text,
	"tg_name" text,
	"chat_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ai_chat_thread_id" text,
	"chat_lock_until" timestamp,
	"chat_lock_token" text,
	"bound_at" timestamp DEFAULT now() NOT NULL,
	"unbound_at" timestamp,
	"unbound_reason" text,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_button" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"tg_message_id" integer,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_chat_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"source_id" text NOT NULL,
	"tg_message_id" integer,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"media_group_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"ai_chat_thread_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "telegram_out_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_id" text NOT NULL,
	"binding_id" text,
	"chat_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"tg_message_id" integer,
	"ai_chat_thread_id" text,
	"ai_chat_message_id" text,
	"entity_type" text,
	"entity_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_update_seen" (
	"source_id" text NOT NULL,
	"update_id" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_update_seen_source_id_update_id_pk" PRIMARY KEY("source_id","update_id")
);
--> statement-breakpoint
ALTER TABLE "ai_chat_thread" ADD COLUMN "channel" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_bind_code" ADD CONSTRAINT "telegram_bind_code_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bind_code" ADD CONSTRAINT "telegram_bind_code_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bind_code" ADD CONSTRAINT "telegram_bind_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_binding" ADD CONSTRAINT "telegram_binding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_binding" ADD CONSTRAINT "telegram_binding_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_binding" ADD CONSTRAINT "telegram_binding_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_binding" ADD CONSTRAINT "telegram_binding_ai_chat_thread_id_ai_chat_thread_id_fk" FOREIGN KEY ("ai_chat_thread_id") REFERENCES "public"."ai_chat_thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_button" ADD CONSTRAINT "telegram_button_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_button" ADD CONSTRAINT "telegram_button_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_button" ADD CONSTRAINT "telegram_button_binding_id_telegram_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."telegram_binding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_inbox" ADD CONSTRAINT "telegram_chat_inbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_inbox" ADD CONSTRAINT "telegram_chat_inbox_binding_id_telegram_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."telegram_binding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_inbox" ADD CONSTRAINT "telegram_chat_inbox_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_out_message" ADD CONSTRAINT "telegram_out_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_out_message" ADD CONSTRAINT "telegram_out_message_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_out_message" ADD CONSTRAINT "telegram_out_message_binding_id_telegram_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."telegram_binding"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_out_message" ADD CONSTRAINT "telegram_out_message_ai_chat_thread_id_ai_chat_thread_id_fk" FOREIGN KEY ("ai_chat_thread_id") REFERENCES "public"."ai_chat_thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_update_seen" ADD CONSTRAINT "telegram_update_seen_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_bind_code_hash_uq" ON "telegram_bind_code" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_binding_active_tg_uq" ON "telegram_binding" USING btree ("source_id","tg_user_id") WHERE "telegram_binding"."status" <> 'unbound';--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_binding_active_user_uq" ON "telegram_binding" USING btree ("source_id","user_id") WHERE "telegram_binding"."status" <> 'unbound';--> statement-breakpoint
CREATE INDEX "telegram_binding_org_idx" ON "telegram_binding" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "telegram_button_binding_idx" ON "telegram_button" USING btree ("binding_id","created_at");--> statement-breakpoint
CREATE INDEX "telegram_chat_inbox_binding_idx" ON "telegram_chat_inbox" USING btree ("binding_id","status","created_at");--> statement-breakpoint
CREATE INDEX "telegram_out_message_chat_idx" ON "telegram_out_message" USING btree ("source_id","chat_id","tg_message_id");--> statement-breakpoint
CREATE INDEX "telegram_out_message_created_idx" ON "telegram_out_message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "telegram_update_seen_created_idx" ON "telegram_update_seen" USING btree ("created_at");