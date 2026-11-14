CREATE TABLE "analysis_exclusion" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"note" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_instance" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"origin" text DEFAULT 'communication' NOT NULL,
	"source_item_id" text,
	"process_key" text,
	"external_url" text,
	"evidence" text NOT NULL,
	"evidence_found" boolean DEFAULT true NOT NULL,
	"confidence" text NOT NULL,
	"subject_index" integer DEFAULT -1 NOT NULL,
	"counted" boolean DEFAULT false NOT NULL,
	"not_counted_reason" text,
	"score_contrib" integer DEFAULT 0 NOT NULL,
	"topic_id" text,
	"taxonomy_version" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_item_subject" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_item_id" text NOT NULL,
	"subject_index" integer NOT NULL,
	"counterparty" text DEFAULT '' NOT NULL,
	"on_behalf_of" text DEFAULT '' NOT NULL,
	"matter" text DEFAULT '' NOT NULL,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"products" text[] DEFAULT '{}'::text[] NOT NULL,
	"client_id" text,
	"contact_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics_eval_run" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text DEFAULT 'eval' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics" jsonb,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "thread_key" text;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "signal_status" text;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "signal_reason" text;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "signal_score" integer;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "signal_band" text;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "signal_facts" jsonb;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "signal_scanned_at" timestamp;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "signal_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "signal_taxonomy_version" integer;--> statement-breakpoint
ALTER TABLE "analysis_exclusion" ADD CONSTRAINT "analysis_exclusion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_exclusion" ADD CONSTRAINT "analysis_exclusion_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_instance" ADD CONSTRAINT "signal_instance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_instance" ADD CONSTRAINT "signal_instance_source_item_id_source_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_subject" ADD CONSTRAINT "source_item_subject_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_subject" ADD CONSTRAINT "source_item_subject_source_item_id_source_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_subject" ADD CONSTRAINT "source_item_subject_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_subject" ADD CONSTRAINT "source_item_subject_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics_eval_run" ADD CONSTRAINT "topics_eval_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics_eval_run" ADD CONSTRAINT "topics_eval_run_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_exclusion_org_kind_value_uidx" ON "analysis_exclusion" USING btree ("organization_id","kind","normalized_value");--> statement-breakpoint
CREATE INDEX "signal_instance_item_idx" ON "signal_instance" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "signal_instance_org_code_idx" ON "signal_instance" USING btree ("organization_id","code","created_at");--> statement-breakpoint
CREATE INDEX "signal_instance_topic_idx" ON "signal_instance" USING btree ("topic_id") WHERE "signal_instance"."topic_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "source_item_subject_item_idx_uidx" ON "source_item_subject" USING btree ("source_item_id","subject_index");--> statement-breakpoint
CREATE INDEX "source_item_subject_org_idx" ON "source_item_subject" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "topics_eval_run_org_idx" ON "topics_eval_run" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "source_item_org_signal_scanned_idx" ON "source_item" USING btree ("organization_id","signal_scanned_at");--> statement-breakpoint
CREATE INDEX "source_item_org_thread_key_idx" ON "source_item" USING btree ("organization_id","thread_key") WHERE "source_item"."thread_key" is not null;