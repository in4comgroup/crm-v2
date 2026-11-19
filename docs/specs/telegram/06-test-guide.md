# Telegram — guide for testers

Status: 2026-11-19. For colleagues who test the Telegram bot and the AI chat in Telegram. The full check list for the developer is [05-finalization.md](05-finalization.md) §3.4.

Test deployment: https://crm-v2-nu-two.vercel.app — organization «salesdaily», bot `@salesdaily_test_bot`.

## 1. Before you start

- You must be a member of the organization «salesdaily». The owner invites you: /account → «Участники» (Members) → invite. Sign in with the code from the email.
- The CRM must show «salesdaily» as the active organization (top left).
- Use the Telegram app on your phone. Telegram on a computer also works.

## 2. Connect your Telegram account

1. In the CRM: /profile → card «Telegram» → «Подключить Telegram» (Connect Telegram).
2. Click «Открыть Telegram» (Open Telegram). Telegram opens the chat with the bot. (Or copy the link and open it on the phone.)
3. In Telegram, press **Start** («Старт»).
4. The bot answers «Готово. Telegram привязан к CRM.» (Done. Telegram is linked to the CRM.)
5. In the CRM, click «Проверить» (Check). The card shows «Привязан: @your_name» and «Бот может присылать вам сообщения».

Rules:
- The link is valid for 15 minutes and works one time only. If it does not work, click «Подключить Telegram» again.
- One Telegram account = one CRM user. A Telegram account that is linked to another user is refused.
- To disconnect: «Отвязать» on /profile, or send `/stop` to the bot.

If the bot does not answer after **Start**, tell the developer (the bot is maybe not connected to the deployment).

## 3. What the bot does — main use cases and tests

Write down the test number, the time and what you saw. Send a screenshot when the result is not as expected.

### 3.1 AI chat in Telegram (your private chat with the bot)

The owner must switch on «ИИ-чат в Telegram» (AI chat in Telegram): /sources → «Управление источниками организации» → bot row → settings → «Настройки провайдера». When it is off, the bot only saves your messages as notes (3.2).

| # | Do | Expected |
|---|---|---|
| 1 | Ask «Сколько открытых сделок?» | «Думаю…», then an answer. Links «открыть» open the record in the CRM |
| 2 | Ask about one company: «Что по компании <name>?» | A short answer and a list of records with links |
| 3 | Ask «Выручка по месяцам» | A table; button «📎 CSV» sends a CSV file |
| 4 | Send a voice message with a question | The bot shows what it heard and answers |
| 5 | Send a long text in parts (paste a long mail) | One answer for all parts |
| 6 | Send a photo of a business card (or a card text) and write «сохрани контакт» | A card with the values and «Создать». Press it: «✅ Создано …» and the record is in the CRM. A second press does not make a second record |
| 7 | Write «Поставь мне задачу позвонить <name> завтра в 11» | A task card; after «Создать» the task is in /tasks with the correct date and time |
| 8 | Reply (Telegram «Reply») to an answer of the bot with «а подробнее?» | The answer is about that earlier answer |
| 9 | Send a PDF or a photo of a document and ask about it | The answer uses the text of the file |
| 10 | Send `/new` | «Новый разговор» — the bot forgets the earlier questions |
| 11 | Send `/help` | Help text, with the part «Переписка с клиентами в CRM» |
| 12 | Open the CRM chat panel (AI chat) | The Telegram conversation is in the chat list with a Telegram icon |

### 3.2 Notes and client messages into the CRM

| # | Do | Expected |
|---|---|---|
| 13 | Owner switches the AI chat OFF. Send «Звонил Петру из Альфы, просит КП до пятницы» | The bot answers «✅ Получено.»; the note is in /sources → «Источники организации» → bot. Owner switches the AI chat ON again |
| 14 | A client wrote to you in a private chat. **Forward** that message to the bot and add «что ответить?» | An answer from the AI chat AND the message is saved in the CRM as the client's message |

The bot does not see your private chats with clients. Only forwarded messages and groups with the bot reach the CRM.

### 3.3 Groups with clients

Needs a second Telegram account as the «client» and a CRM contact with that account's @name in «Адреса» (addresses).

| # | Do | Expected |
|---|---|---|
| 15 | Make a group «<Компания> / Мы», add the client account and the bot | Owners get the notice «Бот добавлен …»; /sources → bot → «Группы» shows the group, maybe with a company suggestion |
| 16 | Link the group to the company in «Группы» (owner or the company's «Ответственный») | The company card → block «Telegram» shows the group |
| 17 | The client writes in the group; you write in the group | The client's message is linked to the contact and the company; yours is marked as ours. **The bot never answers in a group** |
| 18 | A third account with no CRM contact writes | The company card suggests «Новый контакт в …?» |
| 19 | Send a PDF in the group | The file is in the company's «Документы» |

### 3.4 Notifications and topic pushes

| # | Do | Expected |
|---|---|---|
| 20 | Make a task for yourself with a due date in the past, priority important | In the next notification run: a message «❗ …» from the bot. /account → «Уведомления» → the Telegram switch stops it |
| 21 | (Topics mode «on» only) A topic of yours enters «Сейчас» in working hours (08:00–18:00 Vienna) | One message with «Открыть», «✅ Готово», «⏰ Отложить до завтра». A button changes the topic and the message |

On the test deployment the automatic runs happen once a day (topics 08:00 UTC, notifications 09:00 UTC). The developer can start a run by hand.

### 3.5 Limits and guards

| # | Do | Expected |
|---|---|---|
| 22 | Make the bot an admin of a Telegram **channel** | Owners get «Бот добавлен в канал … Каналы не поддерживаются»; the channel is not in «Группы» |
| 23 | Send a file > 20 MB | «⚠️ Файл больше 20 МБ …» |
| 24 | Send `/stop` | «Telegram отвязан …»; /profile shows «Подключить Telegram». Connect again (§2) |
| 25 | A Telegram account that is not linked writes to the bot | No AI answer; the message is saved as an incoming message |

## 4. Not in scope (do not report as errors)

- The bot does not read private chats between you and a client (no Telegram Business).
- Channels are not supported.
- Files above 20 MB are not downloaded (Telegram limit).
