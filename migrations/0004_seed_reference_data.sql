-- Platform-wide reference data (seed). Not tenant data.
-- Custom migration. Without these rows a fresh DB is unusable:
--   * source_template: new orgs get their default sources from the
--     `is_default = true` templates (Files Drop Off, AI Chat), and the
--     «Добавить источник» (Add source) picker lists the visible templates.
--   * system deal_funnel_stage rows (owner_organization_id IS NULL): the funnel
--     every org uses until it defines its own stages (org-or-system fallback in
--     listDealFunnelStages).
-- Fixed ids = the ids in the production DB. ON CONFLICT DO NOTHING keeps this a
-- no-op where the rows exist and never overwrites admin edits.
-- To change seed data later: write a NEW migration (UPDATE / INSERT), do not
-- edit this one. Org-owned data (orgs, users, org stages, rules, …) never
-- belongs in a migration.

INSERT INTO public.source_template
  (id, type, provider, name, description, default_provider_config, default_automated_parsing_is_allowed, is_default, is_visible_to_orgs, status)
VALUES
  ('0be3a8af-f1c2-4868-9e12-a18901935ab2', 'internal', 'aichat', 'AI Chat', 'Save AI-Chat data to the system context.', '{}'::jsonb, false, true, true, 'active'),
  ('4c8b608e-a0c7-4fdb-abf4-7d5965cf615d', 'external', 'nylas', 'Emails', 'Email messages synced from a Nylas-connected mailbox.', '{}'::jsonb, true, false, true, 'active'),
  ('9c950196-ad7e-4827-a686-f587beb21721', 'external', 'imap', 'Emails (IMAP)', 'Email messages synced directly from an IMAP mailbox (no Nylas).', '{"mailbox":"INBOX"}'::jsonb, true, false, true, 'active'),
  ('870b4fd5-740b-4aec-be64-50176ce392cf', 'external', 'dropoff', 'Files Drop Off', 'Ad-hoc files uploaded via the Drop Off dialog.', '{}'::jsonb, false, true, true, 'active'),
  ('1ea7c2e4-f58c-4a47-8f23-ec411a57ba88', 'external', 'gchat', 'Google Chat', 'Messages and attachments from a Google Chat space.', '{}'::jsonb, true, false, true, 'active'),
  ('ba815a50-7a54-4e1d-a1f1-bef238573c24', 'external', 'gdrive', 'Google Drive', 'Files synced from a Google Drive shared drive.', '{}'::jsonb, true, false, true, 'active'),
  ('bbda2228-6d31-4f75-9cbf-9ed5fbf58adf', 'external', 'gdrive', 'Google Meet', 'Meeting recordings synced from the Google Meet shared drive.', '{}'::jsonb, true, false, true, 'active'),
  ('a5ec375d-35dc-4528-989d-829ed70b421b', 'external', 'telegram', 'Telegram Bot', 'Messages forwarded or DM''d to a per-org Telegram bot (webhook-ingested).', '{}'::jsonb, true, false, true, 'active'),
  ('cf48ccae-9510-410b-bfd7-1a3f05be9e6f', 'external', 'whatsapp', 'WhatsApp Archive', 'WhatsApp chat archives uploaded as a folder export.', '{}'::jsonb, false, false, true, 'active')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO public.deal_funnel_stage
  (id, name, display_name, closure_probability, sort_order, is_system, owner_organization_id, is_active, is_pre_pipeline, is_hidden)
VALUES
  ('ebd51825-dcb2-4ed6-bc2c-622e69c1dfb0', 'Qualification', NULL, 0.050, 10, true, NULL, true, false, false),
  ('cb6c6bbe-344d-46fe-a63b-c02563b4b01d', 'Discovery', NULL, 0.200, 20, true, NULL, true, false, false),
  ('4354d6ef-5c1b-41e6-b0bc-ae767d1f5ba2', 'Pilot', NULL, 0.500, 30, true, NULL, true, false, false),
  ('ad5d0bb6-306f-40df-ba83-1b2c7a809c07', 'Proposal', NULL, 0.600, 40, true, NULL, true, false, false),
  ('7e27ce50-b43f-413c-875b-fdc45b4481ac', 'Negotiations', NULL, 0.800, 50, true, NULL, true, false, false),
  ('081940d7-2e84-401c-9883-4639f8ca4626', 'Closed', NULL, 1.000, 60, true, NULL, true, false, false),
  ('f8c583d4-eb8e-4266-8b85-0e44cfb1d0d3', 'Rejected', NULL, 0.000, 70, true, NULL, true, false, false)
ON CONFLICT (id) DO NOTHING;
