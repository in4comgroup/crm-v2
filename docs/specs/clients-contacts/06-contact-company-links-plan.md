# Contact ↔ company links — development plan

Status: **built 2026-11-15** (L1–L5; L1 without the backfill — Q12). Details: [04 §10](04-contact-company-links.md#10-built-2026-11-15).

| Phase | Name | Days | Output |
|---|---|---|---|
| L1 | Model (no backfill — Q12) | 1 | migration: `contact_company_link`, `contact_address`, `contact_link_proposal`, `contact_link_event`, `contact.merged_into_contact_id`; implicit link for an old `client_id`; one write path `src/server/contact-links.ts` keeping `contact.client_id` = primary |
| L2 | Matching by any address | 1 | discovery, topics counterparty, document attribution and the «us» checks read `contact_address`; topics: company of a multi-link contact by the message address |
| L3 | Recognition + decisions | 1.5 | pure rules P1–P5 (unit-tested) after parse / extraction + in the discovery preview; proposals; decisions «Перешёл» / «Работает с обеими» / «Другой человек»; topic for Y; journal lines on X's deals |
| L4 | Merge | 1 | `mergeContacts` (every reference) + «Объединить с…» |
| L5 | UI | 1.5 | contact drawer «Компании» + proposal block; company drawer «Контакты» current / «Бывшие» / «также»; contacts list column + filter; bell notification |

Total ≈ 6 days. Migration: `0039_contact_company_links` (schema only; no backfill).
