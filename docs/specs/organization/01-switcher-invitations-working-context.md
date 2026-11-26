# Switcher, invitations, roles, working context

Status: **built 2026-11-19**. Found while writing the onboarding guide (`docs/docs/onboarding-new-client.md`); product owner decisions:

| # | Gap | Decision |
|---|---|---|
| 1 | No organization switcher: a person in several organizations got one of them at sign-in, in no fixed order | A switcher **for platform admins** (`user.role = admin`) |
| 2 | Invitations: no role choice, no list of pending invitations, no cancel | No role choice is fine (the owner changes the role later). The product uses only **«Владелец» and «Участник»**. A pending-invitations list with cancel |
| 3 | Time zone and working hours had no UI (code default / developer setting) | **The org owner edits them** at the organization level |

## 1. Organization switcher (platform admins)

- Sidebar footer: an arrow button next to the organization item, hint «Сменить организацию» (Change organization); hidden when the sidebar is collapsed. The organization item stays a link to `/account`.
- The menu lists the admin's memberships (id + name, Russian name order), the current one marked. A platform admin who must work in a client organization first adds themselves as a member (`/settings` → «Пользователи» → «Организации»).
- A pick → `POST /api/account/active-organization { organizationId }`: session, platform admin and membership are checked first (better-auth's `setActiveOrganization` clears the active organization before it refuses a non-member), then better-auth switches the session and rewrites the cookies. The page reloads on `/dashboard` with the toast «Организация: <name>».
- The session row keeps the organization name / slug right: `databaseHooks.session.update.before` fills them whenever an update sets `activeOrganizationId` (switch and accept-invitation).
- `/api/organization` (the `/account` page) returns the session's ACTIVE organization when the user is a member of it (before: the first membership).
- Other users: no switcher (unchanged).

## 2. Invitations and roles

- Block «Приглашения» (Invitations) under the members table on `/account` → «Участники» (owner only): e-mail, role, «Пригласил» (Invited by), «Отправлено» (Sent), «Действует до» (Valid until) + badge «Истекло» (Expired).
- «Отправить ещё раз» (Send again): the invitation e-mail again with a new validity date (better-auth `inviteMember` with `resend: true`). For an expired invitation better-auth makes a new one; the block cancels the old row so only one stays.
- «Отменить» (Cancel): confirmation dialog, then status `canceled`; the link then opens «Invalid invitation».
- Data: `GET /api/organization/invitations` (session, active organization, owner) → pending invitations with the inviter's name. Not under `/api/invitations/`, which is public (sign-up checks).
- Roles: the role dialog offers «Владелец» (owner) and «Участник» (member) only. A member who already has `admin` keeps it and sees «Администратор», but nobody can give it any more. Invitations have no role field (everyone joins as member).

## 3. Working context (time zone + working hours)

- «Профиль организации» → card «Рабочий контекст» (Working context): the org **owner** edits «Часовой пояс» (searchable list of time zones with UTC offsets) and «Рабочие часы» (start < end, HH:MM), with its own «Сохранить». Other members read only.
- Stored as the organization override of `attention.params` (only `timeZone`, `workStart`, `workEnd`; `org_setting_log` keeps the history). `PUT /api/org-profile { workingContext }`.
- Every reader uses `loadAttentionParams` (60 s cache): topic lists and deadlines, digests and evening reminders, Telegram send hours, notification check times, CRM checks, the AI chat's «today». The topics run re-computes attention on its next run (the parameter hash changes).
- Default (no override): Europe/Vienna, 08:00–18:00. Identity spec 01 §3 group C is changed accordingly.

### 3.1 Default task due time + task deadlines in the org time zone (2026-11-26)

Tester items: «По умолчанию Просрочена — 3:00 → по умолчанию 23:59, в идеале — менять в настройках для клиента»; «Нельзя выбрать время дедлайна».

- Cause: the task form sent only a date; the server stored it as 00:00 UTC = 03:00 in Moscow, so a task due «today» was «Просрочена» from 03:00.
- Card «Рабочий контекст» gets a third value **«Срок задачи по умолчанию»** (HH:MM, default 23:59, owner only). Stored as its own org_setting **`tasks.defaultDueTime`** (null = 23:59), NOT in `attention.params`. `PUT /api/org-profile { workingContext: { timeZone, workStart, workEnd, taskDueTime } }`.
- **The org time zone is the zone of task deadlines** (`src/lib/org-time.ts`, unit-tested): the task form «Срок» = date + time; a new task starts today at the default time; the server reads «YYYY-MM-DD» (= that day at the default time) and «YYYY-MM-DDTHH:MM» as wall time in the org zone, a full ISO instant as is (`parseTaskDue`, `loadOrgTime` in `src/server/org-time.ts`); every task view shows deadlines in the org zone, never in the browser's (`useOrgTime()` from `src/lib/org-time-context.tsx`, provided by the `(protected)` layout). AI chat task drafts: a date without a time = the default time too.
- Data: migration `0054_task_due_org_time` moved every task due at exactly 00:00 UTC to 23:59 org time of the same day (24 tasks on the test DB).
- Not changed: other dates (order dates, change history, documents, «создано») still use the browser zone — offered, not decided. The AI chat prompt / tool descriptions still say «date only = 18:00» for the model's own reading (changed with the next chat eval; `docs/todo/README.md`).

## 4. Checks

- Unit tests: `src/lib/org-switcher.test.ts` (4), `src/lib/invitations.test.ts` (9), `src/lib/identity/working-context.test.ts` (3); `pnpm test` 1004 / 1004; `tsc` 0; lint 0 errors.
- Live on the test DB: working context saved by the owner and read back through `loadAttentionParams`, unknown zone and a non-owner refused, old value restored.
- Not checked: the switcher and the invitations block in a browser; a real switch and real invitation e-mails.
