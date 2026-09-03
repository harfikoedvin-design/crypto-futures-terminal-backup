import assert from "node:assert/strict";
import test from "node:test";

const FIXTURE_NOW = Date.now();

class FakeHotVolumeD1 {
  constructor() { this.rows = new Map(); }
  prepare(sql) {
    let values = [];
    return {
      bind(...input) { values = input; return this; },
      all: async () => {
        const rows = [...this.rows.values()];
        if (sql.includes("status = 'OPEN'")) return { results: rows.filter((row) => row.status === "OPEN") };
        if (sql.includes("hot_volume_observations")) return { results: rows };
        return { results: [] };
      },
      run: async () => {
        if (sql.includes("INSERT OR IGNORE INTO hot_volume_observations")) {
          const row = {
            id: values[0], signal_key: values[1], cohort_key: values[2], evaluation_version: values[3], variant: values[4],
            symbol: values[5], base_asset: values[6], direction: values[7], radar_status: values[8], radar_score: values[9],
            entry_price: values[10], stop_loss: values[11], take_profit: values[12], atr_15m: values[13], status: "OPEN",
            outcome_r: null, exit_price: null, opened_at: values[14], closed_at: null, last_checked_at: values[15],
            observed_high: values[16], observed_low: values[17], source_closed_at: values[18], open_evidence_hash: values[19],
            outcome_evidence_hash: null, evidence_json: values[20],
          };
          if (!this.rows.has(row.signal_key)) this.rows.set(row.signal_key, row);
        }
        return { success: true };
      },
    };
  }
}

function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function candles(intervalMs, direction, count) {
  const now = FIXTURE_NOW - intervalMs;
  return Array.from({ length: count }, (_, index) => {
    const openTime = now - intervalMs * (count - index);
    const rising = direction !== "down";
    const trend = rising ? index * 0.02 : -index * 0.02;
    const open = 100 + trend;
    const finalMove = direction === "chase" ? 5 : rising ? 0.3 : -0.3;
    const close = open + (index === count - 1 ? finalMove : rising ? 0.02 : -0.02);
    const quoteVolume = index === count - 1 ? 300_000 : 100_000;
    return [openTime, String(open), String(Math.max(open, close) + 0.2), String(Math.min(open, close) - 0.2), String(close), "1000", openTime + intervalMs - 1, String(quoteVolume)];
  });
}

function hotVolumeFetch() {
  return async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.coingecko.com") {
      return json([
        { symbol: "hotl", market_cap: 50_000_000, total_volume: 10_000_000 },
        { symbol: "hots", market_cap: 60_000_000, total_volume: 10_000_000 },
        { symbol: "chase", market_cap: 70_000_000, total_volume: 10_000_000 },
        { symbol: "big", market_cap: 2_000_000_000, total_volume: 100_000_000 },
      ]);
    }
    if (url.pathname === "/fapi/v1/exchangeInfo") {
      return json({ symbols: [
        { symbol: "HOTLUSDT", baseAsset: "HOTL", quoteAsset: "USDT", contractType: "PERPETUAL", status: "TRADING" },
        { symbol: "HOTSUSDT", baseAsset: "HOTS", quoteAsset: "USDT", contractType: "PERPETUAL", status: "TRADING" },
        { symbol: "CHASEUSDT", baseAsset: "CHASE", quoteAsset: "USDT", contractType: "PERPETUAL", status: "TRADING" },
        { symbol: "BIGUSDT", baseAsset: "BIG", quoteAsset: "USDT", contractType: "PERPETUAL", status: "TRADING" },
      ] });
    }
    if (url.pathname === "/fapi/v1/ticker/24hr") {
      return json(["HOTLUSDT", "HOTSUSDT", "CHASEUSDT", "BIGUSDT"].map((symbol) => ({ symbol, lastPrice: "100", priceChangePercent: symbol === "HOTSUSDT" ? "-1" : "1", quoteVolume: "10000000" })));
    }
    if (url.pathname === "/fapi/v1/ticker/bookTicker") {
      return json(["HOTLUSDT", "HOTSUSDT", "CHASEUSDT", "BIGUSDT"].map((symbol) => ({ symbol, bidPrice: "99.99", askPrice: "100.01" })));
    }
    if (url.pathname === "/fapi/v1/premiumIndex") {
      return json(["HOTLUSDT", "HOTSUSDT", "CHASEUSDT", "BIGUSDT"].map((symbol) => ({ symbol, lastFundingRate: "0.0001" })));
    }
    if (url.pathname === "/fapi/v1/klines") {
      const symbol = url.searchParams.get("symbol");
      const direction = symbol === "HOTSUSDT" ? "down" : symbol === "CHASEUSDT" ? "chase" : "up";
      const interval = url.searchParams.get("interval");
      const intervalMs = interval === "5m" ? 300_000 : interval === "15m" ? 900_000 : 3_600_000;
      const count = interval === "5m" ? 12 : interval === "15m" ? 40 : 170;
      return json(candles(intervalMs, direction, count));
    }
    if (url.pathname === "/futures/data/openInterestHist") {
      return json(Array.from({ length: 25 }, (_, index) => ({ sumOpenInterestValue: String(1_000_000 + index * 10_000) })));
    }
    if (url.pathname === "/futures/data/takerlongshortRatio") {
      const ratio = url.searchParams.get("symbol") === "HOTSUSDT" ? "0.80" : "1.20";
      return json([{ buySellRatio: ratio }, { buySellRatio: ratio }]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

function coinPaprikaTickers() {
  return [
    { symbol: "HOTL", quotes: { USD: { market_cap: 50_000_000, volume_24h: 10_000_000 } } },
    { symbol: "HOTS", quotes: { USD: { market_cap: 60_000_000, volume_24h: 10_000_000 } } },
    { symbol: "CHASE", quotes: { USD: { market_cap: 70_000_000, volume_24h: 10_000_000 } } },
    { symbol: "BIG", quotes: { USD: { market_cap: 2_000_000_000, volume_24h: 100_000_000 } } },
  ];
}

function coinLoreTickers() {
  return { data: [
    { symbol: "HOTL", market_cap_usd: "50000000" },
    { symbol: "HOTS", market_cap_usd: "60000000" },
    { symbol: "CHASE", market_cap_usd: "70000000" },
    { symbol: "BIG", market_cap_usd: "2000000000" },
  ] };
}

test("Hot Volume Radar fails closed when market-cap verification is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const originalRelayUrl = process.env.BINANCE_RELAY_URL;
  const originalRelayToken = process.env.BINANCE_RELAY_TOKEN;
  delete process.env.BINANCE_RELAY_URL;
  delete process.env.BINANCE_RELAY_TOKEN;
  const healthyFetch = hotVolumeFetch();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.coingecko.com") throw new Error("market-cap fixture unavailable");
    return healthyFetch(input);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("hot-volume-fail-closed-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/hot-volume"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source.state, "DEGRADED");
    assert.equal(body.summary.scanned, 0);
    assert.equal(body.candidates.length, 0);
    assert.ok(body.source.reasons.some((reason) => /market cap providers unavailable/i.test(reason)));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRelayUrl === undefined) delete process.env.BINANCE_RELAY_URL;
    else process.env.BINANCE_RELAY_URL = originalRelayUrl;
    if (originalRelayToken === undefined) delete process.env.BINANCE_RELAY_TOKEN;
    else process.env.BINANCE_RELAY_TOKEN = originalRelayToken;
  }
});

test("Hot Volume Radar falls back to CoinPaprika when CoinGecko is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const originalRelayUrl = process.env.BINANCE_RELAY_URL;
  const originalRelayToken = process.env.BINANCE_RELAY_TOKEN;
  delete process.env.BINANCE_RELAY_URL;
  delete process.env.BINANCE_RELAY_TOKEN;
  const healthyFetch = hotVolumeFetch();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.coingecko.com") throw new Error("CoinGecko unavailable");
    if (url.hostname === "api.coinpaprika.com") return json(coinPaprikaTickers());
    return healthyFetch(input);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("hot-volume-fallback-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/hot-volume"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source.state, "HEALTHY");
    assert.equal(body.source.marketCap, "COINPAPRIKA_KEYLESS");
    assert.equal(body.candidates.length, 3);
    assert.ok(!body.candidates.some((item) => item.symbol === "BIGUSDT"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRelayUrl === undefined) delete process.env.BINANCE_RELAY_URL;
    else process.env.BINANCE_RELAY_URL = originalRelayUrl;
    if (originalRelayToken === undefined) delete process.env.BINANCE_RELAY_TOKEN;
    else process.env.BINANCE_RELAY_TOKEN = originalRelayToken;
  }
});

test("Hot Volume Radar falls back to CoinLore when the first two providers are unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const originalRelayUrl = process.env.BINANCE_RELAY_URL;
  const originalRelayToken = process.env.BINANCE_RELAY_TOKEN;
  delete process.env.BINANCE_RELAY_URL;
  delete process.env.BINANCE_RELAY_TOKEN;
  const healthyFetch = hotVolumeFetch();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.coingecko.com" || url.hostname === "api.coinpaprika.com") {
      throw new Error("Primary market-cap provider unavailable");
    }
    if (url.hostname === "api.coinlore.net") return json(coinLoreTickers());
    return healthyFetch(input);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("hot-volume-coinlore-fallback-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/hot-volume"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source.state, "HEALTHY");
    assert.equal(body.source.marketCap, "COINLORE_KEYLESS");
    assert.equal(body.candidates.length, 3);
    assert.ok(!body.candidates.some((item) => item.symbol === "BIGUSDT"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRelayUrl === undefined) delete process.env.BINANCE_RELAY_URL;
    else process.env.BINANCE_RELAY_URL = originalRelayUrl;
    if (originalRelayToken === undefined) delete process.env.BINANCE_RELAY_TOKEN;
    else process.env.BINANCE_RELAY_TOKEN = originalRelayToken;
  }
});

test("Hot Volume Evidence persists RAW/HARDENED cohorts and deduplicates the same closed candle", async () => {
  const originalFetch = globalThis.fetch;
  const database = new FakeHotVolumeD1();
  globalThis.__HOT_VOLUME_D1_TEST_BINDING__ = database;
  globalThis.fetch = hotVolumeFetch();
  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("hot-volume-evidence-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const request = () => new Request("http://localhost/api/hot-volume", { method: "POST" });
    const runtime = { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
    const first = await worker.fetch(request(), runtime, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.evaluation.schemaVersion, "hot-volume-evidence-v2");
    assert.equal(body.evaluation.mode, "SHADOW_READ_ONLY");
    assert.equal(body.evaluation.raw.total, 3);
    assert.ok(body.evaluation.hardened.total <= body.evaluation.raw.total);
    assert.equal(body.evaluation.pairedResolved, 0);
    assert.equal(body.evaluation.verdict, "INSUFFICIENT DATA");
    const firstCount = database.rows.size;
    const second = await worker.fetch(request(), runtime, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(second.status, 200);
    assert.equal(database.rows.size, firstCount);
    assert.ok([...database.rows.values()].every((row) => /^[a-f0-9]{64}$/.test(row.open_evidence_hash)));
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__HOT_VOLUME_D1_TEST_BINDING__;
  }
});

test("Hot Volume Radar applies market-cap, volume acceleration, and symmetric direction gates", async () => {
  const originalFetch = globalThis.fetch;
  const originalRelayUrl = process.env.BINANCE_RELAY_URL;
  const originalRelayToken = process.env.BINANCE_RELAY_TOKEN;
  delete process.env.BINANCE_RELAY_URL;
  delete process.env.BINANCE_RELAY_TOKEN;
  globalThis.fetch = hotVolumeFetch();

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("hot-volume-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/hot-volume"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schemaVersion, "hot-volume-radar-v1");
    assert.equal(body.mode, "SHADOW_ONLY");
    assert.equal(body.source.market, "BINANCE_USDS_M");
    assert.equal(body.source.marketCap, "COINGECKO_KEYLESS");
    assert.equal(body.rules.minimumVolume24hUsd, 100_000);
    assert.equal(body.rules.minimumMarketCapUsd, 1_000_000);
    assert.equal(body.rules.maximumMarketCapUsd, 1_000_000_000);
    assert.equal(body.candidates.length, 3);
    assert.ok(!body.candidates.some((item) => item.symbol === "BIGUSDT"));
    const long = body.candidates.find((item) => item.symbol === "HOTLUSDT");
    const short = body.candidates.find((item) => item.symbol === "HOTSUSDT");
    const chase = body.candidates.find((item) => item.symbol === "CHASEUSDT");
    assert.equal(long.direction, "LONG");
    assert.equal(short.direction, "SHORT");
    assert.ok(long.volumeChange.h1 >= 100);
    assert.ok(short.volumeChange.h1 >= 100);
    assert.ok(["BREAKOUT_READY", "BREAKOUT_CONFIRMED", "READY", "LONG_PRESSURE"].includes(long.status));
    assert.ok(["BREAKOUT_READY", "BREAKOUT_CONFIRMED", "READY", "SHORT_PRESSURE"].includes(short.status));
    assert.equal(typeof long.breakout.confirmed, "boolean");
    assert.equal(typeof short.breakout.confirmed, "boolean");
    assert.ok(["LONG", "SHORT", "NEUTRAL"].includes(long.breakout.direction));
    assert.equal(typeof long.retest.confirmed, "boolean");
    assert.equal(typeof long.retest.distanceAtr, "number");
    assert.equal(typeof long.regime.aligned, "boolean");
    assert.equal(typeof long.regime.oneHourEma21, "number");
    assert.equal(typeof body.summary.breakoutReady, "number");
    assert.equal(chase.status, "CHASE_RISK");
    assert.equal(long.liquidation24hUsd, null);
    assert.equal(short.liquidation24hUsd, null);
    assert.equal(body.summary.long, 2);
    assert.equal(body.summary.short, 1);
    assert.ok(body.summary.chaseRisk >= 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRelayUrl === undefined) delete process.env.BINANCE_RELAY_URL;
    else process.env.BINANCE_RELAY_URL = originalRelayUrl;
    if (originalRelayToken === undefined) delete process.env.BINANCE_RELAY_TOKEN;
    else process.env.BINANCE_RELAY_TOKEN = originalRelayToken;
  }
});
