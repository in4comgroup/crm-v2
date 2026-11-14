CREATE TABLE "topic" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text,
	"contact_id" text,
	"counterparty_raw" text DEFAULT '' NOT NULL,
	"deal_id" text,
	"title" text NOT NULL,
	"matter" text DEFAULT '' NOT NULL,
	"family" text,
	"status" text DEFAULT 'open' NOT NULL,
	"sub_state" text DEFAULT 'none' NOT NULL,
	"lead_code" text,
	"class" text,
	"score" integer DEFAULT 0 NOT NULL,
	"band" text DEFAULT 'none' NOT NULL,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"products" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_seen_at" timestamp NOT NULL,
	"last_activity_at" timestamp NOT NULL,
	"closed_at" timestamp,
	"closed_reason" text,
	"related_topic_id" text,
	"merged_into_topic_id" text,
	"snoozed_until" timestamp,
	"taxonomy_version" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"type" text NOT NULL,
	"actor" text DEFAULT 'agent' NOT NULL,
	"user_id" text,
	"source_item_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"source_item_id" text NOT NULL,
	"subject_index" integer DEFAULT -1 NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "topic_status" text;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "topic_reason" text;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "topic_scanned_at" timestamp;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "topic_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_related_topic_id_topic_id_fk" FOREIGN KEY ("related_topic_id") REFERENCES "public"."topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_merged_into_topic_id_topic_id_fk" FOREIGN KEY ("merged_into_topic_id") REFERENCES "public"."topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_event" ADD CONSTRAINT "topic_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_event" ADD CONSTRAINT "topic_event_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_event" ADD CONSTRAINT "topic_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_event" ADD CONSTRAINT "topic_event_source_item_id_source_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_item" ADD CONSTRAINT "topic_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_item" ADD CONSTRAINT "topic_item_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_item" ADD CONSTRAINT "topic_item_source_item_id_source_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topic_org_status_idx" ON "topic" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "topic_org_client_idx" ON "topic" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE INDEX "topic_org_contact_idx" ON "topic" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "topic_org_last_activity_idx" ON "topic" USING btree ("organization_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "topic_event_topic_idx" ON "topic_event" USING btree ("topic_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_item_topic_item_subject_uidx" ON "topic_item" USING btree ("topic_id","source_item_id","subject_index");--> statement-breakpoint
CREATE INDEX "topic_item_topic_idx" ON "topic_item" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "topic_item_source_item_idx" ON "topic_item" USING btree ("source_item_id");--> statement-breakpoint
ALTER TABLE "signal_instance" ADD CONSTRAINT "signal_instance_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_item_org_topic_scanned_idx" ON "source_item" USING btree ("organization_id","topic_scanned_at");