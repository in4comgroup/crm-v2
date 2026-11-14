ALTER TYPE "public"."deal_status" ADD VALUE 'paused';--> statement-breakpoint
CREATE TABLE "deal_type" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"label_ru" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "deal_type_id" text;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "paused_until" timestamp;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "outcome_reason" text;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "created_by_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_activity" ADD COLUMN "topic_id" text;--> statement-breakpoint
ALTER TABLE "deal_activity" ADD COLUMN "source_item_id" text;--> statement-breakpoint
ALTER TABLE "deal_activity" ADD COLUMN "rule_id" text;--> statement-breakpoint
ALTER TABLE "deal_activity" ADD COLUMN "evidence" text;--> statement-breakpoint
ALTER TABLE "deal_type" ADD CONSTRAINT "deal_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_type_org_code_uq" ON "deal_type" USING btree ("organization_id","code");--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_deal_type_id_deal_type_id_fk" FOREIGN KEY ("deal_type_id") REFERENCES "public"."deal_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_activity" ADD CONSTRAINT "deal_activity_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_activity" ADD CONSTRAINT "deal_activity_source_item_id_source_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_activity" ADD CONSTRAINT "deal_activity_rule_id_signal_stage_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."signal_stage_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_org_client_type_idx" ON "deal" USING btree ("organization_id","client_id","deal_type_id");--> statement-breakpoint
CREATE INDEX "deal_activity_topic_idx" ON "deal_activity" USING btree ("topic_id");