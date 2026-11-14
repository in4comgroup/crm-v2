CREATE TABLE "topic_check_run" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"check_key" text NOT NULL,
	"period_key" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "signal_instance" ADD COLUMN "condition_key" text;--> statement-breakpoint
ALTER TABLE "signal_instance" ADD COLUMN "facts" jsonb;--> statement-breakpoint
ALTER TABLE "signal_instance" ADD COLUMN "checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "signal_instance" ADD COLUMN "cleared_at" timestamp;--> statement-breakpoint
ALTER TABLE "signal_instance" ADD COLUMN "cleared_reason" text;--> statement-breakpoint
ALTER TABLE "topic_check_run" ADD CONSTRAINT "topic_check_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topic_check_run_org_check_idx" ON "topic_check_run" USING btree ("organization_id","check_key","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_check_run_schedule_uq" ON "topic_check_run" USING btree ("organization_id","check_key","period_key") WHERE "topic_check_run"."trigger" = 'schedule' AND "topic_check_run"."status" <> 'failed';--> statement-breakpoint
CREATE UNIQUE INDEX "signal_instance_condition_uq" ON "signal_instance" USING btree ("organization_id","code","condition_key") WHERE "signal_instance"."condition_key" is not null;