CREATE TABLE "client_co_responsible" (
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_co_responsible_client_id_user_id_pk" PRIMARY KEY("client_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "client_co_responsible" ADD CONSTRAINT "client_co_responsible_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_co_responsible" ADD CONSTRAINT "client_co_responsible_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_co_responsible" ADD CONSTRAINT "client_co_responsible_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_co_responsible" ADD CONSTRAINT "client_co_responsible_added_by_user_id_user_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_co_responsible_org_user_idx" ON "client_co_responsible" USING btree ("organization_id","user_id");