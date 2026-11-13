-- Extensions and SQL functions that the schema depends on.
-- Not expressible in src/db/schema.ts, so written by hand (custom migration).
-- Used by the Search V2 product columns (0002) and by global search
-- (src/server/search.ts, src/server/products.ts).

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
--> statement-breakpoint
-- unaccent() is only STABLE; generated columns and indexes need IMMUTABLE.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $_$ SELECT public.unaccent('public.unaccent', $1) $_$;
--> statement-breakpoint
-- Cyrillic -> Latin transliteration, so «Вектор» and "vektor" match.
CREATE OR REPLACE FUNCTION public.translit_cyr_lat(t text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
        SELECT translate(
          regexp_replace(
          regexp_replace(
          regexp_replace(
          regexp_replace(
          regexp_replace(
          regexp_replace(
          regexp_replace(
            lower(coalesce(t, '')),
            'ж', 'zh', 'g'),
            'ц', 'ts', 'g'),
            'ч', 'ch', 'g'),
            'ш', 'sh', 'g'),
            'щ', 'shch', 'g'),
            'ю', 'yu', 'g'),
            'я', 'ya', 'g'),
          'абвгдеёзийклмнопрстуфхыэъь',
          'abvgdeeziyklmnoprstufhye'
        )
      $$;
--> statement-breakpoint
-- Builds an OR tsquery from free text ("a b" -> 'a | b').
CREATE OR REPLACE FUNCTION public.to_or_tsquery(t text) RETURNS tsquery
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
        SELECT to_tsquery('simple',
          nullif(
            array_to_string(
              array(
                SELECT x
                FROM unnest(string_to_array(
                  regexp_replace(lower(coalesce(t, '')), '[^a-z0-9 ]+', ' ', 'g'),
                  ' ')) AS x
                WHERE x <> ''
              ),
              ' | '
            ),
            ''
          )
        )
      $$;
