import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const DAY_MS = 24 * 60 * 60_000;

class FakeD1 {
  constructor() {
    this.rows = [];
  }

  prepare(sql) {
    const rows = this.rows;
    let values = [];
    return {
      bind(...input) { values = input; return this; },
      async all() {
        if (sql.includes("FROM haxkai_shadow_observations WHERE status = 'OPEN'")) {
          return { results: rows.filter((row) => row.status === "OPEN") };
        }
        if (sql.includes("SELECT symbol FROM haxkai_shadow_observations")) {
          const [dayStart] = values;
          return { results: rows.filter((row) => Number(row.source_closed_at) >= Number(dayStart)).map((row) => ({ symbol: row.symbol })) };
        }
        if (sql.includes("FROM haxkai_shadow_observations ORDER BY opened_at DESC")) {
          return { results: [...rows].sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at))) };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      async run() {
        if (sql.startsWith("INSERT OR IGNORE INTO haxkai_shadow_observations")) {
          const [
            id, signalKey, symbol, baseAsset, direction, levelPrice, levelLabel, volumeRatio,
            entryPrice, stopLoss, takeProfit, targetR, openedAt, lastCheckedAt,
            observedHigh, observedLow, sourceClosedAt, evidenceHash, evidenceJson,
          ] = values;
          if (!rows.some((row) => row.signal_key === signalKey)) {
            rows.push({
              id, signal_key: signalKey, symbol, base_asset: baseAsset, direction,
              level_price: levelPrice, level_label: levelLabel, volume_ratio: volumeRatio,
              entry_price: entryPrice, stop_loss: stopLoss, take_profit: takeProfit, target_r: targetR,
              status: "OPEN", outcome_r: null, exit_price: null, opened_at: openedAt, closed_at: null,
              last_checked_at: lastCheckedAt, observed_high: observedHigh, observed_low: observedLow,
              source_closed_at: sourceClosedAt, evidence_hash: evidenceHash, evidence_json: evidenceJson,
            });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        if (sql.startsWith("UPDATE haxkai_shadow_observations SET last_checked_at = ?")) {
          const [lastCheckedAt, observedHigh, observedLow, id] = values;
          const row = rows.find((item) => item.id === id);
          if (row?.status === "OPEN") {
            row.last_checked_at = lastCheckedAt;
            row.observed_high = observedHigh;
            row.observed_low = observedLow;
          }
          return { success: true };
        }
        if (sql.startsWith("UPDATE haxkai_shadow_observations SET status = ?")) {
          const [status, outcomeR, exitPrice, closedAt, lastCheckedAt, observedHigh, observedLow, id] = values;
          const row = rows.find((item) => item.id === id);
          if (row?.status === "OPEN") {
            Object.assign(row, {
              status, outcome_r: outcomeR, exit_price: exitPrice, closed_at: closedAt,
              last_checked_at: lastCheckedAt, observed_high: observedHigh, observed_low: observedLow,
            });
          }
          return { success: true };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
  }
}

function dailyRow(openTime, open, high, low, close, volume) {
  return [openTime, String(open), String(high), String(low), String(close), String(volume), openTime + DAY_MS - 1];
}

test("haxkai shadow module stays research-only, versioned, and evidence-gated", async () => {
  const [source, migration, route] = await Promise.all([
    readFile(new URL("../lib/haxkai-shadow.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0012_supreme_songbird.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/haxkai-shadow/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /haxkai-shadow-v1/);
  assert.match(source, /SHADOW_ONLY/);
  assert.match(source, /HAXKAI_MIN_RESOLVED = 30/);
  assert.match(source, /CLOSED_15M_HIGH_LOW_STOP_FIRST/);
  assert.match(source, /INSUFFICIENT DATA/);
  assert.match(source, /INSERT OR IGNORE INTO haxkai_shadow_observations/);
  const insert = source.match(/INSERT OR IGNORE INTO haxkai_shadow_observations \(([\s\S]*?)\) VALUES \(([\s\S]*?)\)/);
  assert.ok(insert, "haxkai observation insert statement must be present");
  const insertColumns = insert[1].split(",").map((value) => value.trim()).filter(Boolean);
  const insertValues = insert[2].split(",").map((value) => value.trim()).filter(Boolean);
  assert.equal(insertValues.length, insertColumns.length, "haxkai observation insert values must match its columns");
  assert.doesNotMatch(source, /syncPaperTrades|openActionablePaperTrade/);
  assert.match(migration, /CREATE TABLE `haxkai_shadow_observations`/);
  assert.match(migration, /CREATE UNIQUE INDEX `haxkai_shadow_signal_key_unique`/);
  assert.match(route, /requireViewerApi/);
  assert.match(route, /requireOwnerApi/);
  assert.match(route, /getHaxkaiShadowReport/);
  assert.match(route, /syncHaxkaiShadow/);
});

test("haxkai shadow records a daily-close signal and settles it from closed candles", async () => {
  const originalFetch = globalThis.fetch;
  const generatedAt = new Date().toISOString();
  const now = Date.parse(generatedAt);
  const dayOpen = (daysAgo) => now - daysAgo * DAY_MS;
  const dailyCandles = [];
  for (let daysAgo = 21; daysAgo >= 2; daysAgo -= 1) {
    dailyCandles.push(dailyRow(dayOpen(daysAgo), 90, 95, 89, 92, 1000));
  }
  dailyCandles.push(dailyRow(dayOpen(1), 96, 100, 95, 97, 1000));
  dailyCandles.push(dailyRow(now - DAY_MS, 97, 103, 96, 101, 2500));
  // Settlement replays closed 15m candles, so the TP candle lives in the past
  // relative to wall-clock time (same backdating pattern as the paper tests).
  const tpCandleTime = now - 45 * 60_000;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("interval=1d")) {
      return new Response(JSON.stringify(dailyCandles), { headers: { "content-type": "application/json" } });
    }
    if (url.includes("/futures/data/openInterestHist")) {
      return new Response("[]", { headers: { "content-type": "application/json" } });
    }
    if (url.includes("/fapi/v1/klines")) {
      return new Response(JSON.stringify([
        [tpCandleTime, "101", "112", "100", "110", "50", tpCandleTime + 15 * 60_000 - 1],
      ]), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    process.env.NODE_ENV = "test";
    globalThis.__VIEWER_ENV_TEST_BINDING__ = {};
    const database = new FakeD1();
    globalThis.__HAXKAI_D1_TEST_BINDING__ = database;
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("haxkai-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const runtime = { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
    const context = { waitUntil() {}, passThroughOnException() {} };

    const synced = await worker.fetch(
      new Request("http://localhost/api/haxkai-shadow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbols: ["BTCUSDT"], generatedAt }),
      }),
      runtime,
      context,
    );
    assert.equal(synced.status, 200);
    const syncedBody = await synced.json();
    assert.equal(syncedBody.mode, "SHADOW_ONLY");
    assert.equal(syncedBody.all.total, 1);
    assert.equal(syncedBody.all.open, 1);
    assert.equal(syncedBody.all.resolved, 0);
    assert.equal(syncedBody.verdict, "INSUFFICIENT DATA");
    assert.equal(database.rows.length, 1);
    assert.equal(database.rows[0].direction, "LONG");
    assert.equal(database.rows[0].status, "OPEN");
    assert.ok(Math.abs(database.rows[0].volume_ratio - 2.5) < 1e-9);
    assert.match(database.rows[0].evidence_hash, /^[a-f0-9]{64}$/);

    database.rows[0].opened_at = new Date(now - 60 * 60_000).toISOString();
    database.rows[0].last_checked_at = new Date(now - 60 * 60_000).toISOString();
    const later = new Date(now + 60 * 60_000).toISOString();
    const settled = await worker.fetch(
      new Request("http://localhost/api/haxkai-shadow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbols: ["BTCUSDT"], generatedAt: later }),
      }),
      runtime,
      context,
    );
    assert.equal(settled.status, 200);
    const settledBody = await settled.json();
    assert.equal(settledBody.all.resolved, 1);
    assert.equal(settledBody.all.wins, 1);
    assert.equal(settledBody.all.expectancyR, 2);
    assert.equal(settledBody.all.netR, 2);
    assert.equal(settledBody.verdict, "INSUFFICIENT DATA");
    assert.equal(database.rows.length, 1);
    assert.equal(database.rows[0].status, "TP");
    assert.equal(database.rows[0].outcome_r, 2);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__HAXKAI_D1_TEST_BINDING__;
    delete globalThis.__VIEWER_ENV_TEST_BINDING__;
  }
});
