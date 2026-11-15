// Platform funnel templates (docs/specs/funnel/01-specification.md §3.7).
// SOURCE of the `funnel_template` rows seeded by
// `migrations/0038_funnel_codes_and_templates.sql`: the migration carries the
// SAME JSON (`templates.test.ts` reads the migration and compares, so the two
// never drift). A change here = a NEW migration that updates the rows; never
// edit an applied migration. Generic words only: no company, branch or city.
// Client-safe, no DB.

import type { FunnelConfig, FunnelRule, FunnelStageConfig } from "./config"

export type FunnelTemplateSource = {
  code: string
  labelRu: string
  description: string
  sort: number
  config: FunnelConfig
}

type RuleArgs = Partial<Pick<FunnelRule, "dealTypes" | "requiresConfirmation" | "minConfidence">>

const rule = (signal: string, effect: FunnelRule["effect"], stage: string | null, a: RuleArgs = {}): FunnelRule => ({
  signal,
  effect,
  stage,
  dealTypes: a.dealTypes ?? [],
  requiresConfirmation: a.requiresConfirmation ?? false,
  minConfidence: a.minConfidence ?? "medium",
  enabled: true,
})

/** A client action that opens an opportunity. */
const create = (signal: string, stage: string, a: RuleArgs = {}) => rule(signal, "create_deal", stage, a)
/** A forward move: «high» so a medium-confidence signal asks a person first. */
const move = (signal: string, stage: string) => rule(signal, "move_stage", stage, { minConfidence: "high" })
const inStage = (signal: string) => rule(signal, "in_stage", null)
const won = (signal: string) => rule(signal, "outcome_won", null, { minConfidence: "high" })
const lost = (signal: string) => rule(signal, "outcome_lost", null, { minConfidence: "high", requiresConfirmation: true })
const pause = (signal: string) => rule(signal, "pause", null, { requiresConfirmation: true })

type StageArgs = Pick<FunnelStageConfig, "code" | "name" | "role" | "probability"> &
  Partial<Pick<FunnelStageConfig, "description" | "entryCondition" | "signalsHint" | "inForecast" | "probabilityMode">>

const stage = (s: StageArgs): FunnelStageConfig => ({
  code: s.code,
  name: s.name,
  role: s.role,
  description: s.description ?? null,
  entryCondition: s.entryCondition ?? null,
  signalsHint: s.signalsHint ?? null,
  inForecast: s.inForecast ?? s.role === "active",
  probabilityMode: s.probabilityMode ?? "stage",
  probability: s.probability,
})

const AREA0 = stage({
  code: "area0",
  name: "Контакт до запроса",
  role: "area0",
  probability: 0,
  description: "Работа с целевой компанией: карта людей, касания до появления конкретной возможности. Зона отношений, а не стадия сделки.",
  entryCondition: "Известна компания или человек; запроса и решения о продаже может не быть.",
  signalsHint:
    "Знакомство, ответ на письмо, встреча на мероприятии, переход знакомого человека в другую компанию; новость или публичное упоминание как повод для контакта. Сохраняем контекст, гипотезу потребности, владельца отношений и следующий шаг. В прогноз не входит.",
})

// ── «Продажи B2B (стандарт)» = today's system funnel, Russian names ──────

const B2B_STANDARD: FunnelConfig = {
  v: 1,
  stages: [
    AREA0,
    stage({
      code: "s1",
      name: "Квалификация",
      role: "active",
      probability: 0.05,
      description: "Есть потребность или запрос клиента; проверяем, подходит ли возможность нам.",
      entryCondition: "Клиент обратился с конкретной потребностью, запросом или приглашением к закупке.",
      signalsHint: "Новая потребность клиента, приглашение к тендеру или закупке.",
    }),
    stage({
      code: "s2",
      name: "Выявление потребности",
      role: "active",
      probability: 0.2,
      description: "Уточняем задачу, объём, сроки и участников решения у клиента.",
      entryCondition: "Клиент делится деталями задачи или просит материалы по ней.",
      signalsHint: "Бриф или RFP, анкета или RFI в рамках отбора, запрос индивидуальных материалов.",
    }),
    stage({
      code: "s3",
      name: "Пилот",
      role: "active",
      probability: 0.5,
      description: "Клиент проверяет решение на практике: образцы, тест, пилотный проект.",
      entryCondition: "Клиент запросил образцы, тестовое задание или пилот.",
      signalsHint: "Запрос образцов, теста или пилотного проекта.",
    }),
    stage({
      code: "s4",
      name: "Предложение",
      role: "active",
      probability: 0.6,
      description: "Готовим и защищаем коммерческое предложение по задаче клиента.",
      entryCondition: "Клиент запросил коммерческое предложение по конкретной задаче или включил нас в шорт-лист.",
      signalsHint: "Запрос КП, подтверждённый шорт-лист или следующий тур.",
    }),
    stage({
      code: "s5",
      name: "Переговоры",
      role: "active",
      probability: 0.8,
      description: "Согласуем финальные условия: цену, объём, сроки и договор.",
      entryCondition: "Клиент обсуждает финальные условия после рассмотрения предложения или сообщил, что выбрал нас.",
      signalsHint: "Обсуждение финальных условий, сообщение клиента о выборе нас.",
    }),
    stage({
      code: "won",
      name: "Выиграна",
      role: "won",
      probability: 1,
      description: "Заказ или договор подтверждён клиентом.",
      entryCondition: "Клиент подписал договор или дополнение, оформил обязательный заказ или принял оферту.",
      signalsHint: "Подписанный договор, подтверждённый заказ, принятая оферта. Оплата — отдельный факт.",
    }),
    stage({
      code: "lost",
      name: "Не состоялась",
      role: "lost",
      probability: 0,
      description: "Клиент выбрал другого или отменил закупку.",
      entryCondition: "Подтверждённый отказ или отмена; причина указана.",
      signalsHint: "Явный отказ, выбор другого поставщика, отмена закупки. Молчание клиента — не отказ.",
    }),
  ],
  dealTypes: [
    { code: "new_client", label: "Новый клиент" },
    { code: "extra_order", label: "Дополнительный заказ действующего клиента" },
    { code: "renewal", label: "Продление договора" },
  ],
  reasons: {
    lost: [
      { code: "competitor", label: "Выбрали другого" },
      { code: "cancelled", label: "Клиент отменил закупку" },
      { code: "price", label: "Цена" },
      { code: "other", label: "Другое" },
    ],
    noGo: [
      { code: "not_our_profile", label: "Не наш профиль" },
      { code: "low_chances", label: "Низкие шансы" },
      { code: "no_resources", label: "Нет ресурсов" },
      { code: "other", label: "Другое" },
    ],
    withdrawn: [
      { code: "decided_to_stop", label: "Решили не участвовать дальше" },
      { code: "other", label: "Другое" },
    ],
  },
  entryGate: "none",
  rules: [
    create("SALES_TENDER_INVITATION", "s1"),
    create("SALES_NEW_DEMAND", "s1"),
    create("SALES_RFI_REQUESTED", "s2"),
    move("SALES_RFI_REQUESTED", "s2"),
    create("SALES_BRIEF_RECEIVED", "s2"),
    move("SALES_BRIEF_RECEIVED", "s2"),
    move("SALES_MATERIAL_REQUESTED", "s2"),
    move("SAMPLES_REQUESTED", "s3"),
    move("SALES_OFFER_REQUESTED", "s4"),
    move("SALES_SHORTLISTED", "s4"),
    move("SALES_FINAL_TERMS", "s5"),
    move("SALES_SELECTED", "s5"),
    create("CONTRACT_RENEWAL_INTENT", "s5", { dealTypes: ["renewal"] }),
    won("CONTRACT_SIGNED"),
    won("SALES_BOOKING_RECEIVED"),
    lost("SALES_LOST"),
    lost("SALES_OFFER_DECLINED"),
    pause("DECISION_POSTPONED"),
    inStage("SALES_BUDGET_MENTIONED"),
    inStage("SALES_PRICE_REQUEST"),
    inStage("SALES_RENEGOTIATION"),
    inStage("MEETING_NEW_STAKEHOLDER"),
    inStage("CONTACT_NEW_DECISION_MAKER"),
  ],
}

// ── «Тендеры и конкурсы (5 стадий)» = the funnel of spec §1, generic words ─

const TENDERS_5: FunnelConfig = {
  v: 1,
  stages: [
    AREA0,
    stage({
      code: "s1",
      name: "Новая возможность",
      role: "active",
      probability: 0,
      inForecast: false,
      description: "Конкретная потребность, запрос или подходящая закупка; первая оценка и решение go / no-go — условие входа в воронку.",
      entryCondition: "У клиента есть конкретная задача, персональное приглашение или подходящая закупка, и мы решили участвовать (go).",
      signalsHint:
        "Клиент описал задачу, пригласил к отбору или объявил конкурс с понятным предметом. Сигнал сохраняется сразу; после решения go создаётся сделка. Это ещё не подготовка решения и не прогноз.",
    }),
    stage({
      code: "s2",
      name: "Запрошены материалы или решение",
      role: "active",
      probability: 0,
      inForecast: false,
      description: "Квалификация нашей компании и запрос решения от клиента.",
      entryCondition: "Клиент просит материалы для оценки нашей компании или предложение по конкретной задаче.",
      signalsHint:
        "Кейсы, анкеты, документы или RFI в рамках отбора; бриф или RFP с просьбой предложить подход, концепцию, план или тестовое задание. Общая просьба «пришлите кейсы» без задачи остаётся касанием в зоне «Контакт до запроса».",
    }),
    stage({
      code: "s3",
      name: "Финальный выбор",
      role: "active",
      probability: 0.3,
      probabilityMode: "expert",
      description: "Шорт-лист и финальные условия.",
      entryCondition: "Клиент подтвердил следующий тур или после рассмотрения решения обсуждает актуальные условия.",
      signalsHint:
        "Подтверждён шорт-лист или финал; запрошена обновлённая смета; после представления решения обсуждаются объём, цена и условия закупки. Ранний вопрос о бюджете сам по себе стадию не меняет.",
    }),
    stage({
      code: "s4",
      name: "Выбраны",
      role: "active",
      probability: 0.7,
      probabilityMode: "expert",
      description: "Устный выбор и официальная победа.",
      entryCondition: "Клиент прямо сообщил, что выбрал нас; обязательство заказать ещё не оформлено.",
      signalsHint:
        "Сообщение о выборе от уполномоченного лица клиента или официальное уведомление о победе. Похвала решению или догадка сотрудника клиента — не выбор.",
    }),
    stage({
      code: "won",
      name: "Заказ подтверждён",
      role: "won",
      probability: 1,
      description: "Подтверждённый заказ и передача в исполнение.",
      entryCondition: "Клиент принял обязательство заказать согласованную работу.",
      signalsHint:
        "Подписан договор или дополнение, оформлен обязательный заказ, принята оферта. Победа без подтверждённого заказа остаётся на стадии «Выбраны». Оплата — отдельный факт.",
    }),
    stage({
      code: "lost",
      name: "Не состоялась",
      role: "lost",
      probability: 0,
      description: "Подтверждённый проигрыш или отмена закупки.",
      entryCondition: "Клиент сообщил о выборе другого участника или об отмене закупки; причина указана.",
      signalsHint: "Явный отказ, выбор другого участника, отмена закупки. Молчание клиента — не проигрыш.",
    }),
  ],
  dealTypes: [
    { code: "new_client", label: "Новый клиент" },
    { code: "major_extra_order", label: "Существенный допзаказ действующего клиента" },
    { code: "retender", label: "Повторный конкурс за текущий контракт" },
  ],
  reasons: {
    lost: [
      { code: "competitor", label: "Выбрали другого" },
      { code: "cancelled", label: "Клиент отменил закупку" },
      { code: "price", label: "Цена" },
      { code: "no_reply_after_final", label: "Нет ответа после финала" },
      { code: "other", label: "Другое" },
    ],
    noGo: [
      { code: "not_our_profile", label: "Не наш профиль" },
      { code: "low_chances", label: "Низкие шансы" },
      { code: "no_resources", label: "Нет ресурсов" },
      { code: "timing", label: "Сроки не подходят" },
      { code: "other", label: "Другое" },
    ],
    withdrawn: [
      { code: "decided_to_stop", label: "Решили не участвовать дальше" },
      { code: "conflict_of_interest", label: "Конфликт интересов" },
      { code: "other", label: "Другое" },
    ],
  },
  entryGate: "go_no_go",
  rules: [
    create("SALES_TENDER_INVITATION", "s1"),
    create("SALES_NEW_DEMAND", "s1"),
    create("SALES_RFI_REQUESTED", "s2"),
    move("SALES_RFI_REQUESTED", "s2"),
    create("SALES_BRIEF_RECEIVED", "s2"),
    move("SALES_BRIEF_RECEIVED", "s2"),
    create("SALES_MATERIAL_REQUESTED", "s2"),
    move("SALES_MATERIAL_REQUESTED", "s2"),
    move("SALES_OFFER_REQUESTED", "s2"),
    move("SALES_SHORTLISTED", "s3"),
    move("SALES_FINAL_TERMS", "s3"),
    move("SALES_SELECTED", "s4"),
    won("CONTRACT_SIGNED"),
    won("SALES_BOOKING_RECEIVED"),
    lost("SALES_LOST"),
    lost("SALES_OFFER_DECLINED"),
    pause("DECISION_POSTPONED"),
    inStage("SALES_BUDGET_MENTIONED"),
    inStage("MEETING_NEW_STAKEHOLDER"),
    inStage("MEETING_URGENT"),
    inStage("MEETING_DELAYED"),
    inStage("MEETING_CANCEL"),
    inStage("FEEDBACK_QUALITY_PRAISE"),
    inStage("FEEDBACK_COMM_PRAISE"),
    inStage("FEEDBACK_PRICE_PRAISE"),
    inStage("CONTACT_NEW_DECISION_MAKER"),
  ],
}

export const FUNNEL_TEMPLATE_SOURCES: readonly FunnelTemplateSource[] = [
  {
    code: "b2b_standard",
    labelRu: "Продажи B2B (стандарт)",
    description:
      "Классическая воронка B2B-продаж: квалификация, выявление потребности, пилот, предложение, переговоры. Сделка создаётся по сигналу клиента; прогноз — по вероятности стадии.",
    sort: 1,
    config: B2B_STANDARD,
  },
  {
    code: "tenders_5",
    labelRu: "Тендеры и конкурсы (5 стадий)",
    description:
      "Воронка для отборов и конкурсов: новая возможность (решение go / no-go), запрос материалов или решения, финальный выбор, выбор нас, подтверждённый заказ. В прогнозе только финальный выбор и «Выбраны» с экспертной вероятностью.",
    sort: 2,
    config: TENDERS_5,
  },
]
