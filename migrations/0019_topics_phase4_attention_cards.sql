CREATE TABLE "work_calendar_day" (
	"region" text DEFAULT 'RU' NOT NULL,
	"day" date NOT NULL,
	"is_working" boolean NOT NULL,
	"is_short" boolean DEFAULT false NOT NULL,
	"note" text,
	CONSTRAINT "work_calendar_day_region_day_pk" PRIMARY KEY("region","day")
);
--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "topic_id" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "score" integer;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "band" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "display_profile" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "signal_class" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "lead_code" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "since_last" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "taxonomy_version" integer;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "events" jsonb;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "reject_reason_code" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "decided_at" timestamp;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "decided_by_user_id" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "deal_id" text;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "proposal" jsonb;--> statement-breakpoint
ALTER TABLE "topic" ADD COLUMN "display_profile" text;--> statement-breakpoint
ALTER TABLE "topic" ADD COLUMN "list" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "topic" ADD COLUMN "attention" jsonb;--> statement-breakpoint
ALTER TABLE "topic" ADD COLUMN "next_attention_check_at" timestamp;--> statement-breakpoint
ALTER TABLE "topic" ADD COLUMN "cycle_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "topic" ADD COLUMN "cycle_reminders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "topic" ADD COLUMN "cycle_reason" text;--> statement-breakpoint
ALTER TABLE "topic" ADD COLUMN "waiting_since" timestamp;--> statement-breakpoint
ALTER TABLE "topic" ADD COLUMN "snoozed_at" timestamp;--> statement-breakpoint
ALTER TABLE "topic" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_topic_idx" ON "card" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "card_org_status_idx" ON "card" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "card_topic_kind_open_uq" ON "card" USING btree ("topic_id","kind") WHERE "card"."status" = 'open' AND "card"."topic_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "topic_org_list_idx" ON "topic" USING btree ("organization_id","list");--> statement-breakpoint
CREATE INDEX "topic_org_next_check_idx" ON "topic" USING btree ("organization_id","next_attention_check_at");