CREATE TABLE "contact_address" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"client_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"first_seen_at" timestamp,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_company_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"client_id" text NOT NULL,
	"relation" text DEFAULT 'employee' NOT NULL,
	"status" text DEFAULT 'current' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"position" text,
	"started_at" timestamp,
	"ended_at" timestamp,
	"source" text DEFAULT 'manual' NOT NULL,
	"evidence_source_item_id" text,
	"end_reason" text,
	"created_by_user_id" text,
	"ended_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_link_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_link_proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"candidate_contact_id" text,
	"from_client_id" text,
	"to_client_id" text,
	"new_address_kind" text,
	"new_address" text,
	"to_company_name" text,
	"kind" text NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"rule" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_at" timestamp,
	"pair_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision" text,
	"snoozed_until" timestamp,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "merged_into_contact_id" text;--> statement-breakpoint
ALTER TABLE "contact_address" ADD CONSTRAINT "contact_address_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_address" ADD CONSTRAINT "contact_address_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_address" ADD CONSTRAINT "contact_address_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_link" ADD CONSTRAINT "contact_company_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_link" ADD CONSTRAINT "contact_company_link_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_link" ADD CONSTRAINT "contact_company_link_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_link" ADD CONSTRAINT "contact_company_link_evidence_source_item_id_source_item_id_fk" FOREIGN KEY ("evidence_source_item_id") REFERENCES "public"."source_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_link" ADD CONSTRAINT "contact_company_link_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_link" ADD CONSTRAINT "contact_company_link_ended_by_user_id_user_id_fk" FOREIGN KEY ("ended_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link_event" ADD CONSTRAINT "contact_link_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link_event" ADD CONSTRAINT "contact_link_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link_event" ADD CONSTRAINT "contact_link_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link_proposal" ADD CONSTRAINT "contact_link_proposal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link_proposal" ADD CONSTRAINT "contact_link_proposal_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link_proposal" ADD CONSTRAINT "contact_link_proposal_candidate_contact_id_contact_id_fk" FOREIGN KEY ("candidate_contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link_proposal" ADD CONSTRAINT "contact_link_proposal_from_client_id_client_id_fk" FOREIGN KEY ("from_client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link_proposal" ADD CONSTRAINT "contact_link_proposal_to_client_id_client_id_fk" FOREIGN KEY ("to_client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_link_proposal" ADD CONSTRAINT "contact_link_proposal_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_address_contact_value_uq" ON "contact_address" USING btree ("contact_id","kind","value");--> statement-breakpoint
CREATE INDEX "contact_address_org_value_idx" ON "contact_address" USING btree ("organization_id","kind","value");--> statement-breakpoint
CREATE INDEX "contact_company_link_contact_idx" ON "contact_company_link" USING btree ("contact_id","status");--> statement-breakpoint
CREATE INDEX "contact_company_link_client_idx" ON "contact_company_link" USING btree ("organization_id","client_id","status");--> statement-breakpoint
CREATE INDEX "contact_link_event_contact_idx" ON "contact_link_event" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_link_proposal_contact_idx" ON "contact_link_proposal" USING btree ("contact_id","status");--> statement-breakpoint
CREATE INDEX "contact_link_proposal_org_idx" ON "contact_link_proposal" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_link_proposal_pair_uq" ON "contact_link_proposal" USING btree ("organization_id","pair_key");--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_merged_into_contact_id_contact_id_fk" FOREIGN KEY ("merged_into_contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;