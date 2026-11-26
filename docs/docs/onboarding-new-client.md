# Onboarding a new client organization

This guide tells you how to start a new client organization in the product, step by step. It is for three groups of people: the platform admin (our team), the owner of the client's organization, and the client's members. It covers the organization data and profile, invitations, sources, Telegram, the CRM settings, the topics engine, notifications, and AI usage and limits. Each step names WHO does it. UI labels are quoted in Russian exactly as the product shows them, with an English gloss on first use.

Last updated: 2026-11-19

## Contents

1. [Before you start](#1-before-you-start)
2. [Create the organization and its owner](#2-create-the-organization-and-its-owner)
3. [Organization data, profile and identity](#3-organization-data-profile-and-identity)
4. [Invite the members](#4-invite-the-members)
5. [Sources](#5-sources)
6. [Telegram](#6-telegram)
7. [CRM settings](#7-crm-settings)
8. [Topics and signals (platform admin)](#8-topics-and-signals-platform-admin)
9. [Notifications](#9-notifications)
10. [AI usage and limits](#10-ai-usage-and-limits)
11. [First week checklist](#11-first-week-checklist)
12. [Troubleshooting](#12-troubleshooting)

Who-tags in this guide:

- **[Admin]** = platform admin (our team, platform role `admin`).
- **[Owner]** = owner of the client's organization (org role «Владелец», Owner).
- **[Member]** = any person in the client's organization.

---

## 1. Before you start

### 1.1 Roles

The product has two role levels. They are independent of each other.

| Level | Roles | What they control |
| --- | --- | --- |
| Platform | «Пользователь» (User) · «Администратор платформы» (Platform admin) | Only a platform admin sees «Настройки» (Settings, `/settings`) in the sidebar. The admin manages all organizations and users, source templates, AI models, AI limits, topics and signals. |
| Organization | «Владелец» (Owner) · «Участник» (Member) | The owner edits the organization data and profile, manages members, sources, exclusions, the blocklist, custom fields and the deal funnel, and sees the AI usage. Members work with the CRM data. |

Notes:

- Most organization settings are **owner only**. An organization can have more than one owner.
- The product uses two organization roles: «Владелец» and «Участник». The old role «Администратор» (Admin) still shows for a member who already has it (it adds the tab «Проверка эталона», golden-set review), but an owner cannot give it any more.
- A platform admin is not a member of a client organization by default. Pages like «Источники» show data only for the **active** organization of the signed-in person.

### 1.2 What the client must prepare

Ask the client's owner to prepare these items:

| Item | Needed for | Notes |
| --- | --- | --- |
| List of staff e-mail addresses | Invitations | One address per person. The address is the login. |
| Mail access: IMAP **or** Nylas | E-mail source | IMAP: server host, port, encryption, user name, password (for Gmail and accounts with 2FA: an app password). Nylas: Grant ID, API key and API URI of **one** Nylas application. |
| Telegram bot | Telegram source, AI chat in Telegram, pushes | The owner makes the bot in @BotFather (`/newbot`) and keeps the bot token. |
| Google service account (JSON) | Google Chat or Google Drive source | Domain-wide delegation must be on in Google Workspace Admin. Chat: a user to impersonate and the space path (`spaces/…`). Drive: read access to the shared drive and its ID. |
| Company facts | «Профиль организации» (Organization profile) | What the company does, industry, market role, products and services, customer segments, suppliers, own domains, shared mailboxes, other names, postal addresses. |
| Staff extra addresses | «Мои адреса для работы» (My work addresses) | Personal e-mail, Telegram name and phone that staff use for work. |

### 1.3 Sign-in by e-mail code

There are no passwords. There is no Google or GitHub sign-in.

1. Open `/sign-in` («Вход», Sign in).
2. Type the e-mail address.
3. Click «Отправить код» (Send code).
4. Open the e-mail. The 6-digit code is valid for 5 minutes.
5. Type the code. Click «Войти» (Sign in).

If the code does not arrive, click «Отправить код повторно» (Send the code again). The first sign-in also creates the account.

---

## 2. Create the organization and its owner

### 2.1 How an organization comes to exist

- **Self sign-up creates it.** When a person signs in for the first time, the product creates a new organization «Моя организация» (My organization) and makes that person its owner.
- **Exception:** if the e-mail has a pending invitation that is not expired, no organization is created. The person joins the inviting organization through the invitation link.
- `/settings` has **no** button to create an organization or a user. The platform admin edits organizations and memberships only.
- Every new organization gets the default sources from the source templates (today «Files Drop Off» and «AI Chat»). The owner adds the other sources (section 5). If no templates exist on the deployment, the new organization gets no sources.

### 2.2 Steps

1. **[Admin]** Make sure that nobody invited the owner's e-mail before. An open invitation stops the creation of the organization.
2. **[Owner]** Open `/sign-up` («Регистрация», Sign-up). Type «Имя» (Name) and the e-mail. Click «Отправить код». Type the code. Click «Создать аккаунт» (Create account).
3. **[Owner]** The product opens «Домашняя» (Home, `/dashboard`) of the new organization.
4. **[Owner]** In the sidebar footer, click the organization name. This opens the organization page `/account`.
5. **[Owner]** Give the organization its real name (section 3.1).
6. **[Admin]** Open `/settings?tab=organizations` («Организации»). Find the organization. Check the columns «Владелец» (Owner), «Email владельца» (Owner e-mail) and «Профиль» (Profile: «N из 6» or «Заполнен», Complete). «Изменить» (Edit) opens the organization data.
7. **[Admin]** Optional: to work inside the organization, open `/settings?tab=users` («Пользователи»). In the row of your user, click «Организации» (Organizations). Select «Добавить организацию…», select the role, click «Добавить», then «Сохранить организации» (Save organizations).

### 2.3 The active organization

- The active organization shows in the sidebar footer. All CRM data, sources and settings belong to it.
- At sign-in the active organization is one of the person's organizations. After «Принять приглашение» (Accept invitation) the invited organization becomes active.
- **[Admin]** A platform admin can switch the organization: in the sidebar footer, click the small arrow button next to the organization name («Сменить организацию», Change organization) and select an organization. The list shows the organizations the admin is a member of; the current one has a check mark. The page reloads on «Домашняя» (Home) with the new organization. To work inside a client organization, the admin first becomes a member of it (`/settings` → «Пользователи» → «Организации»).
- Other users have no switcher. If such a person is a member of two or more organizations, the sign-in picks one of them, in no fixed order. Keep one organization per account for them.

---

## 3. Organization data, profile and identity

All steps in this section are on `/account`. The page title is the organization name. Tabs:

| Tab | `?tab=` | Who sees it |
| --- | --- | --- |
| «Информация об организации» (Organization information) | `info` | Everybody; only the owner edits |
| «Профиль организации» (Organization profile) | `org-profile` | Everybody reads; the owner edits |
| «Участники» (Members) | `members` | Owner |
| «Использование ИИ» (AI usage) | `ai-usage` | Owner |
| «Уведомления» (Notifications) | `notifications` | Everybody |
| «Проверка эталона» (Golden-set review) | `review` | Org owner or org admin (topics work only) |

### 3.1 «Информация об организации»

**[Owner]**

1. Open `/account?tab=info`.
2. In the card «Данные организации» (Organization data), fill in:
   - «Название организации» (Organization name) — required.
   - «Идентификатор (slug)» (Identifier) — required, unique.
   - «ИНН» (Tax ID).
   - «Веб-сайт» (Website).
   - «Адрес» (Address).
   - «Контактный email» (Contact e-mail).
   - «Контактный телефон» (Contact phone).
3. To add a logo, click the large image on the left («Сменить логотип», Change logo). Use JPEG, PNG or WebP.
4. Click «Сохранить» (Save).

The website and the address count as «ours». The product uses them to tell our own messages from client messages.

### 3.2 «Профиль организации» — why it matters

The profile tells the AI who «we» are and what we do. Without it, the AI cannot tell internal messages from external ones. It is also a gate: the platform admin cannot switch the topics engine to «Тень» (Shadow) or «Включено» (On) while the profile minimum is not complete (section 8).

While the minimum is not complete, the owner sees a banner on `/dashboard` and `/account`: «Заполните профиль организации — без него ИИ не отличает внутреннюю переписку от внешней.» with the link «Открыть профиль» (Open profile). The banner is red when the topics engine already runs for the organization, amber otherwise. Owners also get the notification «Профиль организации не заполнен» (Organization profile not complete).

The tab shows «Профиль заполнен на N из 6» (Profile complete: N of 6) and lists the missing items. The 6 items:

| # | Item (exact text) |
| --- | --- |
| 1 | «Название организации» |
| 2 | «Свой домен (сайт или почтовый) — или отметка «Нет своего домена»» |
| 3 | «Чем занимается компания» |
| 4 | «Отрасль» и «Роль на рынке» |
| 5 | Хотя бы один пункт в «Продукты и услуги» |
| 6 | Хотя бы один пункт в «Наши клиенты» |

### 3.3 Card «Кто мы» (Who we are) — the identity registry

**[Owner]** Open `/account?tab=org-profile`. Changes in this card are saved at once.

1. «Название» (Name) — read only. It comes from «Информация об организации».
2. «Другие названия» (Other names) — add synonyms and second trade names, for example the Latin and the Cyrillic form.
3. «Сайты и домены» (Websites and domains) — add each own website («Сайт») and each own mail domain («Почтовый домен»). Free mail domains (gmail.com and similar) are refused.
   - If the company has no own domain, tick «Нет своего домена (почта на общих сервисах)» (No own domain — mail on shared services). Then add the shared mailboxes and the staff addresses below.
4. «Общие ящики» (Shared mailboxes) — add shared addresses that do not belong to one person (for example `sales@…`).
5. «Адреса сотрудников» (Staff addresses) — the sign-in address of each member shows read only. Click «Добавить адрес» (Add address) to add an extra address for a member. Members can also add their own addresses on `/profile` (section 4.3).
6. «Адреса» (Addresses) — add the postal addresses of the company (city and street). If documents use two spellings (Latin and Cyrillic), add each spelling as a separate entry.

When a new entry matches companies or contacts that exist already, the block «Эти записи похожи на вашу организацию» (These records look like your organization) shows them. Click «Удалить» (Delete) for each wrong record, or «Скрыть» (Hide). Nothing is deleted automatically.

Important: a sign-in address counts as «ours» only when it is on our own domain, or when «Нет своего домена» is ticked.

### 3.4 Card «Чем мы занимаемся» (What we do)

**[Owner]**

1. «Чем занимается компания» (What the company does) — 1 to 3 sentences.
2. «Отрасль» (Industry) — select one. Optional: «Комментарий к отрасли» (Industry comment).
3. «Роль на рынке» (Market role) — select one or more chips.
4. «Продукты и услуги» (Products and services) — one item per line. Optional: link a line to the «Категории каталога» (catalogue categories).
5. «Наши клиенты» (Our customers) — customer segments.
6. «Кто продаёт нам» (Who sells to us) — supplier types. Their offers are not demand for our products.
7. «География» (Geography).
8. «Наши термины» (Our terms) — internal short names and product nicknames. Click «Добавить термин» (Add term).
9. Click «Сохранить» (Save).

### 3.5 Card «Рабочий контекст» (Working context)

**[Owner]** sets «Часовой пояс» (Time zone), «Рабочие часы» (Working hours) and «Срок задачи по умолчанию» (Default task due time) of the organization here. The default is Europe/Vienna, 08:00–18:00, on the working days of the production calendar, due time 23:59. Other members see the values read only.

**Set the time zone of the client first.** For a client in Moscow select Europe/Moscow. With the default (Vienna), the task deadlines show 2 hours later than Moscow time.

1. Click the time zone button. Type part of the name (for example «Moscow» or «Vienna»). Select the zone. The list shows the UTC offset of each zone.
2. Set the start and the end of the working day. The start must be earlier than the end.
3. Optional: change «Срок задачи по умолчанию». A new task starts today at this time; a deadline without a time (also from the AI chat) gets this time.
4. Click «Сохранить» (Save) in this card. This card has its own button; it does not save the rest of the profile.

The time zone and hours control the task deadlines (entered and shown in this zone, not in the zone of the browser), the topic lists and deadlines, the digest and reminder times, the Telegram send hours, the notification check times and «сегодня» (today) in the AI chat. A change takes effect within about one minute. The topic lists are re-computed on the next topics run.

### 3.6 Other cards on the tab

- «Профили компаний» (Company profiles): the switch «Заполнять профиль новых компаний из интернета» (Fill in the profile of new companies from the internet). Each new company then uses AI. **[Owner]** decides.
- «История изменений» (Change history): who changed which profile field.

---

## 4. Invite the members

### 4.1 Send the invitations

**[Owner]**

1. Open `/account?tab=members`.
2. Click «Пригласить» (Invite).
3. In the dialog «Пригласить пользователя в организацию» (Invite a user to the organization), type the «Адрес email» (E-mail address).
4. Click «Отправить приглашение» (Send invitation).
5. Do steps 2–4 for each person.

Notes:

- Each invited person joins with the role «Участник» (Member). The invite form has no role field.
- To change a role, click «Роль» (Role) in the member's row. Select «Новая роль» (New role): «Владелец» or «Участник». Click «Сохранить роль» (Save role).
- Under the members table, the block «Приглашения» (Invitations) lists the open invitations: e-mail, role, «Пригласил» (Invited by), «Отправлено» (Sent), «Действует до» (Valid until) with the badge «Истекло» (Expired) when the link is too old.
  - «Отправить ещё раз» (Send again) sends the e-mail again with a new validity date. An expired invitation is replaced by a new one.
  - «Отменить» (Cancel) asks for confirmation. A cancelled link stops working.
  - Inviting the same e-mail again also works (the list then shows one invitation).
- To remove a member, click «Удалить» (Remove) and confirm. The person loses access, and their Telegram binding is removed.
- The members table has the columns «Имя» (Name), «Email», «Роль» (Role), «Присоединился» (Joined) and «Действия» (Actions).

### 4.2 What the invitee does

**[Member]**

1. Open the link in the invitation e-mail (`/accept-invitation/…`).
2. The page shows «Вас пригласили» (You are invited) and «Присоединиться к <organization>».
3. If you are not signed in: type your name, click «Отправить код», type the code, click «Принять приглашение» (Accept invitation). The code goes only to the invited address.
4. If you are signed in with the invited address: click «Принять приглашение».
5. If the page shows «Не тот аккаунт» (Wrong account): click «Выйти» (Sign out), then open the link again.

Do not sign up on `/sign-up` before you accept. The sign-up form shows the warning «У вас есть активное приглашение…» (You have an active invitation) and stops.

**[Owner]** gets the notification «Новый участник» (New member) when a person joins.

### 4.3 Each member's `/profile`

**[Member]** Open «Профиль» (Profile, `/profile`): click your name in the sidebar footer.

1. Card «Данные профиля» (Profile data): check «Имя» (Name). Click «Сохранить».
2. To add a photo, click the large image («Сменить фото», Change photo). Use JPEG, PNG or WebP.
3. Card «Мои адреса для работы» (My work addresses): add each personal e-mail, Telegram name and phone that you use for work. Select Email, Telegram or «Телефон» (Phone), type the value, click «Добавить адрес» (Add address).
   - Messages from these addresses count as «ours» and do not become contacts. Your sign-in address always counts («Вход: …»).
   - Add your Telegram name here. Then your messages in client groups count as ours.
4. Card «Telegram»: connect your Telegram account (section 6.6).

Only a platform admin can change an e-mail address. For other users the e-mail is read only.

---

## 5. Sources

Sources bring the client's communication into the CRM: e-mail, Telegram, Google Chat, Google Drive, uploaded files, WhatsApp archives and AI chat notes.

### 5.1 The page «Источники данных» (Data sources, `/sources`)

| Tab | `?tab=` | Who sees it |
| --- | --- | --- |
| «Источники организации» (Organization sources) | `org` | Everybody (default). Sync buttons and the table «Материалы источников» (Source materials) |
| «Сохранённые материалы» (Stored materials) | `stored` | Owner and platform admin |
| «Статистика обработки» (Processing statistics) | `stats` | Platform admin |
| «Управление источниками организации» (Manage organization sources) | `manage` | Owner |

A person who can see only one tab sees no tab bar.

### 5.2 Source types

The type names in the product are in English.

| Type | Default name | How items arrive |
| --- | --- | --- |
| Email (Nylas) | Emails | Sync |
| Email (IMAP) | Emails | Sync |
| Google Chat | — | Sync |
| Google Drive | — | Sync |
| Files Drop Off | — | Upload by a person (default source) |
| WhatsApp Archive | — | Upload of an exported chat |
| AI Chat | — | AI chat notes and chat files (default source) |
| Telegram | Telegram Bot | Webhook (push), at once |

### 5.3 Add a source

**[Owner]**

1. Open `/sources?tab=manage`.
2. Click «Добавить источник» (Add source).
3. Find the template. Click «Добавить» (Add).
4. The new source shows in the table «Источники организации».

If the dialog shows «Нет доступных шаблонов…» (No templates available), ask the platform admin. **[Admin]** manages templates in `/settings?tab=sources` → «Шаблоны источников» (Source templates).

The table has the columns «Провайдер» (Provider), «Название» (Name), «Статус» (Status), «Авторазбор» (Auto parse), «Учётные данные» (Credentials), «Настройки» (Settings), «Синхронизация» (Last sync) and «Изм.» (edit the name and description).

### 5.4 Enter the credentials

**[Owner]**

1. In the source's row, column «Учётные данные», click «Настроить» (Configure). If credentials exist, the button is «Заменить» (Replace).
2. Fill in the fields of the type (table below).
3. Click «Сохранить». The cell shows «Настроено» (Configured).

Credentials are write-only. Nobody can read them back in the UI. To change them, type new values and save again.

| Type | Fields |
| --- | --- |
| Email (IMAP) | «Хост IMAP-сервера» (IMAP server host), «Порт» (Port), «Шифрование» (Encryption) with «Неявный TLS (порт 993)» (Implicit TLS, port 993), «Пользователь» (User), «Пароль» (Password; for Gmail and 2FA accounts use an app password) |
| Email (Nylas) | «Grant ID», «API-ключ» (API key), «API URI — регион» (API URI — region; the EU / US buttons fill it). All three values must come from the **same** Nylas application. |
| Google Chat | «JSON сервисного аккаунта» (Service account JSON), «Пользователь для имперсонации» (User to impersonate) |
| Google Drive | «JSON сервисного аккаунта» |
| Telegram | «Токен бота» (Bot token), «Секрет веб-хука» (Webhook secret) — see section 6 |

### 5.5 Provider settings

**[Owner]**

1. In the source's row, column «Настройки», click «Изменить» (Edit).
2. The dialog «Настройки провайдера — <source>» (Provider settings) opens.
3. Fill in the settings of the type:
   - IMAP: «Папка (mailbox)» (Folder).
   - Google Chat: the full path of the space. It must start with `spaces/`.
   - Google Drive: the shared drive ID.
   - Telegram: «Имя бота (необязательно)» (Bot name, optional), the AI chat block and the groups block (section 6).
4. Save.

### 5.6 «Авторазбор» (automatic processing) and status

**[Owner]** Each source has two switches in the table:

- «Статус»: «Активен» (Active) / «Неактивен» (Inactive).
- «Авторазбор»: «Вкл» (On) / «Выкл» (Off). Off means that the scheduled runs do not sync, parse or upload this source. Then the source gives no signals and no topics. Manual buttons still work.

Keep «Авторазбор» on for each source that must work automatically.

### 5.7 First sync and processing

**[Owner]** or **[Member]**

1. Open `/sources?tab=org`.
2. Optional: set the processing period with «С» (From) and «По» (To).
3. Click the button with the source name (for example «Emails»). The product syncs the source and then processes the new items (parse, then save to storage).
4. Watch the progress bar. To stop, click «Отменить» (Cancel).
5. In the table «Материалы источников», use the filter: «Требуют обработки» (Need processing), «Готово» (Done), «Ошибки» (Errors) or «Все» (All).
6. To process the remaining items, click «Обработать все (N)» (Process all). On a free plan, tick «Медленный режим (безопасно для бесплатного тарифа)» (Slow mode).

The Telegram source has no sync. Its messages arrive at once through the webhook (section 6).

### 5.8 Uploaded files and WhatsApp archives

**[Member]**

- Files: click «Загрузить файлы» (Upload files). Drop the files into the dialog «Загрузка файлов». Optional: «Описание (необязательно)» (Description). Click «Загрузить и разобрать (N)» (Upload and parse).
- WhatsApp: first, the owner adds a WhatsApp Archive source (section 5.3). Then click «Загрузить архив WhatsApp» (Upload WhatsApp archive). Select the exported folder (with `_chat.txt` and the media files). Click «Импортировать и разобрать (N)» (Import and parse).

### 5.9 «Исключения из анализа» (Analysis exclusions)

Use exclusions for addresses, domains and chats that the product must never analyse and never send to the AI (for example private mail, HR, the bank).

**[Owner]**

1. Open `/sources?tab=manage`. Go to the card «Исключения из анализа».
2. Select the kind: «Адрес» (Address), «Домен» (Domain) or «Чат» (Chat). For a chat, also select Telegram, WhatsApp or Google Chat.
3. Type the value. Optional: «Примечание (необязательно)» (Note).
4. Click «Добавить» (Add).

Rules:

- A message is excluded when **any** address or chat on it matches (sender, recipients, copy, participants). A domain also matches its subdomains.
- New excluded messages are not stored. Messages stored before are skipped at parse, with no AI call.
- When you remove an exclusion, skipped items do not come back by themselves. Re-parse them.

### 5.10 What runs automatically

| Run | Schedule in the code | What it does |
| --- | --- | --- |
| Daily pipeline (`/api/cron/daily`) | 03:00 UTC | AI model prices and costs, AI chat notes into sources, then sync → parse → upload of all sources with «Авторазбор» on |
| Topics run (`/api/cron/topics`) | Hourly. **Current test deployment: once a day, 08:00 UTC** | Only for organizations in topics mode «Тень» or «Включено»: sync and parse of new items, signals, topics, CRM checks, attention, cards, deals, deal state, delivery, Telegram pushes |
| Notification checks (`/api/cron/notifications`) | Hourly at :15. **Current test deployment: once a day, 09:00 UTC** | Task reminders, AI limit notices, profile reminders, failing sources, Telegram copies held outside working hours |

The test deployment is on the Vercel Hobby plan. Hourly crons need the Pro plan (`docs/todo/README.md`, item D8).

---

## 6. Telegram

The Telegram bot does three jobs:

- It brings client messages into the CRM (groups with the bot, and messages forwarded to the bot).
- It gives each member the AI chat in a private chat with the bot (when the owner switches it on).
- It sends topic pushes and copies of important notifications to each member who connected their Telegram.

Each organization uses its **own** bot.

### 6.1 Create the bot

**[Owner]**

1. In Telegram, open @BotFather.
2. Send `/newbot`. Give the bot a name and a user name.
3. Copy the bot token.
4. For groups: send `/setprivacy`, select the bot, select **Disable**. Without this step the bot sees in groups only commands, replies to the bot and @mentions.

### 6.2 Make a webhook secret

**[Owner]** Make a long random string. Allowed characters: A–Z, a–z, 0–9, `_` and `-`. Example command: `openssl rand -hex 32`.

### 6.3 Configure the Telegram source

Precondition: **[Admin]** the deployment has `NEXT_PUBLIC_APP_URL` set to the public HTTPS address of the app. Without it, the webhook is not registered when the credentials are saved.

**[Owner]**

1. Open `/sources?tab=manage`. Click «Добавить источник». Add the Telegram template.
2. In the Telegram row, column «Учётные данные», click «Настроить».
3. Paste the token into «Токен бота» (Bot token).
4. Paste the secret into «Секрет веб-хука» (Webhook secret).
5. Click «Сохранить». The product shows «Учётные данные сохранены — веб-хук зарегистрирован в Telegram» (Credentials saved — webhook registered in Telegram).
6. Column «Настройки» → «Изменить». In «Настройки провайдера», optional: type «Имя бота (необязательно)» (the bot's user name without `@`).
7. Check the block «Группы» (Groups). It must show «Бот читает все сообщения групп.» (The bot reads all group messages.) If it shows a warning, do step 6.1-4, remove the bot from each group and add it again.

If you change the privacy mode later, or the code gets new bot features, save the credentials again. This registers the webhook again.

### 6.4 Switch on the AI chat in Telegram

**[Owner]**

1. Open the Telegram source → «Настройки» → «Изменить» («Настройки провайдера»).
2. Switch on «ИИ-чат в Telegram» (AI chat in Telegram). Default: off.
3. The list «Привязанные сотрудники (N)» (Bound staff) shows who connected Telegram. «Отвязать» (Unbind) removes a person.

When the switch is off, the bot does not answer questions. It saves a member's private messages as notes («✅ Получено.», Received). Notifications still arrive.

Note: CRM data (names, amounts, phones) becomes visible in Telegram. Telegram is a cloud chat without end-to-end encryption.

### 6.5 Groups with clients

**[Owner]** or **[Member]**

1. Make a Telegram group with the client. Add the bot to the group.
2. Owners get the notification «Бот добавлен в чат» (Bot added to a chat).
3. **[Owner]** Open the Telegram source → «Настройки провайдера» → «Группы». The group shows there, maybe with a suggestion «Похоже на компанию «X»…» (Looks like company X). Click «Привязать» (Link) or «Нет» (No).
4. To link by hand, select the mode of the chat: «Авто (по авторам)» (Auto, by authors), «Компании» (Companies) or «Внутренний чат» (Internal chat). For «Компании», click «Добавить компанию» (Add company). Click «Сохранить».
5. Optional: switch on «Не анализировать» (Do not analyse) for a chat that the product must ignore.

Who links: the owner, or the «Ответственный» (Responsible) of each company in the chat. Only the owner sets «Внутренний чат».

You can also link from the company card: block «Telegram» → type «@имя или ссылка t.me» (@name or t.me link) or select «Или выберите чат бота» (Or select a bot chat) → «Добавить» (Add).

Rules:

- The bot **never answers in a group**.
- Channels are not supported. Owners get «Бот добавлен в канал» (Bot added to a channel).
- The bot does not see private chats between staff and clients. A member forwards an important client message to the bot. It is saved as the client's message.
- Files above 20 MB are not downloaded (Telegram limit).
- A new author in a linked group gives the proposal «Новые контакты из Telegram» (New contacts from Telegram) on the company card: «Создать контакт» (Create contact), «Это существующий контакт» (Existing contact) or «Не контакт» (Not a contact).

### 6.6 Each member connects Telegram

**[Member]**

1. Open `/profile`. Go to the card «Telegram».
2. Click «Подключить Telegram» (Connect Telegram).
3. Click «Открыть Telegram» (Open Telegram). Or copy the link and open it on the phone.
4. In the bot chat, press **Start** («Старт»).
5. The bot answers «Готово. Telegram привязан к CRM.» (Done. Telegram is linked to the CRM.)
6. In the CRM, click «Проверить» (Check). The card shows «Привязан: …» (Linked) and «Бот может присылать вам сообщения» (The bot can send you messages).

Rules:

- The link is valid for 15 minutes and works one time only. If it fails, click «Подключить Telegram» again.
- One Telegram account belongs to one member. An account that is bound to another member is refused.
- To disconnect: «Отвязать» on `/profile`, or send `/stop` to the bot.

If the card shows «В организации не подключён Telegram-бот.» (No Telegram bot in the organization), the owner did not configure the Telegram source yet.

### 6.7 What the bot does in a private chat

| Command or action | Result |
| --- | --- |
| A question (text, voice or file) | AI answer with links to records (when «ИИ-чат в Telegram» is on) |
| «Сохрани контакт» with a business card photo | A card with «Создать» (Create); the record is created only after the button |
| `/new` | «Новый разговор. Спрашивайте.» — a new conversation |
| `/help` | Help text, with the part «Переписка с клиентами в CRM» (Client messages in the CRM) |
| `/stop` | «Telegram отвязан от CRM…» — unbinds the account |

The bot also sends:

- Copies of **important** notifications (section 9), in working hours.
- Topic pushes, when topics mode is «Включено»: one message per topic that enters «Сейчас» (Now), with «Открыть» (Open), «✅ Готово» (Done) and «⏰ Отложить до завтра» (Snooze until tomorrow). Only in working hours, max 2 messages per topic in 7 days.

### 6.8 Check that Telegram works

Use the tester guide `docs/specs/telegram/06-test-guide.md`. Minimum check:

1. **[Member]** Connect Telegram (6.6).
2. **[Member]** Send «Сколько открытых сделок?». Expected: «Думаю…», then an answer.
3. **[Owner]** Add the bot to a test group. Expected: the group shows in «Группы».
4. **[Member]** Send a PDF in the group. Expected: the file is in «Документы» (Documents) of the linked company. The bot does not answer in the group.

---

## 7. CRM settings

### 7.1 Companies and contacts

- «Компании» (Companies, `/clients`) has the tabs «Клиенты» (Customers), «Потенциальные» (Prospects), «Поставщики» (Suppliers), «Партнёры» (Partners) and «Не определено» (Not classified).
- «Новая компания» (New company) adds one company. «Найти в источниках» (Find in sources) finds companies and contacts in the parsed sources. «Поиск в интернете» (Web search) on a company fills in its missing website, e-mail, phone and address from the web (one company at a time; the batch «Обогатить» button was removed 2026-11-21). «Заполнить из интернета» (Fill from the internet) in «Профиль компании» also fills the empty website, e-mail, phone and address when it finds exactly one company.
- A company or contact found automatically has the status «Новая» / «Новый» (New). When a person saves its card with a change, the status becomes «Активная» / «Активный» (Active). No manual switch is needed.
- «Контакты» (Contacts, `/contacts`): «Новый контакт» (New contact). «Дубли Telegram (N)» (Telegram duplicates) merges contacts with the same Telegram account.

Recommended order for a new client:

1. **[Owner]** Complete the profile and the identity registry first (section 3). Then the discovery does not create our own company as a client.
2. **[Owner]** Fill in the blocklist (7.3).
3. **[Owner]** or **[Member]** After the first sync, click «Найти в источниках». Check the proposals. Create the companies and contacts that are real.
4. **[Owner]** Optional: on «Источники» (Sources) → «Управление» (Manage) → «Автоматическая обработка» (Automatic processing), switch on «Создавать компании и контакты автоматически» (Create companies and contacts automatically). Then after each automatic parse the product creates the companies, contacts and links that the dialog checks by default. Doubtful finds stay for «Найти в источниках». Do step 1 and 2 first.

### 7.2 Custom fields («Поля», Fields)

**[Owner]**

1. On `/clients` (company fields) or `/contacts` (contact fields), click the icon button «Настроить поля» (Configure fields).
2. In «Поля компаний» (Company fields) or «Поля контактов» (Contact fields), click «Новое поле» (New field).
3. Fill in «Название поля» (Field name) and «Тип» (Type). Types: «Текст», «Число», «Сумма», «Дата», «Список (один вариант)», «Список (несколько)», «Да / нет», «Ссылка», «Email», «Телефон».
4. Optional: «Подсказка» (Hint), «Раздел» (Section), «Показывать» (Show), «Показывать в списке» (Show in the list — a column in the list).
5. Click «Создать» (Create).

**[Member]** fills in the values in the tab «Поля» of the company or contact card. Max 50 fields per entity.

Standard fields are there for every organization, no set-up (since 2026-11-26): at the top of «Поля» of a company — «Реквизиты» («Юридическое название», «Юридический адрес», «ИНН», «КПП», «ОГРН») and «Банковские реквизиты» («Расчётный счёт», «Наименование банка», «БИК», «Корр. счёт банка»); of a contact — «День рождения». Do not create custom fields with these names. The product checks the format (for example ИНН = 10 or 12 digits). On the birthday of a contact the product shows a card in «Сейчас» on «Домашняя» (topics mode «Включено»).

### 7.3 «Список блокировки» (Blocklist)

Use it for companies, people, domains and addresses that are not clients (for example services, newsletters, platforms).

**[Owner]**

1. On `/clients`, click the icon button «Список блокировки» (last in the toolbar).
2. Select the kind: «Компания» (Company), «Домен» (Domain), «Email» or «Человек» (Person).
3. Type the value. Optional: «Примечание (необязательно)».
4. Click «Добавить».

The product hides matching companies and contacts at once. «Найти в источниках» does not propose them again. When you remove an entry, hidden records do not come back by themselves.

### 7.4 «Ответственный» (Responsible) and «Также отвечают» (Also responsible)

- A new company gets the creator as «Ответственный».
- **[Owner]** sets the responsible person in the company card: field «Ответственный» → select a member. In «Также отвечают:», click «+ Добавить» (Add) to add more members.
- **[Member]** who is responsible but not an owner can click «Передать владельцу» (Hand over to the owner). The owner gets «Компания передана вам» (Company handed over to you).
- The responsible person is the default owner of the company's deals and topics, and gets the company's proposals.

### 7.5 Deal funnel and deal types

**[Owner]**

1. Open «Сделки» (Deals, `/deals`).
2. Click the icon button «Настройки воронки» (Funnel settings).
3. Optional: click «Начать с шаблона» (Start from a template). Select «Продажи B2B (стандарт)» (B2B sales, standard) or «Тендеры и конкурсы (5 стадий)» (Tenders, 5 stages).
4. Tab «Стадии» (Stages): check the names, roles, entry conditions and probabilities. «Добавить стадию» (Add stage).
5. Tab «Типы сделок» (Deal types): «Добавить тип» (Add type).
6. Tab «Причины» (Reasons): reasons for lost, no-go and withdrawn deals.
7. Tab «Правила входа» (Entry rules): «Сделка создаётся по сигналу клиента (по правилам)» (by rules) or «Решение go / no-go перед воронкой» (go / no-go decision first).
8. Optional: click «Проверить на данных» (Check on data). This is a dry run over the last 30 days.
9. Click «Сохранить».

Other members see the dialog read only. The icon button «Типы сделок» opens the same dialog on the deal types tab.

---

## 8. Topics and signals (platform admin)

The topics engine reads the signals in the sources and makes topics, cards, deal proposals and digests. It is off for a new organization. Keep this short list; the full runbook is `docs/specs/topics/07-signals-go-live.md`.

**[Admin]** on `/settings`:

1. Check that the owner completed «Профиль организации» (column «Профиль» = «Заполнен» on «Организации» or «Темы»).
2. «Сигналы» (Signals) → select the organization in the toolbar → tab «Организация · <name>» → card «Пакеты организации» (Organization packs): switch on the pack `base`.
3. Same tab → «Правила стадий» (Stage rules) → «Скопировать шаблон правил» (Copy the rule template). Map each template stage to a stage of the organization funnel in «Сопоставление стадий». Click «Скопировать».
4. «Темы» (Topics) → «Режим тем по организациям» (Topics mode per organization) → set the organization to «Тень» (Shadow: the engine runs, users see nothing).
   - If the profile is not complete, the dialog «Профиль организации не заполнен» opens. You can type «Причина включения без профиля» and click «Включить без профиля» (Switch on without profile). Use this only for test organizations.
5. «Темы» → «Запуски» (Runs) → «Запустить сейчас» (Run now). Check that a run row shows success.
6. Review the shadow results for 1–2 weeks on «Тесты и отладка» (Tests and debugging).
7. Set the mode to «Включено» (On). Users then see the lists «Сейчас» (Now), «Сводка» (Digest), «Неделя» (Week) and «Все темы» (All topics) on «Домашняя».
8. Optional: «Темы» → «Проверки CRM» (CRM checks) → select the organization → «Проверить без записи» (Check without writing). If the result is good, switch on «Проверки по заказам» (Order checks) and «Сторожа по переписке» (Communication watchdogs). Both are off by default. The third switch, «Контакты (дни рождения)» (Contacts, birthdays), is ON by default: a card in «Сейчас» on the birthday of a contact.
9. «Темы» → «Рассылка» (Delivery) → select the organization:
   - «Рассылка тем по почте для этой организации» (Topic e-mail for this organization) — default **off**. Check first with «Показать письмо» (Show e-mail) and «Отправить мне тестовое письмо» (Send me a test e-mail).
   - «Сообщения о темах в Telegram» (Topic messages in Telegram) — default on. Test with «Тест в Telegram (мне)» (Telegram test, to me).

Other switches in «Режим тем по организациям»: «Профиль в промптах» (Profile in prompts) — switch on after an eval on the golden set; «Чат в сигналах» (Chat in signals) — switch on after a review of chat notes in shadow mode.

To stop: set the mode to «Выключено» (Off).

---

## 9. Notifications

### 9.1 The bell

**[Member]**

1. Click the bell «Уведомления» (Notifications) in the page header. A red badge means an unread important notification.
2. Select the tab «Все» (All) or «Важные» (Important).
3. Optional: select a category («Все категории», All categories).
4. Per item: «Отметить прочитанным» (Mark as read) or «Скрыть» (Hide). For all: «Прочитать все» (Read all).

Info notifications expire after 3 days, important ones after 5 days.

Categories: «Задачи» (Tasks), «Сделки и темы» (Deals and topics), «Компании и контакты» (Companies and contacts), «ИИ и лимиты» (AI and limits), «Процессы и источники» (Processes and sources), «Организация» (Organization), «Оплата» (Billing), «Платформа» (Platform).

### 9.2 What arrives to whom

| Recipient | Examples |
| --- | --- |
| The person concerned | «Вам назначена задача» (Task assigned to you), «Срок задачи завтра» / «Срок задачи сегодня» (Task due tomorrow / today), «Задача просрочена» (Task overdue), «Компания передана вам», «Контакт сменил компанию?» (Contact changed company?), «Новый риск по сделке» (New deal risk), «Тема требует внимания» (Topic needs attention), «Клиент подтвердил заказ» (Client confirmed the order), «Telegram привязан» |
| Organization owners | «Лимит ИИ: 70 %», «Лимит ИИ: 90 %», «Лимит ИИ исчерпан», «Дневной бюджет ИИ исчерпан», «Профиль организации не заполнен», «Новый участник», «Источник не синхронизируется» (Source does not sync), «Ошибка обработки» (Processing error), «Бот добавлен в чат», «Чат Telegram — это компания?» |
| Platform admins | «Ошибка синхронизации моделей» (Model sync error), «Ошибка фонового запуска» (Background run error) |

### 9.3 Settings on `/account?tab=notifications`

**[Member]** Each person sets their own choices for the active organization.

1. Card «Уведомления в приложении» (In-app notifications): one row per category.
   - Column «В приложении» (In the app): switch the category on or off. Some categories show «Важные приходят всегда» (Important ones always arrive).
   - Column «Telegram»: a copy of the important notifications of this category in Telegram, in working hours. It works only after you connect Telegram (`/profile` → «Telegram»).
2. Card «Уведомления по темам» (Topic notifications) — only when topics mode is «Включено»:
   - «Утренняя сводка» (Morning digest).
   - «Итоги недели» (Weekly summary).
   - «Вечерние напоминания» (Evening reminders).
   - «Темы в Telegram» (Topics in Telegram).

Topic e-mails go to the profile address. They are sent only when the platform admin switched on the e-mail delivery for the organization (section 8, step 9).

---

## 10. AI usage and limits

### 10.1 Owner view: `/account?tab=ai-usage`

**[Owner]**

1. Open `/account?tab=ai-usage` («Использование ИИ»).
2. Read the card «Месячный лимит ИИ» (Monthly AI limit): spend of this month, the limit, what is left and the reset date.
3. Use the filters: period («7 дней», «30 дней», «Этот месяц», «Прошлый месяц», «Свой период»), «Все функции» (All functions), «Все модели» (All models), «Все пользователи» (All users), status («Остановлено лимитом», Stopped by the limit, and others).
4. Read the tiles «Вызовы ИИ» (AI calls), «Токены» (Tokens), «Стоимость» (Cost), «За вызов» (Per call), «Ошибки» (Errors), and the cost chart.
5. Use the tabs «Функции» / «Модели» / «Пользователи» (Functions / Models / Users). The row «Фоновая обработка» (Background processing) is work without a user (source parsing, topics).

All amounts are in USD and include our markup. A new cost can be an estimate first; the exact amount comes within one day.

Limit states (monthly, in USD with markup, per calendar month UTC):

| Spend | What happens |
| --- | --- |
| From 70 % | Info banner on the other `/account` tabs; notification «Лимит ИИ: 70 %» |
| From 90 % | Amber warning; notification «Лимит ИИ: 90 %» (important) |
| 100 % | Background AI stops (source parsing, topics). **The AI chat also stops** (web and Telegram): «Месячный лимит ИИ вашей организации исчерпан. Чат снова будет доступен с … или после увеличения лимита администратором платформы.» Other functions that a person starts still run. The limit resets on the 1st of the next month (UTC). |

Note: at 100 % of the monthly limit the AI chat stops too (in the app and in Telegram) until the limit resets. The daily budget stops only background work; the chat keeps working.

The daily budget is separate (10.2). When it is used up, owners see «Дневной лимит ИИ исчерпан…» without amounts. Background processing continues the next day.

### 10.2 Platform admin: `/settings?tab=ai-usage`

**[Admin]**

1. Open `/settings?tab=ai-usage` («Использование ИИ»).
2. The statistics show all organizations: «Себестоимость» (gateway cost) and «С наценкой» (with markup, what clients see). Filter by «Все организации», «Все процессы», «Все модели».
3. Card «Лимиты ИИ по организациям» (AI limits per organization):
   - «Дневной бюджет по умолчанию, $ (шлюз)» (Default daily budget, gateway cost) — default 5 USD. It stops only background AI.
   - «Месячный лимит по умолчанию, $ (с наценкой)» (Default monthly limit, with markup) — default 20 USD.
   - Per organization: «Свои лимиты, $ (день / месяц)» (Own limits, day / month). Empty = default. 0 = no background AI.
   - Click «Сохранить».
4. Card «Наценка» (Markup): «Наценка, %». It applies to new calls only.
5. If the daily run did not run, click «Синхронизировать цены и стоимость» (Sync prices and costs).

Set the limits for a new client before you connect large mailboxes. The first sync and parse of a large mailbox can use a large part of the budget.

### 10.3 Models and processes

**[Admin]**

- «Модели» (Models): the model catalog with prices.
- «Процессы ИИ» (AI processes): which model each process uses («Основная модель», main model; «Резервные», fallbacks). Changes take effect within 1 minute. The card «Правила выбора моделей» (Model selection rules) sets «Только с нулевым хранением данных (ZDR)» (zero data retention only), «Только без обучения на данных» (no training on data only) and «Разрешённые разработчики» (allowed developers) for all processes.

---

## 11. First week checklist

| # | Step | Who | Where | Done when |
| --- | --- | --- | --- | --- |
| 1 | Owner signs up | Owner | `/sign-up` | The new organization opens on «Домашняя» |
| 2 | Real organization name and data | Owner | `/account?tab=info` | «Данные организации сохранены» |
| 3 | Organization profile minimum | Owner | `/account?tab=org-profile` | «Профиль заполнен на 6 из 6» |
| 4 | Identity registry (names, domains, shared mailboxes, addresses) | Owner | `/account?tab=org-profile` → «Кто мы» | All own domains and names are listed |
| 5 | AI limits for the organization | Admin | `/settings?tab=ai-usage` → «Лимиты ИИ по организациям» | Daily and monthly limits are set |
| 6 | Invite staff | Owner | `/account?tab=members` | Each person shows in «Участники» |
| 7 | Staff add their work addresses | Member | `/profile` → «Мои адреса для работы» | Personal e-mail / Telegram / phone added |
| 8 | Add and configure the mail source | Owner | `/sources?tab=manage` | «Учётные данные» = «Настроено», «Авторазбор» = «Вкл» |
| 9 | Exclusions | Owner | `/sources?tab=manage` → «Исключения из анализа» | Private and sensitive addresses are excluded |
| 10 | First sync and processing | Owner | `/sources?tab=org` | «Требуют обработки» shows 0, «Ошибки» is empty |
| 11 | Telegram bot (privacy off, credentials) | Owner | @BotFather, `/sources?tab=manage` | «Бот читает все сообщения групп.» |
| 12 | AI chat in Telegram on | Owner | Telegram source → «Настройки провайдера» | Switch «ИИ-чат в Telegram» is on |
| 13 | Staff connect Telegram | Member | `/profile` → «Telegram» | «Бот может присылать вам сообщения» |
| 14 | Client groups linked to companies | Owner / responsible | «Группы» or company card → «Telegram» | Each group shows its company |
| 15 | Blocklist | Owner | `/clients` → «Список блокировки» | Non-clients are listed |
| 16 | Companies and contacts from sources | Owner / Member | `/clients` → «Найти в источниках» | Real companies are created |
| 17 | Responsible persons | Owner | Company card → «Ответственный» | Key companies have a responsible person |
| 18 | Custom fields | Owner | `/clients`, `/contacts` → «Настроить поля» | Needed fields exist |
| 19 | Deal funnel and deal types | Owner | `/deals` → «Настройки воронки» | Funnel saved |
| 20 | Signals pack and stage rules | Admin | `/settings?tab=signals` | `base` pack on, rules copied |
| 21 | Topics mode «Тень» | Admin | `/settings?tab=topics` | A successful run in «Запуски» |
| 22 | Notification choices | Member | `/account?tab=notifications` | Categories and Telegram copies set |
| 23 | Check AI spend after the first sync | Owner / Admin | `/account?tab=ai-usage`, `/settings?tab=ai-usage` | Spend is inside the limits |

After 1–2 weeks of shadow mode: **[Admin]** sets topics mode «Включено» and the delivery switches (section 8).

---

## 12. Troubleshooting

| Problem | Cause | Fix |
| --- | --- | --- |
| The owner signed up but has no organization | The e-mail had a pending invitation | Open the invitation link and accept it, or ask the inviter to invite again |
| An invited person cannot sign up | `/sign-up` stops when an invitation is pending | Use the link in the invitation e-mail |
| The new organization has no sources | No source templates on the deployment | **[Admin]** adds templates in `/settings?tab=sources` → «Шаблоны источников»; the owner adds sources with «Добавить источник» |
| A member sees data of the wrong organization | The person is in two organizations; the sign-in picked the other one | A platform admin uses «Сменить организацию»; other users: keep one organization per account |
| Nylas sync fails with 404 `grant.not_found` | Grant ID and API key come from different Nylas applications | Enter all three values (Grant ID, API key, API URI) of the same Nylas application again |
| IMAP sync fails on Gmail | Normal password with 2FA | Use an app password |
| A source gives no signals or topics | «Авторазбор» is «Выкл», or «Статус» is «Неактивен» | Switch both on in `/sources?tab=manage` |
| Items show as skipped | An exclusion matched (`excluded: …`) | Check «Исключения из анализа»; after you remove an entry, re-parse the items |
| Our own company shows up as a client | Identity registry not complete | Add names, domains, mailboxes and addresses in «Кто мы»; delete the wrong records in «Эти записи похожи на вашу организацию» |
| Telegram: credentials saved, but no messages arrive | `NEXT_PUBLIC_APP_URL` is not a public HTTPS address, so the webhook was not registered | **[Admin]** sets `NEXT_PUBLIC_APP_URL`, deploys again; the owner saves the bot credentials again |
| Telegram: webhook works, but nothing is visible | The person looks at another active organization | Check the organization in the sidebar footer |
| Telegram: the bot does not see group messages | Privacy mode is on | @BotFather → `/setprivacy` → Disable; remove the bot from the group and add it again; save the credentials again |
| Telegram: buttons or `/new` do not work after an update | The webhook still has the old update list | Save the bot credentials again |
| Telegram: «Ссылка устарела или уже использована…» | The link is older than 15 minutes or was used | Click «Подключить Telegram» again |
| Telegram: «Этот Telegram уже привязан к другому сотруднику организации» | The account is bound to another member | The owner unbinds it in «Привязанные сотрудники» |
| Telegram: the bot only answers «✅ Получено.» | «ИИ-чат в Telegram» is off | The owner switches it on |
| Telegram: no messages from the bot | The member blocked the bot | Unblock the bot in Telegram; the next message makes the binding active again |
| AI chat: «Месячный лимит ИИ вашей организации исчерпан…» (HTTP 402) | Monthly limit reached | **[Admin]** raises the organization's monthly limit, or wait for the 1st of the next month (UTC) |
| Parsing and topics stop in the middle of the day | Daily budget reached («Дневной бюджет ИИ исчерпан») | Wait for the next UTC day, or **[Admin]** raises the daily budget |
| Topics mode cannot be switched to «Тень» | Profile minimum not complete (dialog «Профиль организации не заполнен») | The owner completes the profile; for a test organization use «Включить без профиля» with a reason |
| No topic e-mails | Mode is not «Включено», or «Рассылка тем по почте для этой организации» is off, or the member switched the digest off | Check section 8, step 9, and `/account?tab=notifications` |
| Notifications or topics come only once a day | Test deployment on Vercel Hobby: crons run daily | Move to the Pro plan and set the crons back to hourly (`docs/todo/README.md`, D8) |
