import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("controlled evaluation is persistent, closed-candle verified, and fail-closed", async () => {
  const [source, migration, cohortMigration, route] = await Promise.all([
    readFile(new URL("../lib/evaluation.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0002_last_robin_chapel.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0009_flippant_meggan.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evaluation/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(source, /controlled-evaluation-v2/);
  assert.match(source, /V2_CLOSED_CANDLE/);
  assert.match(source, /CLOSED_15M_HIGH_LOW_STOP_FIRST/);
  assert.match(source, /EVALUATION_TARGET_RESOLVED = 100/);
  assert.match(source, /EVALUATION_BASELINE_MIN_RESOLVED = 30/);
  assert.match(source, /INSUFFICIENT DATA/);
  assert.match(source, /INSERT OR IGNORE INTO shadow_observations/);
  const insert = source.match(/INSERT OR IGNORE INTO shadow_observations \(([\s\S]*?)\) VALUES \(([\s\S]*?)\)/);
  assert.ok(insert, "shadow observation insert statement must be present");
  const insertColumns = insert[1].split(",").map((value) => value.trim()).filter(Boolean);
  const insertValues = insert[2].split(",").map((value) => value.trim()).filter(Boolean);
  assert.equal(insertValues.length, insertColumns.length, "shadow observation insert values must match its columns");
  assert.match(source, /status = \?, outcome_r = \?/);
  assert.match(migration, /CREATE TABLE `shadow_observations`/);
  assert.match(migration, /CREATE UNIQUE INDEX `shadow_observations_signal_key_unique`/);
  assert.match(cohortMigration, /ADD `evaluation_version`/);
  assert.match(cohortMigration, /ADD `outcome_source`/);
  assert.match(source, /winRate: decisive \? \(wins \/ decisive\)/);
  assert.match(source, /legacyExcluded/);
  assert.doesNotMatch(route, /syncPaperTrades|order|private key/i);
});
