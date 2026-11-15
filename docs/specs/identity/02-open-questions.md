# Identity — open questions

Status: **answered 2026-11-14** (product owner). Each question has a recommendation. Answer «as recommended» or give a different decision; decisions are then recorded in § Decisions and folded into [01-specification.md](01-specification.md).

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | Where to store the own org profile? | (a) new table `org_profile` + change log; (b) `org_setting` key `org.profile` (jsonb, zod, existing log + 60 s cache) | **(a)** — typed columns, clear owner, used by many processes; `org_setting` stays for engine parameters |
| Q2 | Business domain («Отрасль») taxonomy | (a) short platform list (~17 values, spec §3.2) + free-text «уточнение»; (b) ОКВЭД sections (21) / codes; (c) free text only | **(a)** now; ОКВЭД code stored as an optional extra later (filled from ИНН lookup) |
| Q3 | Who edits a client profile? | (a) responsible + owner; (b) any member; (c) responsible + owner + org admins | **(a)** — matches the «Ответственный» rules; others read |
| Q4 | Gate before topics `shadow` / `on` | (a) hard block (409), platform-admin override with a reason; (b) warning only; (c) no gate | **(a)**. Orgs already running (IN4COM) get a banner, not a stop |
| Q5 | Web enrichment of empty client fields | (a) fill empty fields at once, marked «Из интернета — проверьте»; (b) always a proposal, nothing written until the KAM accepts | **(a)** — useful at once, visible as unverified; manual values never overwritten |
| Q6 | Enrich new clients automatically on create? | (a) off by default, org setting to switch on; (b) always on; (c) only manual / batch | **(a)** — AI cost per new client (discovery creates many) |
| Q7 | Our «Продукты и услуги» | (a) free list of lines (+ optional link to catalogue categories); (b) only catalogue categories | **(a)** — service companies have no catalogue; product companies have 16 000 SKUs, too many for a prompt |
| Q8 | Staff Telegram handles / phones in the registry | (a) yes (kind `person`, channel telegram / phone); (b) email only | **(a)** — Telegram attribution needs it (see topics 08 Telegram doc) |
| Q9 | Internal detection rule | (a) author ours AND all recipients ours → internal, deterministic; (b) keep the model deciding | **(a)**; unknown recipients (no address) → the model decides as today |
| Q10 | Client profile from our own communication (§4.4) | (a) later phase; (b) in the first release | **(a)** |
| Q11 | Existing org data quality: the IN4COM profile (and the order-split hard-code «wine & spirits») | Who fills IN4COM's profile for the pilot? | Product owner with IN4COM owner, before the prompt changes ship |
| Q12 | Language of profile texts | Russian only / any | Russian (prompts are Russian); foreign names as written |

## Decisions

| # | Decision (2026-11-14) |
|---|---|
| Q1 | (a) new table `org_profile` + change log |
| Q2 | **Only the business-domain category list + a comment. No ОКВЭД in any form** (no codes, no ИНН lookup) |
| Q3 | (a) client profile: responsible + owner edit; others read |
| Q4 | (a) hard gate before `shadow` / `on`, platform-admin override with a logged reason; running orgs get a banner |
| Q5 | (a) web data fills EMPTY client fields at once, marked «Из интернета — проверьте»; manual values never overwritten (proposal instead) |
| Q6 | (a) enrichment on client create: org setting, **off by default** (expensive) |
| Q7 | (a) free list of product / service lines + optional link to catalogue categories |
| Q8 | (a) staff Telegram handles / phones in the registry (kind `person`) |
| Q9 | (a) author ours AND all recipients ours → internal, deterministic |
| Q10 | (a) client profile from our communication = later phase |
| Q11 | **The IN4COM owner fills the IN4COM profile** |
| Q12 | Russian |
