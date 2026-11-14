CREATE TABLE "topic_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"local_date" date NOT NULL,
	"topic_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"card_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"subject" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_delivery_pref" (
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"email_morning" boolean DEFAULT true NOT NULL,
	"email_weekly" boolean DEFAULT true NOT NULL,
	"email_evening" boolean DEFAULT true NOT NULL,
	"telegram_enabled" boolean DEFAULT false NOT NULL,
	"telegram_chat_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "topic_delivery_pref_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "topic_delivery" ADD CONSTRAINT "topic_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_delivery" ADD CONSTRAINT "topic_delivery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_delivery_pref" ADD CONSTRAINT "topic_delivery_pref_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_delivery_pref" ADD CONSTRAINT "topic_delivery_pref_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topic_delivery_org_user_day_idx" ON "topic_delivery" USING btree ("organization_id","user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_delivery_digest_uq" ON "topic_delivery" USING btree ("organization_id","user_id","channel","kind","local_date") WHERE "topic_delivery"."kind" IN ('morning_digest', 'weekly_digest', 'evening_reminder') AND "topic_delivery"."status" = 'sent';