-- AI model registry: search index + platform reference data.
-- Spec: docs/specs/models/01-gateway-providers.md §5, 02-model-registry.md §3.
-- Safe to re-run.

-- Trigram search over id + name + vendor (the «Модели» tab search box).
-- Expression index, so it is kept out of schema.ts. Queries must use the
-- same expression (see src/server/ai/registry/models.ts).
CREATE INDEX IF NOT EXISTS "ai_model_search_trgm_idx" ON "ai_model"
  USING gin (("model_id" || ' ' || "name" || ' ' || coalesce("vendor", '')) gin_trgm_ops);
--> statement-breakpoint

-- The Vercel AI Gateway: the default (and today only) gateway.
-- /v1/models is public; the key in AI_GATEWAY_API_KEY is needed only for
-- model calls (P2).
INSERT INTO "ai_gateway" (
  "id", "name", "adapter", "catalog_sources", "models_dev_provider_id",
  "is_enabled", "is_default", "config", "credentials_env"
) VALUES (
  'vercel', 'Vercel AI Gateway', 'vercel-ai-gateway',
  '{gateway-api,models-dev}'::text[], 'vercel',
  true, true, '{"baseUrl":"https://ai-gateway.vercel.sh/v1"}'::jsonb, 'AI_GATEWAY_API_KEY'
) ON CONFLICT ("id") DO NOTHING;
