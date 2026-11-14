CREATE TABLE "product_watch_state" (
	"product_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"price" numeric(14, 2),
	"status" text,
	"total_stock" integer,
	"vintage" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "topic_id" text;--> statement-breakpoint
ALTER TABLE "product_watch_state" ADD CONSTRAINT "product_watch_state_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_watch_state" ADD CONSTRAINT "product_watch_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_watch_state_org_idx" ON "product_watch_state" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_topic_idx" ON "order" USING btree ("topic_id") WHERE "order"."topic_id" is not null;