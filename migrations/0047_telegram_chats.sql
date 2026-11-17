CREATE TABLE "telegram_chat" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_id" text NOT NULL,
	"chat_id" text,
	"type" text DEFAULT 'unknown' NOT NULL,
	"title" text,
	"username" text,
	"bot_status" text,
	"migrated_from_chat_id" text,
	"mode" text DEFAULT 'auto' NOT NULL,
	"first_seen_at" timestamp,
	"last_message_at" timestamp,
	"bound_by_user_id" text,
	"bound_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_chat_client" (
	"chat_row_id" text NOT NULL,
	"client_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_chat_client_chat_row_id_client_id_pk" PRIMARY KEY("chat_row_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "telegram_chat_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"chat_row_id" text NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_chat_suggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"chat_row_id" text NOT NULL,
	"client_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_contact_proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"chat_row_id" text,
	"client_id" text NOT NULL,
	"tg_user_id" text NOT NULL,
	"username" text,
	"name" text,
	"message_count" integer DEFAULT 1 NOT NULL,
	"first_item_id" text,
	"last_message_at" timestamp,
	"status" text DEFAULT 'open' NOT NULL,
	"contact_id" text,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_chat" ADD CONSTRAINT "telegram_chat_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat" ADD CONSTRAINT "telegram_chat_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat" ADD CONSTRAINT "telegram_chat_bound_by_user_id_user_id_fk" FOREIGN KEY ("bound_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_client" ADD CONSTRAINT "telegram_chat_client_chat_row_id_telegram_chat_id_fk" FOREIGN KEY ("chat_row_id") REFERENCES "public"."telegram_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_client" ADD CONSTRAINT "telegram_chat_client_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_log" ADD CONSTRAINT "telegram_chat_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_log" ADD CONSTRAINT "telegram_chat_log_chat_row_id_telegram_chat_id_fk" FOREIGN KEY ("chat_row_id") REFERENCES "public"."telegram_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_log" ADD CONSTRAINT "telegram_chat_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_suggestion" ADD CONSTRAINT "telegram_chat_suggestion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_suggestion" ADD CONSTRAINT "telegram_chat_suggestion_chat_row_id_telegram_chat_id_fk" FOREIGN KEY ("chat_row_id") REFERENCES "public"."telegram_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_suggestion" ADD CONSTRAINT "telegram_chat_suggestion_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chat_suggestion" ADD CONSTRAINT "telegram_chat_suggestion_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_contact_proposal" ADD CONSTRAINT "telegram_contact_proposal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_contact_proposal" ADD CONSTRAINT "telegram_contact_proposal_chat_row_id_telegram_chat_id_fk" FOREIGN KEY ("chat_row_id") REFERENCES "public"."telegram_chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_contact_proposal" ADD CONSTRAINT "telegram_contact_proposal_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_contact_proposal" ADD CONSTRAINT "telegram_contact_proposal_first_item_id_source_item_id_fk" FOREIGN KEY ("first_item_id") REFERENCES "public"."source_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_contact_proposal" ADD CONSTRAINT "telegram_contact_proposal_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_contact_proposal" ADD CONSTRAINT "telegram_contact_proposal_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_chat_source_chat_uq" ON "telegram_chat" USING btree ("source_id","chat_id") WHERE "telegram_chat"."chat_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_chat_source_username_uq" ON "telegram_chat" USING btree ("source_id","username") WHERE "telegram_chat"."username" is not null;--> statement-breakpoint
CREATE INDEX "telegram_chat_org_idx" ON "telegram_chat" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "telegram_chat_client_client_idx" ON "telegram_chat_client" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "telegram_chat_log_chat_idx" ON "telegram_chat_log" USING btree ("chat_row_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_chat_suggestion_pair_uq" ON "telegram_chat_suggestion" USING btree ("chat_row_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_contact_proposal_uq" ON "telegram_contact_proposal" USING btree ("organization_id","client_id","tg_user_id");--> statement-breakpoint
-- Edited by hand (data): the groups the bot already knows (`provider_config.telegramGroups`,
-- written by `my_chat_member` since 2026-11-15) become `telegram_chat` rows (mode auto).
-- The old key stays in provider_config (no longer written). Safe to re-run.
INSERT INTO "telegram_chat" ("id", "organization_id", "source_id", "chat_id", "type", "title", "bot_status", "first_seen_at")
SELECT gen_random_uuid()::text, s."owner_organization_id", s."id", g.key,
  CASE WHEN g.key LIKE '-100%' THEN 'supergroup' ELSE 'group' END,
  g.value->>'title', g.value->>'status', NULLIF(g.value->>'at', '')::timestamp
FROM "source" s, jsonb_each(COALESCE(s."provider_config"->'telegramGroups', '{}'::jsonb)) g
WHERE s."provider" = 'telegram' AND s."owner_organization_id" IS NOT NULL
ON CONFLICT DO NOTHING;
