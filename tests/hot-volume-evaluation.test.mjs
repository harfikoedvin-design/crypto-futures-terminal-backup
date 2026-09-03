import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Hot Volume evaluation is versioned, forward-only, conservative, and promotion-gated", async () => {
  const [source, migration, route, background] = await Promise.all([
    readFile(new URL("../lib/hot-volume-evaluation.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0010_long_mariko_yashida.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/hot-volume/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/background-scanner.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /hot-volume-evidence-v2/);
  assert.match(source, /HOT_VOLUME_EVALUATION_TARGET_PAIRED = 30/);
  assert.match(source, /CLOSED_15M_HIGH_LOW_STOP_FIRST/);
  assert.match(source, /KEEP_REQUIRED_FOR_AUTO_PAPER/);
  assert.match(source, /FORWARD_RAW_VS_EXECUTION_ELIGIBLE_COHORTS/);
  assert.match(source, /candidate\.status === "BREAKOUT_READY"/);
  assert.match(source, /hardenedCohort\.expectancyR <= 0/);
  assert.match(source, /hardenedCohort\.maxDrawdownR <= 10/);
  assert.match(source, /if \(stopHit\)[\s\S]*if \(targetHit\)/);
  assert.match(source, /INSERT OR IGNORE INTO hot_volume_observations/);
  assert.match(source, /open_evidence_hash/);
  assert.match(source, /outcome_evidence_hash/);
  assert.match(migration, /CREATE TABLE `hot_volume_observations`/);
  assert.match(migration, /CREATE UNIQUE INDEX `hot_volume_observations_signal_key_unique`/);
  assert.match(route, /requireOwnerApi/);
  assert.match(route, /syncHotVolumeEvaluation/);
  assert.match(background, /syncHotVolumeEvaluation/);
  assert.doesNotMatch(source, /syncPaperTrades|offerTelegramSetups|order api|private key/i);
});
