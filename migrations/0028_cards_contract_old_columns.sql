-- Topics plan phase 12 (cleanup of old logic), contract step.
-- Custom-rule card generation (generateCards) and name-based deal discovery
-- (generateDeals) were removed for every org; these two scan stamps were
-- written only by them. Card columns and junctions (category, message,
-- accepted, rejection_reason, source_item_id, rule_id, card_client,
-- card_user, card_contact) are KEPT: topic cards still write some of them
-- and the read-only «История карточек» reads all of them.
-- Edited after generation: IF EXISTS added so a re-run is safe.
ALTER TABLE "source_item" DROP COLUMN IF EXISTS "card_analysis_scanned_at";--> statement-breakpoint
ALTER TABLE "source_item" DROP COLUMN IF EXISTS "deal_analysis_scanned_at";
