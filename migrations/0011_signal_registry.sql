CREATE TABLE "deal_risk_stage_guard" (
	"organization_id" text NOT NULL,
	"risk_code" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"stage_ids" text[],
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deal_risk_stage_guard_organization_id_risk_code_pk" PRIMARY KEY("organization_id","risk_code")
);
--> statement-breakpoint
CREATE TABLE "deal_risk_type" (
	"code" text PRIMARY KEY NOT NULL,
	"pack_code" text NOT NULL,
	"label_ru" text NOT NULL,
	"description_ru" text DEFAULT '' NOT NULL,
	"explanation_ru" text DEFAULT '' NOT NULL,
	"trigger_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"clear_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"severity" integer NOT NULL,
	"min_occurrences" integer DEFAULT 1 NOT NULL,
	"condition" text,
	"scope" text DEFAULT 'deal' NOT NULL,
	"reaction_role" text,
	"stage_guard_template" text,
	"note_ru" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_signal_override" (
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"stage" text,
	"weight" integer,
	"display_profile" text,
	"recipient_role" text,
	"review_only" boolean DEFAULT false NOT NULL,
	"note_ru" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_signal_override_organization_id_code_pk" PRIMARY KEY("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "organization_signal_pack" (
	"organization_id" text NOT NULL,
	"pack_code" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_signal_pack_organization_id_pack_code_pk" PRIMARY KEY("organization_id","pack_code")
);
--> statement-breakpoint
CREATE TABLE "signal_attribute" (
	"code" text PRIMARY KEY NOT NULL,
	"pack_code" text NOT NULL,
	"group_code" text,
	"scope" text DEFAULT 'message' NOT NULL,
	"label_ru" text NOT NULL,
	"definition_ru" text DEFAULT '' NOT NULL,
	"weight" integer NOT NULL,
	"stage" text DEFAULT 'active' NOT NULL,
	"default_off" boolean DEFAULT false NOT NULL,
	"profiles" text[] DEFAULT '{}'::text[] NOT NULL,
	"cues_ru" text[] DEFAULT '{}'::text[] NOT NULL,
	"anti_cues_ru" text[] DEFAULT '{}'::text[] NOT NULL,
	"note_ru" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_block" (
	"code" text PRIMARY KEY NOT NULL,
	"pack_code" text NOT NULL,
	"label_ru" text NOT NULL,
	"audience" text,
	"internal_only" boolean DEFAULT false NOT NULL,
	"first_party_only" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_category" (
	"code" text PRIMARY KEY NOT NULL,
	"pack_code" text NOT NULL,
	"block_code" text NOT NULL,
	"family" text NOT NULL,
	"label_ru" text NOT NULL,
	"definition_ru" text DEFAULT '' NOT NULL,
	"boundary_ru" text DEFAULT '' NOT NULL,
	"cues_prompt_ru" text[] DEFAULT '{}'::text[] NOT NULL,
	"synonyms_ru" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"anti_cues_ru" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"example_ru" text DEFAULT '' NOT NULL,
	"counter_example_ru" text DEFAULT '' NOT NULL,
	"card_note_ru" text DEFAULT '' NOT NULL,
	"weight" integer NOT NULL,
	"score_rule" text NOT NULL,
	"class" text,
	"class_by_relation" boolean DEFAULT false NOT NULL,
	"kind" text NOT NULL,
	"effort" text,
	"carries_amount" boolean DEFAULT false NOT NULL,
	"asks_us" boolean DEFAULT false NOT NULL,
	"inbound_only" boolean DEFAULT false NOT NULL,
	"emitted_by" text DEFAULT 'parser' NOT NULL,
	"stage" text DEFAULT 'active' NOT NULL,
	"display_profile" text,
	"recipient_role" text,
	"closes_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"date_gate" jsonb,
	"relevance_days" integer,
	"trigger_rule" jsonb,
	"note_ru" text,
	"retired_at" timestamp,
	"successor_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "signal_pack" (
	"code" text PRIMARY KEY NOT NULL,
	"label_ru" text NOT NULL,
	"description_ru" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_pack_override" (
	"pack_code" text NOT NULL,
	"code" text NOT NULL,
	"weight" integer,
	"display_profile" text,
	"recipient_role" text,
	"stage" text,
	"closes_codes" text[],
	"note_ru" text,
	CONSTRAINT "signal_pack_override_pack_code_code_pk" PRIMARY KEY("pack_code","code")
);
--> statement-breakpoint
CREATE TABLE "signal_registry_change" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"entity" text NOT NULL,
	"entity_key" text NOT NULL,
	"organization_id" text,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changed_by_user_id" text,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_relation" (
	"id" text PRIMARY KEY NOT NULL,
	"pack_code" text NOT NULL,
	"kind" text NOT NULL,
	"code_a" text NOT NULL,
	"code_b" text NOT NULL,
	"setting_key" text,
	"fact" text,
	"note_ru" text
);
--> statement-breakpoint
CREATE TABLE "signal_stage_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"pack_code" text,
	"code" text NOT NULL,
	"effect" text NOT NULL,
	"target_stage_id" text,
	"target_stage_meaning" text,
	"deal_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"guards" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"note_ru" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_taxonomy_version" (
	"version" integer PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"summary" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_risk_stage_guard" ADD CONSTRAINT "deal_risk_stage_guard_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_risk_stage_guard" ADD CONSTRAINT "deal_risk_stage_guard_risk_code_deal_risk_type_code_fk" FOREIGN KEY ("risk_code") REFERENCES "public"."deal_risk_type"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_risk_type" ADD CONSTRAINT "deal_risk_type_pack_code_signal_pack_code_fk" FOREIGN KEY ("pack_code") REFERENCES "public"."signal_pack"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_signal_override" ADD CONSTRAINT "organization_signal_override_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_signal_override" ADD CONSTRAINT "organization_signal_override_code_signal_category_code_fk" FOREIGN KEY ("code") REFERENCES "public"."signal_category"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_signal_pack" ADD CONSTRAINT "organization_signal_pack_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_signal_pack" ADD CONSTRAINT "organization_signal_pack_pack_code_signal_pack_code_fk" FOREIGN KEY ("pack_code") REFERENCES "public"."signal_pack"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_attribute" ADD CONSTRAINT "signal_attribute_pack_code_signal_pack_code_fk" FOREIGN KEY ("pack_code") REFERENCES "public"."signal_pack"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_block" ADD CONSTRAINT "signal_block_pack_code_signal_pack_code_fk" FOREIGN KEY ("pack_code") REFERENCES "public"."signal_pack"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_category" ADD CONSTRAINT "signal_category_pack_code_signal_pack_code_fk" FOREIGN KEY ("pack_code") REFERENCES "public"."signal_pack"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_category" ADD CONSTRAINT "signal_category_block_code_signal_block_code_fk" FOREIGN KEY ("block_code") REFERENCES "public"."signal_block"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_category" ADD CONSTRAINT "signal_category_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_pack_override" ADD CONSTRAINT "signal_pack_override_pack_code_signal_pack_code_fk" FOREIGN KEY ("pack_code") REFERENCES "public"."signal_pack"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_pack_override" ADD CONSTRAINT "signal_pack_override_code_signal_category_code_fk" FOREIGN KEY ("code") REFERENCES "public"."signal_category"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_registry_change" ADD CONSTRAINT "signal_registry_change_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_relation" ADD CONSTRAINT "signal_relation_pack_code_signal_pack_code_fk" FOREIGN KEY ("pack_code") REFERENCES "public"."signal_pack"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_stage_rule" ADD CONSTRAINT "signal_stage_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_stage_rule" ADD CONSTRAINT "signal_stage_rule_pack_code_signal_pack_code_fk" FOREIGN KEY ("pack_code") REFERENCES "public"."signal_pack"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_stage_rule" ADD CONSTRAINT "signal_stage_rule_code_signal_category_code_fk" FOREIGN KEY ("code") REFERENCES "public"."signal_category"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_stage_rule" ADD CONSTRAINT "signal_stage_rule_target_stage_id_deal_funnel_stage_id_fk" FOREIGN KEY ("target_stage_id") REFERENCES "public"."deal_funnel_stage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_taxonomy_version" ADD CONSTRAINT "signal_taxonomy_version_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_category_pack_block_idx" ON "signal_category" USING btree ("pack_code","block_code");--> statement-breakpoint
CREATE INDEX "signal_registry_change_version_idx" ON "signal_registry_change" USING btree ("version");--> statement-breakpoint
CREATE INDEX "signal_registry_change_entity_idx" ON "signal_registry_change" USING btree ("entity","entity_key");--> statement-breakpoint
CREATE INDEX "signal_relation_codes_idx" ON "signal_relation" USING btree ("code_a","code_b");--> statement-breakpoint
CREATE INDEX "signal_stage_rule_org_code_idx" ON "signal_stage_rule" USING btree ("organization_id","code");