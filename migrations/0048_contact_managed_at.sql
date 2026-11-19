ALTER TABLE "contact" ADD COLUMN "managed_at_user_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "managed_at_person_name" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "managed_at_person_position" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "managed_at_set_by_user_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "managed_at_set_at" timestamp;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_managed_at_user_id_user_id_fk" FOREIGN KEY ("managed_at_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_managed_at_set_by_user_id_user_id_fk" FOREIGN KEY ("managed_at_set_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_managed_at_one_kind" CHECK ("contact"."managed_at_user_id" IS NULL OR "contact"."managed_at_person_name" IS NULL);