CREATE TABLE "document_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_item_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"origin" text NOT NULL,
	"confidence" text DEFAULT 'high' NOT NULL,
	"reason" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"removed_at" timestamp,
	"removed_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "file_key" text;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "file_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "file_mime" text;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "file_sha256" text;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "file_stored_at" timestamp;--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "file_status" text;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_source_item_id_source_item_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_removed_by_user_id_user_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_link_item_entity_uq" ON "document_link" USING btree ("source_item_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "document_link_entity_idx" ON "document_link" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "source_item_org_file_sha_idx" ON "source_item" USING btree ("organization_id","file_sha256");