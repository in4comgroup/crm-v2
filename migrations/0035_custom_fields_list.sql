ALTER TABLE "custom_field" ADD COLUMN "show_in_list" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "client_custom_values_gin" ON "client" USING gin ("custom_values");--> statement-breakpoint
CREATE INDEX "contact_custom_values_gin" ON "contact" USING gin ("custom_values");