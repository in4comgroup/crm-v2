CREATE TABLE "ai_usage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text,
	"user_id" text,
	"process_key" text NOT NULL,
	"operation_name" text NOT NULL,
	"gateway_id" text NOT NULL,
	"provider_name" text,
	"request_model" text NOT NULL,
	"response_model" text,
	"response_id" text,
	"response_ids" text[],
	"status" text NOT NULL,
	"error_type" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"reasoning_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"web_search_count" integer,
	"steps" integer,
	"duration_ms" integer,
	"cost_estimate_usd" numeric(14, 8),
	"cost_actual_usd" numeric(14, 8),
	"cost_reconcile_attempts" integer DEFAULT 0 NOT NULL,
	"markup_percent" numeric(6, 2),
	"ref" jsonb
);
--> statement-breakpoint
CREATE INDEX "ai_usage_event_org_created_idx" ON "ai_usage_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_event_process_created_idx" ON "ai_usage_event" USING btree ("process_key","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_event_model_created_idx" ON "ai_usage_event" USING btree ("response_model","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_event_response_id_idx" ON "ai_usage_event" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "ai_usage_event_created_idx" ON "ai_usage_event" USING btree ("created_at");