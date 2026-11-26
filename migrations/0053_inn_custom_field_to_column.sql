-- ИНН is now a standard column (`client.inn`, migration 0052,
-- docs/specs/clients-contacts/10-standard-fields.md). The one-time conversion
-- of 2026-11-15 (Q12) had made it an org custom field «ИНН» (text). Data fix,
-- safe to re-run:
-- 1. copy each valid value (10 or 12 digits after removing spaces / dashes)
--    into `client.inn` when the column is still empty;
-- 2. archive the custom field («Удалить» = `archived_at`; the owner can
--    restore it) ONLY when every non-empty value of it now equals
--    `client.inn` — a field with an invalid or different value stays as it is.
-- The values stay in `client.custom_values` (archive never deletes them).

UPDATE "client" c
SET "inn" = regexp_replace(c."custom_values" ->> f."id", '[\s-]', '', 'g')
FROM "custom_field" f
WHERE f."organization_id" = c."organization_id"
  AND f."entity" = 'client'
  AND lower(trim(f."label")) = 'инн'
  AND f."archived_at" IS NULL
  AND c."inn" IS NULL
  AND regexp_replace(c."custom_values" ->> f."id", '[\s-]', '', 'g') ~ '^([0-9]{10}|[0-9]{12})$';
--> statement-breakpoint

UPDATE "custom_field" f
SET "archived_at" = now(), "updated_at" = now()
WHERE f."entity" = 'client'
  AND lower(trim(f."label")) = 'инн'
  AND f."archived_at" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "client" c
    WHERE c."organization_id" = f."organization_id"
      AND coalesce(trim(c."custom_values" ->> f."id"), '') <> ''
      AND regexp_replace(c."custom_values" ->> f."id", '[\s-]', '', 'g') IS DISTINCT FROM c."inn"
  );
