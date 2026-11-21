# Identity (own organization profile, client business profiles)

Who «we» are and what we do, and what our clients do — data that every AI step needs to tell internal from external communication and to reason about business messages.

Status: **decided 2026-11-14**; 2026-11-19: group C «Рабочий контекст» (time zone + working hours) is edited by the org owner ([organization/](../organization/README.md)) (Q1–Q12 answered); **I1–I3 built 2026-11-14** (org profile + staff addresses, one «us» resolver + internal detection, gate before topics `shadow` / `on`), not deployed; **I4 built 2026-11-15** (org profile in prompts: topics prompts gated by `identity.promptContext`, default off until the golden-set eval; parsers / judge / AI chat / order split always on); **I5–I6 built 2026-11-15** (client profile «Профиль компании»: manual by the responsible + owner, web enrichment with provenance and proposals, Companies filters, on-create switch off by default). Next: the IN4COM owner fills the profile (Q11); reviewers fill the golden set; eval with / without «С профилем организации»; then switch «Профиль в промптах» on per org. I7 = later (see the plan).

Later changes (2026-11-21, bug list round — [bugfixing/](../bugfixing/README.md)): «Профиль компании» gets «Убрать» for an unconfirmed automatic value (field emptied, `field_meta.removedKey` stops the next web fill from writing the same value); web lookup writes its note / «почему подходит» in Russian, caps a name-only match at «medium», and offers per-field undo «Было: … · вернуть» in the result.

| File | Content |
|---|---|
| [01-specification.md](01-specification.md) | Goal, inventory of today, own org profile (identity + business data, mandatory minimum, gate, one «us» resolver, use in deterministic steps and in prompts), client business profile (fields, provenance, manual by the responsible KAM, web enrichment, use in prompts), data model, UI, acceptance checks |
| [02-open-questions.md](02-open-questions.md) | Q1–Q12 with recommendations; decisions log |
| [03-development-plan.md](03-development-plan.md) | Phases I1–I7, estimates, dependencies, migrations |
