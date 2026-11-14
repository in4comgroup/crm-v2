// ru-mail — deterministic Russian/English mail helpers for the topics engine
// (spec docs/specs/topics/01-specification.md §5.2 gates 4–7, §10.1 "Deterministic patterns").
// Pure functions: no DB, no network, no `server-only`; safe in any runtime.
//
//   stripReplyPrefixes / splitQuotedHistory / detectForward   quotes.ts
//   detectBounce                                              bounce.ts
//   detectOutOfOffice / detectCalendarReply                   ooo.ts
//   parseMoneyRu                                              money.ts
//   isAutomatedSender / isFreemailDomain                      senders.ts
//   extractEmailAddress, MailProbe, RU_MONTHS_GENITIVE        common.ts
//
// Relative dates resolve against `MailProbe.date` (the item date), never "today".
// Heuristics lean on header-like line shapes to avoid prose false positives.

export { extractEmailAddress, RU_MONTHS_GENITIVE, type MailProbe } from "./common"
export { stripReplyPrefixes, splitQuotedHistory, detectForward } from "./quotes"
export { detectBounce } from "./bounce"
export { detectOutOfOffice, detectCalendarReply } from "./ooo"
export { parseMoneyRu, type MoneyAmount } from "./money"
export { isAutomatedSender, isFreemailDomain } from "./senders"
