ALTER TABLE "topic_delivery_pref" ALTER COLUMN "telegram_enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "telegram_status" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "telegram_at" timestamp;--> statement-breakpoint
ALTER TABLE "notification_pref" ADD COLUMN "telegram_categories" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "notification_tg_pending_idx" ON "notification" USING btree ("created_at") WHERE "notification"."priority" = 'important' and "notification"."telegram_status" is null;--> statement-breakpoint
-- Edited by hand (data, not schema): the Telegram row of /account was «Скоро», so no
-- member ever chose `telegram_enabled = false` — the old default false is not a
-- choice. Pushes still need an active Telegram binding (docs/specs/telegram/04 TI3).
UPDATE "topic_delivery_pref" SET "telegram_enabled" = true WHERE "telegram_enabled" = false;--> statement-breakpoint
-- Notifications made before this migration are never copied to Telegram.
UPDATE "notification" SET "telegram_status" = 'not_sent' WHERE "telegram_status" IS NULL;
