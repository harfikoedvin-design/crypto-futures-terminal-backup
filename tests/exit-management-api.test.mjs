import assert from "node:assert/strict";
import test from "node:test";

class FakeExitD1 {
  constructor(paperRows) {
    this.paperRows = paperRows;
    this.shadowRows = [];
  }

  prepare(sql) {
    let values = [];
    return {
      bind: (...input) => {
        values = input;
        return this.prepareBound(sql, values);
      },
      all: () => this.all(sql),
      first: async () => null,
      run: () => this.run(sql, values),
    };
  }

  prepareBound(sql, values) {
    return {
      bind: () => this.prepareBound(sql, values),
      all: () => this.all(sql),
      first: async () => null,
      run: () => this.run(sql, values),
    };
  }

  async all(sql) {
    if (sql.includes("FROM paper_trades")) return { results: [...this.paperRows] };
    if (sql.includes("SELECT paper_trade_id FROM exit_shadow_positions")) {
      return { results: this.shadowRows.map((row) => ({ paper_trade_id: row.paper_trade_id })) };
    }
    if (sql.includes("WHERE state NOT IN")) {
      return { results: this.shadowRows.filter((row) => !["FULL_TP", "PROTECTED_EXIT", "SL"].includes(row.state)).slice(0, 8) };
    }
    if (sql.includes("FROM exit_shadow_positions")) {
      return { results: [...this.shadowRows].sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at))) };
    }
    throw new Error(`Unexpected all SQL: ${sql}`);
  }

  async run(sql, values) {
    if (sql.startsWith("INSERT OR IGNORE INTO exit_shadow_positions")) {
      const [
        id, paperTradeId, symbol, baseAsset, direction, sourceModelVersion, sourceStatus, state,
        entryPrice, originalStop, activeStop, oneRPrice, tp1, tp2, tp3, remainingFraction,
        realizedR, baselineOutcomeR, openedAt, lastCheckedAt, closedAt, evidenceJson,
      ] = values;
      if (!this.shadowRows.some((row) => row.paper_trade_id === paperTradeId)) {
        this.shadowRows.push({
          id, paper_trade_id: paperTradeId, symbol, base_asset: baseAsset, direction,
          source_model_version: sourceModelVersion, source_status: sourceStatus, state,
          entry_price: entryPrice, original_stop: originalStop, active_stop: activeStop,
          one_r_price: oneRPrice, tp1, tp2, tp3, remaining_fraction: remainingFraction,
          realized_r: realizedR, baseline_outcome_r: baselineOutcomeR, opened_at: openedAt,
          last_checked_at: lastCheckedAt, closed_at: closedAt, evidence_json: evidenceJson,
        });
      }
      return { success: true };
    }
    if (sql.startsWith("UPDATE exit_shadow_positions")) {
      const [sourceStatus, state, activeStop, remainingFraction, realizedR, baselineOutcomeR, lastCheckedAt, closedAt, evidenceJson, id] = values;
      const row = this.shadowRows.find((item) => item.id === id);
      Object.assign(row, {
        source_status: sourceStatus, state, active_stop: activeStop, remaining_fraction: remainingFraction,
        realized_r: realizedR, baseline_outcome_r: baselineOutcomeR, last_checked_at: lastCheckedAt,
        closed_at: closedAt, evidence_json: evidenceJson,
      });
      return { success: true };
    }
    throw new Error(`Unexpected run SQL: ${sql}`);
  }
}

function paperRow(id, direction, overrides = {}) {
  const openedAt = "2026-08-27T15:00:00.000Z";
  const long = direction === "LONG";
  return {
    id,
    symbol: `${id.toUpperCase()}USDT`,
    base_asset: id.toUpperCase(),
    direction,
    model_version: "V1",
    status: "OPEN",
    entry_price: 100,
    stop_loss: long ? 98 : 102,
    take_profit: long ? 106 : 94,
    take_profit_2: long ? 108 : 92,
    take_profit_3: long ? 110 : 90,
    outcome_r: null,
    opened_at: openedAt,
    closed_at: null,
    last_checked_at: openedAt,
    observed_high: 100,
    observed_low: 100,
    ...overrides,
  };
}

test("Exit V2 applies symmetric staged exits and stop-first candle ordering", async () => {
  const database = new FakeExitD1([
    paperRow("long", "LONG"),
    paperRow("short", "SHORT"),
    paperRow("conflict", "LONG"),
    paperRow("legacy", "LONG", {
      status: "SL",
      outcome_r: -1,
      opened_at: "2026-08-23T10:00:00.000Z",
      last_checked_at: "2026-08-27T14:00:00.000Z",
      closed_at: "2026-08-27T14:00:00.000Z",
    }),
    paperRow("bridge", "LONG", {
      status: "TP",
      outcome_r: 3,
      opened_at: "2026-08-23T10:00:00.000Z",
      last_checked_at: "2026-08-27T09:29:59.999Z",
      closed_at: "2026-08-27T09:29:59.999Z",
    }),
  ]);
  globalThis.__EXIT_D1_TEST_BINDING__ = database;
  globalThis.__EXIT_SERIES_TEST_LOADER__ = async (symbol) => {
    const time = Date.parse("2026-08-27T15:15:00.000Z");
    if (symbol === "LONGUSDT") return [{ time, high: 107, low: 99 }];
    if (symbol === "SHORTUSDT") return [{ time, high: 101, low: 93 }];
    if (symbol === "BRIDGEUSDT") return [{ time, high: 107, low: 101 }];
    return [{ time, high: 107, low: 97 }];
  };

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("exit-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const runtime = { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };

  try {
    const response = await worker.fetch(new Request("http://localhost/api/exit-management", { method: "POST" }), runtime, context);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "SHADOW_ONLY");
    assert.deepEqual(body.rules, {
      oneRPartialPct: 25,
      tp1PartialPct: 25,
      tp2PartialPct: 25,
      tp3FinalPct: 25,
      stopAfterOneR: "NET_BE_NEXT_CANDLE",
    });
    assert.equal(body.comparison.forward.total, 3);
    assert.equal(body.comparison.forward.active, 2);
    assert.equal(body.comparison.forward.resolved, 1);
    assert.equal(body.comparison.forward.pairedResolved, 0);
    assert.equal(body.comparison.bridge.total, 1);
    assert.equal(body.comparison.bridge.active, 1);
    assert.equal(body.comparison.excludedLegacy, 1);
    assert.equal(body.comparison.evidenceGate, "COLLECTING");

    const long = database.shadowRows.find((row) => row.paper_trade_id === "long");
    const short = database.shadowRows.find((row) => row.paper_trade_id === "short");
    const conflict = database.shadowRows.find((row) => row.paper_trade_id === "conflict");
    const bridge = body.activePositions.find((position) => position.paperTradeId === "bridge");
    const legacy = body.resolvedPositions.find((position) => position.paperTradeId === "legacy");
    assert.equal(long.state, "TP1_PARTIAL");
    assert.equal(short.state, "TP1_PARTIAL");
    assert.equal(long.remaining_fraction, 0.5);
    assert.equal(short.remaining_fraction, 0.5);
    assert.equal(long.realized_r, 1);
    assert.equal(short.realized_r, 1);
    assert.equal(long.active_stop, 100.1);
    assert.equal(short.active_stop, 99.9);
    assert.equal(conflict.state, "SL");
    assert.equal(conflict.realized_r, -1);
    assert.equal(conflict.remaining_fraction, 0);
    assert.equal(bridge.cohort, "RUNNER_BRIDGE");
    assert.equal(legacy.cohort, "LEGACY_BACKFILL");
    assert.match(JSON.parse(long.evidence_json).events.at(-1).hash, /^[a-f0-9]{64}$/);
  } finally {
    delete globalThis.__EXIT_D1_TEST_BINDING__;
    delete globalThis.__EXIT_SERIES_TEST_LOADER__;
  }
});
