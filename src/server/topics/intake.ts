import "server-only"

import { and, asc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm"
import { db } from "@/db/drizzle"
import { pipelineRun, source, sourceItem } from "@/db/schema"
import { syncableProviders } from "@/lib/sources/providers"
import { ORCHESTRATION_CONFIG } from "@/server/orchestration/config"
import { parseSourceItem } from "@/server/parse-source-item"
import { syncSource } from "@/server/sync"
import type { TopicsPhaseContext, TopicsPhaseResult } from "@/server/topics/phases"
import { signalHistoryStart } from "@/server/topics/signals/runner"
import { backfillThreadKeys } from "@/server/topics/thread-key-backfill"
import { ingestDueChatThreads } from "@/server/chat/ingest"
import { mapPool } from "@/server/topics/signals/item-input"
import { uploadSourceItem } from "@/server/upload-source-item"

// Phase «intake» of the hourly topics run (runbook 07 O1, decided
// 2026-11-14): sync → parse → upload for ONE org in `shadow` / `on`, so new
// mail / Google Chat / Drive items get signals within the hour instead of
// waiting for the daily run (03:00 UTC). Telegram items are already parsed
// on arrival; the step simply finds nothing pending for them.
//
// After parse: the automatic «Найти в источниках» when the org switched it
// on (`discovery.autoApply`). Last step: fill missing `thread_key` values of
// older items (backfill).
//
// Same gates as the daily pipeline: only active syncable sources with
// `automated_parsing_is_allowed`, only ROOT items in `pending`. Parse is
// limited to the signal window (7 days before the org's switch-on) — older
// backlog stays for the daily run — newest window items are not starved:
// oldest first inside the window, capped per org per run.
//
// Skipped while a daily pipeline run is in progress: both would sync and
// parse the same sources (idempotent, but a double parse costs AI money).

const DAILY_RUN_GUARD_MINUTES = 180

async function dailyPipelineRunning(): Promise<boolean> {
  const [row] = await db
    .select({ id: pipelineRun.id })
    .from(pipelineRun)
    .where(
      and(
        eq(pipelineRun.status, "running"),
        gte(pipelineRun.startedAt, new Date(Date.now() - DAILY_RUN_GUARD_MINUTES * 60_000)),
      ),
    )
    .limit(1)
  return !!row
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function runIntakePhase(ctx: TopicsPhaseContext): Promise<TopicsPhaseResult> {
  const orgId = ctx.organizationId
  if (await dailyPipelineRunning()) return { skipped: "daily pipeline is running" }
  const cfg = ORCHESTRATION_CONFIG.topics

  // 1. Sync the org's automated sources (one failure does not stop the others).
  const sources = await db
    .select({ id: source.id })
    .from(source)
    .where(
      and(
        eq(source.ownerOrganizationId, orgId),
        eq(source.status, "active"),
        eq(source.automatedParsingIsAllowed, true),
        inArray(source.provider, syncableProviders()),
      ),
    )
  const counts = {
    sources: sources.length,
    syncFailed: 0,
    inserted: 0,
    parsePending: 0,
    parsed: 0,
    parseSkipped: 0,
    parseFailed: 0,
    uploaded: 0,
    uploadFailed: 0,
    threadKeysFilled: 0,
    threadKeysRemaining: 0,
    chatThreads: 0,
    chatIngested: 0,
    chatNewInfo: 0,
    chatFailed: 0,
    discoveryCreated: 0,
    discoveryLeft: 0,
    discoveryFailed: 0,
  }

  // 0. AI chat segments → source items of the «AI Chat» source (docs/specs/
  //    ai-chat §16.3): before «signals», so a note gets signals in this run.
  try {
    const chat = await ingestDueChatThreads(orgId)
    counts.chatThreads = chat.threads
    counts.chatIngested = chat.ingested
    counts.chatNewInfo = chat.newInfo
    counts.chatFailed = chat.failed
  } catch (e) {
    counts.chatFailed++
    console.error("[topics/intake] chat ingest failed", orgId, message(e))
  }

  for (const s of sources) {
    try {
      const r = await syncSource(s.id)
      counts.inserted += r.inserted
    } catch (e) {
      counts.syncFailed++
      console.error("[topics/intake] sync failed", s.id, message(e))
    }
  }

  // 2. Parse pending root items of the signal window.
  const since = await signalHistoryStart(orgId)
  if (since) {
    const pendingWhere = and(
      eq(sourceItem.organizationId, orgId),
      eq(sourceItem.parseStatus, "pending"),
      isNull(sourceItem.parentSourceItemId),
      eq(source.automatedParsingIsAllowed, true),
      gte(sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`, since),
    )
    const ids = await db
      .select({ id: sourceItem.id })
      .from(sourceItem)
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(pendingWhere)
      .orderBy(asc(sql`coalesce(${sourceItem.sourceCreatedAt}, ${sourceItem.createdAt})`))
      .limit(cfg.maxParsePerOrgPerRun)
    counts.parsePending = ids.length
    await mapPool(ids, cfg.concurrency, async ({ id }) => {
      try {
        const r = await parseSourceItem(id, { userId: null })
        if (r.parentStatus === "complete") counts.parsed++
        else if (r.parentStatus === "skipped") counts.parseSkipped++
        else counts.parseFailed++
      } catch (e) {
        counts.parseFailed++
        console.error("[topics/intake] parse failed", id, message(e))
      }
    })
  }

  // 2b. Automatic «Найти в источниках» when the org switched it on
  //     (`discovery.autoApply`, src/server/discovery-auto.ts): companies /
  //     contacts exist before «signals» / «topics» resolve counterparties.
  try {
    const { runAutoDiscoveryForOrg } = await import("@/server/discovery-auto")
    const d = await runAutoDiscoveryForOrg(orgId)
    if (!("skipped" in d)) {
      counts.discoveryCreated = d.clientsCreated + d.clientsRevived + d.contactsCreated + d.contactsRevived
      counts.discoveryLeft = d.leftForReview
    }
  } catch (e) {
    counts.discoveryFailed++
    console.error("[topics/intake] auto discovery failed", orgId, message(e))
  }

  // 3. Upload what is parsed (no AI; keeps the DB copy of markdown small).
  const uploads = await db
    .select({ id: sourceItem.id })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(
        eq(sourceItem.organizationId, orgId),
        eq(sourceItem.parseStatus, "complete"),
        ne(sourceItem.r2UploadStatus, "complete"),
        isNotNull(sourceItem.parsedMarkdown),
        eq(source.automatedParsingIsAllowed, true),
      ),
    )
    .orderBy(asc(sourceItem.parsedAt))
    .limit(cfg.maxUploadPerOrgPerRun)
  for (const { id } of uploads) {
    try {
      const r = await uploadSourceItem(id)
      if (r.ok) counts.uploaded++
      else counts.uploadFailed++
    } catch (e) {
      counts.uploadFailed++
      console.error("[topics/intake] upload failed", id, message(e))
    }
  }

  // 4. Thread keys for older items synced before keys existed (spec §6.1;
  //    new items get the key at sync / ingest). Resumable, idempotent.
  try {
    const tk = await backfillThreadKeys(orgId, cfg.maxThreadKeyBackfillPerOrgPerRun)
    counts.threadKeysFilled = tk.updated
    counts.threadKeysRemaining = tk.remaining
  } catch (e) {
    console.error("[topics/intake] thread key backfill failed", orgId, message(e))
  }
  return counts
}
