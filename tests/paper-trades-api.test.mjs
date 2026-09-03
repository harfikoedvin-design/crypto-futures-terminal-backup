import assert from "node:assert/strict";
import test from "node:test";

class FakeD1 {
  constructor(rows = []) {
    this.rows = rows;
  }

  prepare(sql) {
    const rows = this.rows;
    let values = [];
    return {
      bind(...input) { values = input; return this; },
      async all() {
        if (sql.includes("WHERE status = 'OPEN'")) {
          return { results: rows.filter((row) => row.status === "OPEN") };
        }
        if (sql.includes("AS total") && sql.includes("expectancy_r")) {
          const v3 = rows.filter((row) => row.model_version === "V3");
          const history = v3.filter((row) => row.status !== "OPEN");
          const wins = history.filter((row) => row.status === "TP").length;
          const netR = history.reduce((sum, row) => sum + Number(row.outcome_r ?? 0), 0);
          const allHistory = rows.filter((row) => row.status !== "OPEN");
          const stopped = rows.filter((row) => row.status === "SL");
          const stoppedMfeR = stopped.map((row) => {
            const entry = Number(row.entry_price);
            const risk = Math.abs(entry - Number(row.stop_loss));
            const favorable = row.direction === "SHORT"
              ? entry - Number(row.observed_low)
              : Number(row.observed_high) - entry;
            return risk > 0 ? favorable / risk : 0;
          });
          return { results: [{
            total: v3.length,
            open_count: v3.filter((row) => row.status === "OPEN").length,
            resolved: history.length,
            wins,
            losses: history.filter((row) => row.status === "SL").length,
            manual_closed: history.filter((row) => row.status === "MANUAL").length,
            net_r: netR,
            expectancy_r: history.length ? netR / history.length : 0,
            legacy: rows.filter((row) => row.model_version !== "V3").length,
            legacy_open: rows.filter((row) => row.model_version !== "V3" && row.status === "OPEN").length,
            all_total: rows.length,
            all_open: rows.filter((row) => row.status === "OPEN").length,
            all_resolved: allHistory.length,
            all_wins: rows.filter((row) => row.status === "TP").length,
            all_losses: stopped.length,
            all_manual_closed: rows.filter((row) => row.status === "MANUAL").length,
            all_net_r: allHistory.reduce((sum, row) => sum + Number(row.outcome_r ?? 0), 0),
            sl_reached_half_r: stoppedMfeR.filter((value) => value >= 0.5).length,
            sl_reached_one_r: stoppedMfeR.filter((value) => value >= 1).length,
            sl_average_mfe_r: stoppedMfeR.length ? stoppedMfeR.reduce((sum, value) => sum + value, 0) / stoppedMfeR.length : 0,
          }] };
        }
        return { results: [...rows].sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at))) };
      },
      async run() {
        if (sql.startsWith("UPDATE paper_trades")) {
          if (sql.includes("SET evidence_json = ?")) {
            const [evidenceJson, id] = values;
            const row = rows.find((item) => item.id === id);
            if (row?.status === "OPEN") row.evidence_json = evidenceJson;
            return { success: true };
          }
          const [status, exitPrice, outcomeR, closedAt, lastCheckedAt, observedHigh, observedLow, evidenceJson, id] = values;
          const row = rows.find((item) => item.id === id);
          if (sql.includes("AND status = 'OPEN'") && row?.status !== "OPEN") return { success: true, changes: 0 };
          Object.assign(row, {
            status,
            exit_price: exitPrice,
            outcome_r: outcomeR,
            closed_at: closedAt,
            last_checked_at: lastCheckedAt,
            observed_high: observedHigh,
            observed_low: observedLow,
            evidence_json: evidenceJson,
          });
          return { success: true };
        }
        if (sql.startsWith("INSERT OR IGNORE")) {
          const [
            id, signalKey, symbol, baseAsset, direction, setupType, modelVersion, rankingScore,
            technicalScore, entryPrice, stopLoss, takeProfit, takeProfit2,
            takeProfit3, marginUsd, leverage, roundTripCostRate, openedAt, lastCheckedAt, observedHigh, observedLow,
            sourceClosedAt, evidenceJson,
          ] = values;
          if (!rows.some((row) => row.signal_key === signalKey)) {
            rows.push({
              id, signal_key: signalKey, symbol, base_asset: baseAsset, direction,
              setup_type: setupType, model_version: modelVersion, status: "OPEN", ranking_score: rankingScore,
              technical_score: technicalScore, entry_price: entryPrice,
              stop_loss: stopLoss, take_profit: takeProfit, take_profit_2: takeProfit2,
              take_profit_3: takeProfit3, margin_usd: marginUsd, leverage,
              round_trip_cost_rate: roundTripCostRate, exit_price: null, outcome_r: null,
              opened_at: openedAt, closed_at: null, last_checked_at: lastCheckedAt,
              observed_high: observedHigh, observed_low: observedLow,
              source_closed_at: sourceClosedAt, evidence_json: evidenceJson,
            });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
  }
}

function row(overrides = {}) {
  const opened = new Date(Date.now() - 60 * 60_000).toISOString();
  return {
    id: crypto.randomUUID(),
    signal_key: crypto.randomUUID(),
    symbol: "BTCUSDT",
    base_asset: "BTC",
    direction: "LONG",
    setup_type: "Breakout Continuation",
    model_version: "V3",
    status: "OPEN",
    ranking_score: 82,
    technical_score: 79,
    entry_price: 100,
    stop_loss: 98,
    take_profit: 106,
    take_profit_2: 108,
    take_profit_3: 110,
    margin_usd: 10,
    leverage: 20,
    round_trip_cost_rate: 0.001,
    exit_price: null,
    outcome_r: null,
    opened_at: opened,
    closed_at: null,
    last_checked_at: opened,
    observed_high: 100,
    observed_low: 100,
    source_closed_at: Date.now() - 60 * 60_000,
    evidence_json: "{}",
    ...overrides,
  };
}

function healthyData(checkedAt) {
  return {
    schemaVersion: "data-health-v1",
    state: "HEALTHY",
    checkedAt,
    universeCount: 1,
    resultCount: 1,
    providerFailures: 0,
    reasons: [],
  };
}

function validCandidate(overrides = {}) {
  return {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    direction: "LONG",
    setupType: "Breakout Continuation",
    rankingScore: 70,
    technicalScore: 80,
    price: 100,
    stopLoss: 98,
    tp1: 106.4,
    tp2: 108,
    tp3: 110,
    reasons: ["fixture"],
    catalysts: [],
    location: "fixture level",
    paperGateFailures: [],
    risk: {
      version: "V3",
      sizingMode: "FIXED_FRACTIONAL",
      assumedLeverage: 20,
      maximumLeverage: 20,
      stopDistancePct: 2,
      stopDistanceAtr: 1,
      estimatedRoiAtStopPct: 40,
      grossRiskReward: 3.2,
      netRiskReward: 3,
      riskPerTradePct: 2,
      accountEquityUsd: 1000,
      riskBudgetUsd: 20,
      estimatedLossAtStopUsd: 20,
      estimatedFeesUsd: 0.9523809524,
      notionalUsd: 952.380952381,
      marginUsd: 47.619047619,
      quantity: 9.52380952381,
      maximumStopDistancePct: null,
      gateFailures: [],
      gatePass: true,
    },
    snapshots: { primary: { closedAt: Date.now() - 15 * 60_000, atr: 2 } },
    ...overrides,
  };
}

test("paper journal persists a candidate and resolves TP from closed candles", async () => {
  const originalFetch = globalThis.fetch;
  const database = new FakeD1();
  process.env.NODE_ENV = "test";
  globalThis.__PAPER_D1_TEST_BINDING__ = database;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("paper-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const runtime = { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };

  try {
    const generatedAt = new Date().toISOString();
    const sourceClosedAt = Date.parse(generatedAt) - 15 * 60_000;
    const candidate = validCandidate({ snapshots: { primary: { closedAt: sourceClosedAt, atr: 2 } } });
    const created = await worker.fetch(
      new Request("http://localhost/api/paper-trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidates: [candidate, { ...candidate, symbol: "ETHUSDT", baseAsset: "ETH", rankingScore: 69 }],
          generatedAt,
          dataHealth: healthyData(generatedAt),
        }),
      }),
      runtime,
      context,
    );
    assert.equal(created.status, 200);
    const createdBody = await created.json();
    assert.equal(createdBody.mode, "PAPER");
    assert.equal(createdBody.summary.open, 1);
    assert.equal(createdBody.account.initialCapitalUsd, 1000);
    assert.equal(createdBody.account.activeRiskModel, "FIXED_FRACTIONAL");
    assert.equal(createdBody.account.riskPerTradePct, 2);
    assert.ok(Math.abs(createdBody.account.openMarginUsd - 47.619047619) < 1e-6);
    assert.ok(Math.abs(createdBody.account.openPlannedRiskUsd - 20) < 1e-6);
    assert.equal(createdBody.account.balanceUsd, 1000);
    assert.equal(database.rows.length, 1);
    assert.equal(database.rows[0].model_version, "V3");
    const openEvidence = JSON.parse(database.rows[0].evidence_json);
    assert.equal(openEvidence.schemaVersion, "paper-evidence-v1");
    assert.equal(openEvidence.auditTrail.length, 1);
    assert.match(openEvidence.auditTrail[0].hash, /^[a-f0-9]{64}$/);

    const openedAt = Date.now() - 60 * 60_000;
    database.rows[0].opened_at = new Date(openedAt).toISOString();
    database.rows[0].last_checked_at = new Date(openedAt).toISOString();
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/fapi/v1/klines") {
        return new Response(JSON.stringify(Array.from({ length: 4 }, (_, index) => {
          const openTime = openedAt + index * 15 * 60_000;
          return [openTime, "100", index === 2 ? "107" : "103", "99", index === 2 ? "106.5" : "102", "1000", openTime + 15 * 60_000 - 1];
        })), { headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/futures/data/openInterestHist") {
        return new Response("[]", { headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const resolved = await worker.fetch(
      new Request("http://localhost/api/paper-trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidates: [], generatedAt: new Date().toISOString() }),
      }),
      runtime,
      context,
    );
    assert.equal(resolved.status, 200);
    const resolvedBody = await resolved.json();
    assert.equal(resolvedBody.summary.open, 0);
    assert.equal(resolvedBody.summary.wins, 1);
    assert.equal(resolvedBody.history[0].status, "TP");
    assert.ok(Math.abs(resolvedBody.history[0].outcomeR - 3.2) < 1e-9);
    assert.ok(Math.abs(resolvedBody.history[0].excursion.mfePct - 7) < 1e-9);
    assert.ok(Math.abs(resolvedBody.history[0].excursion.maePct - 1) < 1e-9);
    assert.ok(Math.abs(resolvedBody.history[0].excursion.mfeR - 3.5) < 1e-9);
    assert.ok(Math.abs(resolvedBody.history[0].excursion.maeR - 0.5) < 1e-9);
    assert.ok(Math.abs(resolvedBody.history[0].accounting.marginUsd - 47.619047619) < 1e-6);
    assert.equal(resolvedBody.history[0].accounting.leverage, 20);
    assert.ok(Math.abs(resolvedBody.history[0].accounting.netPnlUsd - 60) < 1e-6);
    assert.ok(Math.abs(resolvedBody.account.balanceUsd - 1060) < 1e-6);
    const closedEvidence = JSON.parse(database.rows[0].evidence_json);
    assert.equal(closedEvidence.auditTrail.length, 2);
    assert.equal(closedEvidence.auditTrail[1].event, "TP");
    assert.equal(closedEvidence.auditTrail[1].previousHash, closedEvidence.auditTrail[0].hash);
    assert.match(closedEvidence.auditTrail[1].hash, /^[a-f0-9]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__PAPER_D1_TEST_BINDING__;
  }
});

test("runtime safety blocks an otherwise valid entry without verified scan health", async () => {
  const database = new FakeD1();
  process.env.NODE_ENV = "test";
  globalThis.__PAPER_D1_TEST_BINDING__ = database;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("paper-health-circuit-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const generatedAt = new Date().toISOString();
  const response = await worker.fetch(
    new Request("http://localhost/api/paper-trades", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidates: [validCandidate()], generatedAt }),
    }),
    { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  assert.equal(database.rows.length, 0);
  assert.equal((await response.json()).summary.open, 0);
  delete globalThis.__PAPER_D1_TEST_BINDING__;
});

test("runtime safety enforces cooldown and structural reset after an SL", async () => {
  const stoppedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  const database = new FakeD1([row({
    status: "SL",
    exit_price: 98,
    outcome_r: -1,
    closed_at: stoppedAt,
    source_closed_at: Date.now() - 60 * 60_000,
  })]);
  process.env.NODE_ENV = "test";
  globalThis.__PAPER_D1_TEST_BINDING__ = database;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("paper-cooldown-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const generatedAt = new Date().toISOString();
  const response = await worker.fetch(
    new Request("http://localhost/api/paper-trades", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidates: [validCandidate({ snapshots: { primary: { closedAt: Date.now() - 5 * 60_000, atr: 2 } } })],
        generatedAt,
        dataHealth: healthyData(generatedAt),
      }),
    }),
    { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  assert.equal(database.rows.length, 1);
  assert.equal((await response.json()).summary.open, 0);
  delete globalThis.__PAPER_D1_TEST_BINDING__;
});

test("paper journal summary separates TP and SL records", async () => {
  const database = new FakeD1([
    row({ status: "TP", exit_price: 106, outcome_r: 3, closed_at: new Date().toISOString() }),
    row({ status: "SL", exit_price: 98, outcome_r: -1, observed_high: 101.2, closed_at: new Date().toISOString() }),
  ]);
  process.env.NODE_ENV = "test";
  globalThis.__PAPER_D1_TEST_BINDING__ = database;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("paper-summary-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/paper-trades"),
    { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.summary.resolved, 2);
  assert.equal(body.summary.wins, 1);
  assert.equal(body.summary.losses, 1);
  assert.equal(body.summary.winRate, 50);
  assert.equal(body.summary.expectancyR, 1);
  assert.equal(body.summary.allTotal, 2);
  assert.equal(body.summary.allResolved, 2);
  assert.equal(body.summary.allWins, 1);
  assert.equal(body.summary.allLosses, 1);
  assert.equal(body.summary.allNetR, 2);
  assert.equal(body.summary.slReachedHalfR, 1);
  assert.equal(body.summary.slReachedOneR, 0);
  assert.ok(Math.abs(body.summary.slAverageMfeR - 0.6) < 1e-9);
  assert.ok(Math.abs(body.account.realizedNetPnlUsd - 7.6) < 1e-9);
  assert.ok(Math.abs(body.account.balanceUsd - 1007.6) < 1e-9);
  assert.ok(Math.abs(body.account.profitFactor - (11.8 / 4.2)) < 1e-9);
  assert.equal(body.account.marginLossCaps, 0);
  delete globalThis.__PAPER_D1_TEST_BINDING__;
});

test("owner can manually close paper at the server live price with audited P&L", async () => {
  const originalFetch = globalThis.fetch;
  const originalRelayUrl = process.env.BINANCE_RELAY_URL;
  const originalRelayToken = process.env.BINANCE_RELAY_TOKEN;
  delete process.env.BINANCE_RELAY_URL;
  delete process.env.BINANCE_RELAY_TOKEN;
  const database = new FakeD1([row({ entry_price: 100, stop_loss: 98, take_profit: 106 })]);
  process.env.NODE_ENV = "test";
  globalThis.__PAPER_D1_TEST_BINDING__ = database;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/fapi/v1/ticker/24hr") {
      return new Response(JSON.stringify({ symbol: "BTCUSDT", lastPrice: "102" }), {
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("paper-manual-close-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const tradeId = database.rows[0].id;
    const response = await worker.fetch(
      new Request("http://localhost/api/paper-trades", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "MANUAL_CLOSE", tradeId }),
      }),
      { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.summary.open, 0);
    assert.equal(body.summary.manualClosed, 1);
    assert.equal(body.summary.wins, 0);
    assert.equal(body.summary.losses, 0);
    assert.equal(body.summary.winRate, 0);
    assert.equal(body.history[0].status, "MANUAL");
    assert.equal(body.history[0].exitPrice, 102);
    assert.equal(body.history[0].outcomeR, 1);
    assert.ok(Math.abs(body.history[0].accounting.netPnlUsd - 3.8) < 1e-9);
    assert.ok(Math.abs(body.account.balanceUsd - 1003.8) < 1e-9);
    const evidence = JSON.parse(database.rows[0].evidence_json);
    assert.equal(evidence.outcome.status, "MANUAL");
    assert.equal(evidence.auditTrail.at(-1).event, "MANUAL_CLOSE");
    assert.match(evidence.auditTrail.at(-1).hash, /^[a-f0-9]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__PAPER_D1_TEST_BINDING__;
    if (originalRelayUrl === undefined) delete process.env.BINANCE_RELAY_URL;
    else process.env.BINANCE_RELAY_URL = originalRelayUrl;
    if (originalRelayToken === undefined) delete process.env.BINANCE_RELAY_TOKEN;
    else process.env.BINANCE_RELAY_TOKEN = originalRelayToken;
  }
});

test("Risk Engine V3 accepts a wide technical stop but still rejects a failed hard gate", async () => {
  const database = new FakeD1();
  process.env.NODE_ENV = "test";
  globalThis.__PAPER_D1_TEST_BINDING__ = database;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("paper-risk-gate-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const generatedAt = new Date().toISOString();
  const candidate = {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    direction: "LONG",
    setupType: "Trend pullback",
    rankingScore: 88,
    technicalScore: 82,
    price: 100,
    stopLoss: 95,
    tp1: 115,
    tp2: 120,
    tp3: 125,
    reasons: [],
    catalysts: [],
    location: "fixture",
    paperGateFailures: [],
    risk: {
      version: "V3",
      assumedLeverage: 14,
      stopDistancePct: 5,
      stopDistanceAtr: 2.2,
      estimatedRoiAtStopPct: 70,
      netRiskReward: 3,
      maximumStopDistancePct: null,
      gateFailures: [],
      gatePass: true,
    },
    snapshots: { primary: { closedAt: Date.now() - 60_000, atr: 2.5 } },
  };
  const response = await worker.fetch(
    new Request("http://localhost/api/paper-trades", {
      method: "POST",
      headers: { "content-type": "application/json" },
    body: JSON.stringify({
      candidates: [candidate, { ...candidate, symbol: "ETHUSDT", baseAsset: "ETH", paperGateFailures: ["15M_NOT_ALIGNED"] }],
      generatedAt,
      dataHealth: healthyData(generatedAt),
    }),
    }),
    { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  assert.equal(database.rows.length, 1);
  const body = await response.json();
  assert.equal(body.summary.open, 1);
  assert.ok(Math.abs(body.openTrades[0].risk.estimatedLossAtStopUsd - 20) < 1e-6);
  assert.ok(body.openTrades[0].risk.stopDistancePct > 3);
  assert.equal(body.openTrades[0].risk.assumedLeverage, 13);
  delete globalThis.__PAPER_D1_TEST_BINDING__;
});

test("Risk Engine V3 caps open planned risk at 6% equity and 4% per direction", async () => {
  const database = new FakeD1();
  process.env.NODE_ENV = "test";
  globalThis.__PAPER_D1_TEST_BINDING__ = database;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("paper-risk-budget-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const generatedAt = new Date().toISOString();
  const sourceClosedAt = Date.now() - 15 * 60_000;
  const candidates = [
    validCandidate({ symbol: "BTCUSDT", baseAsset: "BTC", direction: "LONG", snapshots: { primary: { closedAt: sourceClosedAt, atr: 2 } } }),
    validCandidate({ symbol: "ETHUSDT", baseAsset: "ETH", direction: "LONG", snapshots: { primary: { closedAt: sourceClosedAt, atr: 2 } } }),
    validCandidate({ symbol: "SOLUSDT", baseAsset: "SOL", direction: "SHORT", snapshots: { primary: { closedAt: sourceClosedAt, atr: 2 } } }),
    validCandidate({ symbol: "XRPUSDT", baseAsset: "XRP", direction: "SHORT", snapshots: { primary: { closedAt: sourceClosedAt, atr: 2 } } }),
  ];
  const response = await worker.fetch(
    new Request("http://localhost/api/paper-trades", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidates, generatedAt, dataHealth: healthyData(generatedAt) }),
    }),
    { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(database.rows.length, 3);
  assert.equal(body.summary.open, 3);
  assert.ok(Math.abs(body.account.openPlannedRiskUsd - 60) < 1e-6);
  assert.ok(Math.abs(body.account.availableRiskUsd) < 1e-6);
  assert.equal(database.rows.filter((item) => item.direction === "LONG").length, 2);
  assert.equal(database.rows.filter((item) => item.direction === "SHORT").length, 1);
  delete globalThis.__PAPER_D1_TEST_BINDING__;
});

test("Risk Engine V3 statistics exclude legacy V1/V2 outcomes", async () => {
  const database = new FakeD1([
    row({ status: "TP", exit_price: 106, outcome_r: 3, closed_at: new Date().toISOString() }),
    row({ model_version: "V2", status: "TP", exit_price: 106, outcome_r: 3, closed_at: new Date().toISOString() }),
    row({ model_version: "V1", status: "SL", exit_price: 80, outcome_r: -1, closed_at: new Date().toISOString() }),
  ]);
  process.env.NODE_ENV = "test";
  globalThis.__PAPER_D1_TEST_BINDING__ = database;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("paper-legacy-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/paper-trades"),
    { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  const body = await response.json();
  assert.equal(body.summary.resolved, 1);
  assert.equal(body.summary.wins, 1);
  assert.equal(body.summary.losses, 0);
  assert.equal(body.summary.legacy, 2);
  assert.equal(body.summary.allResolved, 3);
  assert.equal(body.summary.allWins, 2);
  assert.equal(body.summary.allLosses, 1);
  assert.equal(body.account.marginLossCaps, 1);
  assert.equal(body.systemEvaluation.promotionDecision, "DO NOT PROMOTE");
  delete globalThis.__PAPER_D1_TEST_BINDING__;
});

test("live paper feed moves a filled target from running to result", async () => {
  const originalFetch = globalThis.fetch;
  const originalRelayUrl = process.env.BINANCE_RELAY_URL;
  const originalRelayToken = process.env.BINANCE_RELAY_TOKEN;
  delete process.env.BINANCE_RELAY_URL;
  delete process.env.BINANCE_RELAY_TOKEN;
  const database = new FakeD1([row({ entry_price: 100, stop_loss: 98, take_profit: 106 })]);
  process.env.NODE_ENV = "test";
  globalThis.__PAPER_D1_TEST_BINDING__ = database;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/fapi/v1/ticker/24hr") {
      return new Response(JSON.stringify([{ symbol: "BTCUSDT", lastPrice: "106.5" }]), {
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("paper-live-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/paper-prices?symbols=BTCUSDT"),
      { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.prices.BTCUSDT, 106.5);
    assert.equal(body.journal.summary.open, 0);
    assert.equal(body.journal.summary.wins, 1);
    assert.equal(body.journal.openTrades.length, 0);
    assert.equal(body.journal.history[0].status, "TP");
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__PAPER_D1_TEST_BINDING__;
    if (originalRelayUrl === undefined) delete process.env.BINANCE_RELAY_URL;
    else process.env.BINANCE_RELAY_URL = originalRelayUrl;
    if (originalRelayToken === undefined) delete process.env.BINANCE_RELAY_TOKEN;
    else process.env.BINANCE_RELAY_TOKEN = originalRelayToken;
  }
});

test("live paper feed removes a stopped trade from running and moves it to history", async () => {
  const originalFetch = globalThis.fetch;
  const originalRelayUrl = process.env.BINANCE_RELAY_URL;
  const originalRelayToken = process.env.BINANCE_RELAY_TOKEN;
  delete process.env.BINANCE_RELAY_URL;
  delete process.env.BINANCE_RELAY_TOKEN;
  const database = new FakeD1([row({ entry_price: 100, stop_loss: 98, take_profit: 106 })]);
  process.env.NODE_ENV = "test";
  globalThis.__PAPER_D1_TEST_BINDING__ = database;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/fapi/v1/ticker/24hr") {
      return new Response(JSON.stringify([{ symbol: "BTCUSDT", lastPrice: "97.5" }]), {
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("paper-live-sl-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/paper-prices?symbols=BTCUSDT"),
      { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.journal.summary.open, 0);
    assert.equal(body.journal.summary.losses, 1);
    assert.equal(body.journal.openTrades.length, 0);
    assert.equal(body.journal.history[0].status, "SL");
    assert.equal(body.journal.history[0].outcomeR, -1);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__PAPER_D1_TEST_BINDING__;
    if (originalRelayUrl === undefined) delete process.env.BINANCE_RELAY_URL;
    else process.env.BINANCE_RELAY_URL = originalRelayUrl;
    if (originalRelayToken === undefined) delete process.env.BINANCE_RELAY_TOKEN;
    else process.env.BINANCE_RELAY_TOKEN = originalRelayToken;
  }
});
