CREATE TABLE "org_setting" (
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_setting_organization_id_key_pk" PRIMARY KEY("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "org_setting_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"changed_by_user_id" text,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics_eval_result" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"golden_item_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"output" jsonb,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics_golden_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_item_id" text,
	"synthetic" boolean DEFAULT false NOT NULL,
	"text" text,
	"note" text,
	"expected" jsonb,
	"pre_annotation" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics_run" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"trigger" "pipeline_run_trigger" NOT NULL,
	"status" "pipeline_run_status" DEFAULT 'running' NOT NULL,
	"orgs_processed" integer DEFAULT 0 NOT NULL,
	"orgs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors_json" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_setting" ADD CONSTRAINT "org_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_setting" ADD CONSTRAINT "org_setting_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_setting_log" ADD CONSTRAINT "org_setting_log_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics_eval_result" ADD CONSTRAINT "topics_eval_result_golden_item_id_topics_golden_item_id_fk" FOREIGN KEY ("golden_item_id") REFERENCES "public"."topics_golden_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics_golden_item" ADD CONSTRAINT "topics_golden_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics_golden_item" ADD CONSTRAINT "topics_golden_item_source_item_id_source_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics_golden_item" ADD CONSTRAINT "topics_golden_item_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_setting_log_org_key_idx" ON "org_setting_log" USING btree ("organization_id","key","changed_at");--> statement-breakpoint
CREATE INDEX "topics_eval_result_run_idx" ON "topics_eval_result" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "topics_golden_item_org_idx" ON "topics_golden_item" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_golden_item_source_uidx" ON "topics_golden_item" USING btree ("organization_id","source_item_id") WHERE "topics_golden_item"."source_item_id" is not null;--> statement-breakpoint
CREATE INDEX "topics_run_started_idx" ON "topics_run" USING btree ("started_at");