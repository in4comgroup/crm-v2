CREATE TABLE "ai_gateway" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"adapter" text NOT NULL,
	"catalog_sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"models_dev_provider_id" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_env" text,
	"last_synced_at" timestamp,
	"last_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_model" (
	"gateway_id" text NOT NULL,
	"model_id" text NOT NULL,
	"vendor" text,
	"name" text NOT NULL,
	"family" text,
	"description" text,
	"type" text DEFAULT 'language' NOT NULL,
	"canonical_model_id" text,
	"attachment" boolean,
	"reasoning" boolean,
	"tool_call" boolean,
	"structured_output" boolean,
	"temperature" boolean,
	"open_weights" boolean,
	"web_search" boolean,
	"input_modalities" text[],
	"output_modalities" text[],
	"limit_context" integer,
	"limit_output" integer,
	"cost_input" numeric(14, 6),
	"cost_output" numeric(14, 6),
	"cost_cache_read" numeric(14, 6),
	"cost_cache_write" numeric(14, 6),
	"cost_web_search" numeric(14, 6),
	"cost_raw" jsonb,
	"knowledge" text,
	"release_date" text,
	"last_updated" text,
	"status" text,
	"zdr" text,
	"no_training" text,
	"regions" text[],
	"deprecated_at" timestamp,
	"is_available" boolean DEFAULT true NOT NULL,
	"field_sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_gateway_id_model_id_pk" PRIMARY KEY("gateway_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "ai_model_price_history" (
	"id" text PRIMARY KEY NOT NULL,
	"gateway_id" text NOT NULL,
	"model_id" text NOT NULL,
	"valid_from" timestamp DEFAULT now() NOT NULL,
	"cost_input" numeric(14, 6),
	"cost_output" numeric(14, 6),
	"cost_cache_read" numeric(14, 6),
	"cost_cache_write" numeric(14, 6),
	"cost_web_search" numeric(14, 6),
	"cost_raw" jsonb
);
--> statement-breakpoint
ALTER TABLE "ai_model" ADD CONSTRAINT "ai_model_gateway_id_ai_gateway_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."ai_gateway"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_price_history" ADD CONSTRAINT "ai_model_price_history_model_fk" FOREIGN KEY ("gateway_id","model_id") REFERENCES "public"."ai_model"("gateway_id","model_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_gateway_default_uidx" ON "ai_gateway" USING btree ("is_default") WHERE "ai_gateway"."is_default" = true;--> statement-breakpoint
CREATE INDEX "ai_model_gateway_type_idx" ON "ai_model" USING btree ("gateway_id","type");--> statement-breakpoint
CREATE INDEX "ai_model_vendor_idx" ON "ai_model" USING btree ("vendor");--> statement-breakpoint
CREATE INDEX "ai_model_canonical_idx" ON "ai_model" USING btree ("canonical_model_id");--> statement-breakpoint
CREATE INDEX "ai_model_price_history_model_idx" ON "ai_model_price_history" USING btree ("gateway_id","model_id","valid_from");