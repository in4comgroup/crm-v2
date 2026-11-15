CREATE TABLE "funnel_template" (
	"code" text PRIMARY KEY NOT NULL,
	"label_ru" text NOT NULL,
	"description" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"config" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "expert_probability" integer;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "expert_probability_by_user_id" text;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "expert_probability_at" timestamp;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "brief_budget" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "outcome_reason_code" text;--> statement-breakpoint
ALTER TABLE "deal_funnel_stage" ADD COLUMN "role" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_funnel_stage" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "deal_funnel_stage" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "deal_funnel_stage" ADD COLUMN "entry_condition" text;--> statement-breakpoint
ALTER TABLE "deal_funnel_stage" ADD COLUMN "signals_hint" text;--> statement-breakpoint
ALTER TABLE "deal_funnel_stage" ADD COLUMN "in_forecast" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_funnel_stage" ADD COLUMN "probability_mode" text DEFAULT 'stage' NOT NULL;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_expert_probability_by_user_id_user_id_fk" FOREIGN KEY ("expert_probability_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Hand-added (docs/specs/funnel §3.1): backfill of the new stage columns so
-- every org keeps today's behaviour — pre-pipeline = area0 (out of forecast),
-- «Closed» = won, «Rejected» = lost (by NAME, the old rule, once), every
-- other stage active / in forecast / stage probability; codes s1… by sort
-- order per funnel (system rows = one funnel, each org = one funnel).
UPDATE "deal_funnel_stage" SET "role" = 'area0', "in_forecast" = false WHERE "is_pre_pipeline" = true;--> statement-breakpoint
UPDATE "deal_funnel_stage" SET "role" = 'won', "in_forecast" = false WHERE "is_pre_pipeline" = false AND lower(trim("name")) = 'closed';--> statement-breakpoint
UPDATE "deal_funnel_stage" SET "role" = 'lost', "in_forecast" = false WHERE "is_pre_pipeline" = false AND lower(trim("name")) = 'rejected';--> statement-breakpoint
UPDATE "deal_funnel_stage" s SET "code" = x.code
FROM (
  SELECT "id",
    CASE "role"
      WHEN 'active' THEN 's' || row_number() OVER (PARTITION BY coalesce("owner_organization_id", '__system__'), ("role" = 'active') ORDER BY "sort_order", "id")
      ELSE "role"
    END AS code
  FROM "deal_funnel_stage"
) x
WHERE s."id" = x."id" AND s."code" IS NULL;--> statement-breakpoint
-- One code per funnel (system rows share the '__system__' funnel).
CREATE UNIQUE INDEX IF NOT EXISTS "deal_funnel_stage_funnel_code_uq" ON "deal_funnel_stage" (coalesce("owner_organization_id", '__system__'), "code") WHERE "code" IS NOT NULL;
