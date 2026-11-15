CREATE TABLE "client_profile" (
	"client_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"description" text,
	"industry_code" text,
	"industry_note" text,
	"market_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"needs" jsonb DEFAULT '{"lines":[]}'::jsonb NOT NULL,
	"size_band" text,
	"points_of_sale" integer,
	"geography" text,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"web_enriched_at" timestamp,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_profile_proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"source" text NOT NULL,
	"confidence" text,
	"evidence_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_profile" ADD CONSTRAINT "client_profile_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profile" ADD CONSTRAINT "client_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profile" ADD CONSTRAINT "client_profile_industry_code_industry_code_fk" FOREIGN KEY ("industry_code") REFERENCES "public"."industry"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profile" ADD CONSTRAINT "client_profile_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profile_proposal" ADD CONSTRAINT "client_profile_proposal_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profile_proposal" ADD CONSTRAINT "client_profile_proposal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profile_proposal" ADD CONSTRAINT "client_profile_proposal_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_profile_org_idx" ON "client_profile" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "client_profile_org_industry_idx" ON "client_profile" USING btree ("organization_id","industry_code");--> statement-breakpoint
CREATE INDEX "client_profile_proposal_client_idx" ON "client_profile_proposal" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "client_profile_proposal_org_idx" ON "client_profile_proposal" USING btree ("organization_id","status");