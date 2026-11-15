# Contact ↔ company links — questions and decisions

Status: **decided 2026-11-15** (product owner): Q1–Q11 as recommended; Q12 = no change of existing data (see Decisions).

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | Data model | (a) new link table with history; `contact.client_id` stays = the primary current link (all existing code keeps working); (b) replace `client_id` everywhere by the link table | **(a)** |
| Q2 | Several addresses of one person (old X email + new Y email) | (a) new table `contact_address` (email / phone / Telegram, active / old, company); every matcher reads it; (b) put old addresses into `contact.aliases` | **(a)** — aliases are names; addresses need status and company |
| Q3 | Relation types | (a) Сотрудник / Консультант (подрядчик) / Партнёр (представитель) / Другое; (b) free text | **(a)** |
| Q4 | Automatic or by a person | (a) the system only PROPOSES (rules P1–P5); a person decides «Перешёл» / «Работает с обеими» / «Другой человек»; (b) high-confidence moves applied automatically, the rest proposed | **(a)** — a wrong relink moves topics and deals to the wrong company; the decision is cheap |
| Q5 | Who decides | (a) any member; notified: the responsible of X and of Y; (b) only the responsible / owner | **(a)** |
| Q6 | Where the proposal shows | (a) block in the contact drawer + the company drawers of X / Y + a bell notification; (b) + a topic card on the dashboard | **(a)** |
| Q7 | Merge of duplicate contacts | (a) build a contact merge now (needed to join «the same person» records); (b) no merge — link the two records as «тот же человек» only | **(a)** |
| Q8 | Dates of a move | (a) taken from the evidence message, editable; (b) only the decision date | **(a)** |
| Q9 | Open deals of X where the person was a deal contact | (a) no automatic change; journal line + existing DM-lost risk check + «Заменить контакт в сделках X» in the drawer; (b) remove him from X's deals automatically | **(a)** |
| Q10 | The new company Y | (a) Y is a client → a topic «знакомый контакт перешёл из X» (chance, no deal); Y unknown → offer «Создать компанию Y»; (b) nothing | **(a)** |
| Q11 | Contacts list / filter | (a) company column = primary («+1» for more); the company filter matches every current link; toggle «Включая бывших»; (b) primary only | **(a)** |
| Q12 | Existing data | (a) backfill: each contact with `client_id` → one current primary `employee` link; its `email` / `phone` → active addresses; then one run of rules P2 / P4 over the existing contacts to propose duplicates (e.g. same name in two companies); (b) backfill only | **(a)** |

## Decisions

| # | Decision (2026-11-15) |
|---|---|
| Q1–Q11 | As recommended |
| Q12 | **No change of existing data**: no backfill, no run of the rules over old contacts. A contact whose `client_id` has no current link row shows ONE implicit current primary link («Сотрудник», since the contact's creation); the server writes the row (source `implicit`) only when a person or a decision changes the contact's companies. Rules run only on NEW items (after parse / signal extraction) and in discovery (P5) |
