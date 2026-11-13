-- Search V2: generated (STORED) columns and their indexes on `product`.
-- Custom migration. These columns are deliberately NOT in src/db/schema.ts:
-- drizzle `select()` returns every schema column, and search_vector is large;
-- the retriever in src/server/products.ts reads them via raw `sql`.
-- To change an expression: write a NEW custom migration (drop + re-add the
-- column, then recreate its index). Requires 0000 (functions, pg_trgm).
-- IF NOT EXISTS keeps this a no-op on the production DB, where they exist.

ALTER TABLE public.product ADD COLUMN IF NOT EXISTS name_norm text GENERATED ALWAYS AS (lower(public.immutable_unaccent(public.translit_cyr_lat(name)))) STORED;
--> statement-breakpoint
ALTER TABLE public.product ADD COLUMN IF NOT EXISTS region_norm text GENERATED ALWAYS AS (lower(public.immutable_unaccent(public.translit_cyr_lat((additional_metadata ->> 'region'::text))))) STORED;
--> statement-breakpoint
ALTER TABLE public.product ADD COLUMN IF NOT EXISTS is_drink boolean GENERATED ALWAYS AS (((category IS DISTINCT FROM 'Бокалы'::text) AND (category IS DISTINCT FROM 'Хранение бутылок'::text) AND (category IS DISTINCT FROM 'Подарочная упаковка'::text) AND (category IS DISTINCT FROM 'Сиропы'::text) AND (category IS DISTINCT FROM 'Тоники'::text) AND (category IS DISTINCT FROM 'Минеральная вода'::text) AND (category IS DISTINCT FROM 'Газированная вода'::text))) STORED;
--> statement-breakpoint
ALTER TABLE public.product ADD COLUMN IF NOT EXISTS is_gift boolean GENERATED ALWAYS AS ((((additional_metadata ->> 'gift_packaging'::text) = 'Да'::text) OR (name ~~* '%подароч%'::text) OR (name ~~* '%деревян%'::text))) STORED;
--> statement-breakpoint
ALTER TABLE public.product ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (((((((setweight(to_tsvector('simple'::regconfig, COALESCE(name, ''::text)), 'A'::"char") || setweight(to_tsvector('simple'::regconfig, COALESCE(lower(public.immutable_unaccent(public.translit_cyr_lat(name))), ''::text)), 'A'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE((additional_metadata ->> 'vendor'::text), ''::text)), 'A'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(category, ''::text)), 'C'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE((additional_metadata ->> 'type'::text), ''::text)), 'C'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE((additional_metadata ->> 'country_name'::text), ''::text)), 'D'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(lower(public.immutable_unaccent(public.translit_cyr_lat((additional_metadata ->> 'region'::text)))), ''::text)), 'D'::"char"))) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_is_drink_idx ON public.product USING btree (is_drink);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_name_norm_trgm_idx ON public.product USING gin (name_norm public.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_region_norm_trgm_idx ON public.product USING gin (region_norm public.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_search_vector_idx ON public.product USING gin (search_vector);
