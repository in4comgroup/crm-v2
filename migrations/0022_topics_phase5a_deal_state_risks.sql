CREATE TABLE "deal_risk" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"deal_id" text NOT NULL,
	"risk_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"severity" integer NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"topic_id" text,
	"trigger_instance_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_item_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"explanation_ru" text,
	"explanation_source_item_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"cleared_at" timestamp,
	"cleared_by" text,
	"cleared_reason" text,
	"cleared_by_user_id" text,
	"clear_instance_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_state_version" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"deal_id" text NOT NULL,
	"decision" text NOT NULL,
	"text" text,
	"reason" text,
	"source_item_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"topic_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"actor" text DEFAULT 'agent' NOT NULL,
	"actor_user_id" text,
	"model" text,
	"ai_usage_event_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "state_text" text;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "state_source_item_ids" text[];--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "state_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "state_dirty_at" timestamp;--> statement-breakpoint
ALTER TABLE "deal_risk" ADD CONSTRAINT "deal_risk_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_risk" ADD CONSTRAINT "deal_risk_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_risk" ADD CONSTRAINT "deal_risk_risk_type_deal_risk_type_code_fk" FOREIGN KEY ("risk_type") REFERENCES "public"."deal_risk_type"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_risk" ADD CONSTRAINT "deal_risk_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_risk" ADD CONSTRAINT "deal_risk_cleared_by_user_id_user_id_fk" FOREIGN KEY ("cleared_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_state_version" ADD CONSTRAINT "deal_state_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_state_version" ADD CONSTRAINT "deal_state_version_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_state_version" ADD CONSTRAINT "deal_state_version_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_risk_deal_idx" ON "deal_risk" USING btree ("deal_id","status");--> statement-breakpoint
CREATE INDEX "deal_risk_org_status_idx" ON "deal_risk" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_risk_active_uq" ON "deal_risk" USING btree ("deal_id","risk_type") WHERE "deal_risk"."status" = 'active';--> statement-breakpoint
CREATE INDEX "deal_state_version_deal_idx" ON "deal_state_version" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "deal_org_state_dirty_idx" ON "deal" USING btree ("organization_id","state_dirty_at");