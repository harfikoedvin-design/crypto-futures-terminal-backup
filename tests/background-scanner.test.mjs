import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const context = { waitUntil() {}, passThroughOnException() {} };

test("background scanner endpoint fails closed without its bearer token", async () => {
  globalThis.__BACKGROUND_ENV_TEST_BINDING__ = {};
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("background-test", `${process.pid}-${Date.now()}`);
  const app = (await import(workerUrl.href)).default;
  const response = await app.fetch(
    new Request("http://localhost/api/background/scan", { method: "POST" }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    context,
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("background scanner is idempotent, paper/shadow-only, and version-audited", async () => {
  const [source, migration] = await Promise.all([
    readFile(new URL("../lib/background-scanner.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0007_right_scarlet_witch.sql", import.meta.url), "utf8"),
  ]);
  assert.match(source, /background-scanner-v2-independent-lanes/);
  assert.match(source, /PAPER_SHADOW_READ_ONLY/);
  assert.match(source, /SKIPPED_DUPLICATE/);
  assert.match(source, /INTEL_UNAVAILABLE/);
  assert.match(source, /EVENT_BLACKOUT/);
  assert.match(source, /evidenceHash/);
  assert.match(source, /forward-evidence-collector-v1/);
  assert.match(source, /telegramEnabled: false/);
  assert.match(source, /HOT_VOLUME_EVIDENCE_UNAVAILABLE/);
  assert.match(source, /syncHotVolumeEvaluation/);
  assert.match(source, /runPositionLane/);
  assert.match(source, /runHotVolumeLane/);
  assert.match(source, /offerTelegramEarlyWatches/);
  assert.match(source, /offerTelegramHotVolumeWatches/);
  assert.match(source, /positionMonitor: position/);
  assert.doesNotMatch(source, /pollTelegramUpdates/);
  assert.match(source, /polled: 0/);
  assert.match(source, /scanHealth/);
  assert.match(source, /HARD_GATE_STARVATION_24H/);
  assert.match(source, /consecutiveCycles >= 96/);
  assert.match(source, /gate-bottleneck-audit-v1/);
  assert.match(source, /REPORT_ONLY_NO_RULE_CHANGE/);
  assert.match(source, /strictCandidates/);
  assert.match(source, /opportunityCandidates/);
  assert.match(source, /eligibleCandidates/);
  assert.match(source, /function blockerCategory/);
  assert.match(source, /ORDER BY started_at DESC LIMIT 96/);
  assert.match(source, /ADX_BELOW_20/);
  assert.match(source, /RELATIVE_VOLUME_BELOW_0_9/);
  assert.match(source, /OI_NOT_CONFIRMING/);
  assert.match(migration, /CREATE TABLE `background_scan_runs`/);
  assert.match(migration, /CREATE UNIQUE INDEX `background_scan_runs_cycle_key_unique`/);
});

test("scanner lanes isolate execution, quality-gated early/hot alerts, and position monitoring", async () => {
  const [scanner, telegram] = await Promise.all([
    readFile(new URL("../lib/background-scanner.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/telegram-monitor.ts", import.meta.url), "utf8"),
  ]);
  assert.match(scanner, /const positionPromise = runPositionLane\(\)/);
  assert.match(scanner, /const hotPromise = runHotVolumeLane\(\)/);
  assert.match(scanner, /offerTelegramEarlyWatches\(earlyCandidates, scanHealth\)/);
  assert.match(scanner, /offerTelegramSetups\(candidates, generatedAt, health\)/);
  assert.match(telegram, /DECISION:<\/b> <code>\$\{decision\}<\/code>/);
  assert.match(telegram, /YANG MENDUKUNG/);
  assert.match(telegram, /YANG BELUM/);
  assert.match(telegram, /NEXT ACTION/);
  assert.match(telegram, /OPEN CHART/);
  assert.match(telegram, /BREAKOUT READY/);
  assert.match(telegram, /telegram-early-learning-v2/);
  assert.match(telegram, /LEARNING_SHADOW/);
  assert.match(telegram, /BLOCKED_EVIDENCE_GATE/);
  assert.match(telegram, /TELEGRAM_QUALITY_MIN_CATEGORIES = 4/);
  assert.match(telegram, /evaluateEarlyTelegramQuality\(signal\)\.passed/);
  assert.match(telegram, /evaluateHotVolumeTelegramQuality\(candidate\)\.passed/);
  assert.match(telegram, /TELEGRAM_SYMBOL_COOLDOWN_MINUTES = 15/);
  assert.match(telegram, /TELEGRAM_OFFER_TTL_MINUTES = 4 \* 15/);
  assert.match(telegram, /STALE_OFFER_4_CLOSED_15M/);
  assert.match(telegram, /QUALITY GATE/);
  assert.match(telegram, /🧪 MONITOR/);
  assert.match(telegram, /callback_data: `track:/);
  assert.match(telegram, /LEARNING RESULT/);
  assert.match(telegram, /PNL REPORT/);
  assert.match(telegram, /statusColor/);
  assert.equal((telegram.match(/callback_data: `exec:/g) ?? []).length, 1);
  assert.equal((telegram.match(/callback_data: `liveentry:/g) ?? []).length, 1);
  assert.equal((telegram.match(/executionDecisionRows\(/g) ?? []).length, 1);
  assert.match(telegram, /AUTO PAPER ACTIVE/);
  assert.match(telegram, /AUTO_BLOCKED_/);
  assert.match(telegram, /activateAutomaticPaperExecution/);
});

test("forward collector status and manual trigger remain owner-only", async () => {
  const [route, dashboard] = await Promise.all([
    readFile(new URL("../app/api/background/status/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/terminal-dashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireViewerApi/);
  assert.match(route, /requireOwnerApi/);
  assert.match(route, /runBackgroundScan/);
  assert.match(dashboard, /INDEPENDENT SCANNER LANES V1/);
  assert.match(dashboard, /GATE BOTTLENECK AUDIT V1/);
  assert.match(dashboard, /REPORT ONLY · NO RULE CHANGE/);
  assert.match(dashboard, /STRICT SIGNALS/);
  assert.match(dashboard, /MOMENTUM OPPORTUNITY/);
  assert.match(dashboard, /COLLECT NOW/);
  assert.match(dashboard, /TELEGRAM/);
  assert.match(dashboard, /SECURE SETUP/);
});
