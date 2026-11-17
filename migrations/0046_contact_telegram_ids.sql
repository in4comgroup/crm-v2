ALTER TABLE "contact_address" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "contact_address" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint
CREATE INDEX "contact_address_org_external_idx" ON "contact_address" USING btree ("organization_id","kind","external_id") WHERE "contact_address"."external_id" is not null;