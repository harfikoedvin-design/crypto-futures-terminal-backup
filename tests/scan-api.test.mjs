import assert from "node:assert/strict";
import test from "node:test";

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function candles(intervalMs, direction = "up") {
  const now = Date.now();
  return Array.from({ length: 220 }, (_, index) => {
    const openTime = now - intervalMs * (220 - index);
    const open = direction === "up" ? 100 + index * 0.2 : 144 - index * 0.2;
    const close = direction === "up" ? open + 0.15 : open - 0.15;
    return [
      openTime,
      String(open),
      String(close + 0.45),
      String(open - 0.35),
      String(close),
      String(1_000 + index * 3),
      openTime + intervalMs - 1,
    ];
  });
}

function marketFetch(direction = "up") {
  const lastPrice = direction === "up" ? "143.95" : "100.05";
  const bidPrice = direction === "up" ? "143.94" : "100.04";
  const askPrice = direction === "up" ? "143.96" : "100.06";
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/fapi/v1/exchangeInfo") {
      return json({ symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", contractType: "PERPETUAL", status: "TRADING" }] });
    }
    if (url.pathname === "/fapi/v1/ticker/24hr") {
      const ticker = { symbol: "BTCUSDT", lastPrice, priceChangePercent: direction === "up" ? "2.5" : "-2.5", quoteVolume: "900000000" };
      return json(url.searchParams.has("symbol") ? ticker : [ticker]);
    }
    if (url.pathname === "/fapi/v1/ticker/bookTicker") {
      const book = { symbol: "BTCUSDT", bidPrice, askPrice };
      return json(url.searchParams.has("symbol") ? book : [book]);
    }
    if (url.pathname === "/fapi/v1/premiumIndex") {
      const premium = { symbol: "BTCUSDT", lastFundingRate: "0.0001" };
      return json(url.searchParams.has("symbol") ? premium : [premium]);
    }
    if (url.pathname === "/fapi/v1/klines") {
      const interval = url.searchParams.get("interval");
      return json(candles(interval === "4h" ? 14_400_000 : interval === "1h" ? 3_600_000 : 900_000, direction));
    }
    if (url.pathname === "/futures/data/openInterestHist") {
      return json([100, 101, 102, 103].map((value) => ({ sumOpenInterestValue: String(value) })));
    }
    if (url.pathname === "/futures/data/takerlongshortRatio") {
      return json(Array.from({ length: 4 }, () => ({ buySellRatio: direction === "up" ? "1.10" : "0.90" })));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test("batch scan returns diagnostics from closed Binance candles", async () => {
  const originalFetch = globalThis.fetch;
  const originalRelayUrl = process.env.BINANCE_RELAY_URL;
  const originalRelayToken = process.env.BINANCE_RELAY_TOKEN;
  delete process.env.BINANCE_RELAY_URL;
  delete process.env.BINANCE_RELAY_TOKEN;

  globalThis.fetch = marketFetch("up");

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("scan-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/scan"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.universe.length, 1);
    assert.equal(body.results.length, 1);
    assert.equal(body.dataHealth.schemaVersion, "data-health-v1");
    assert.equal(body.dataHealth.state, "HEALTHY");
    assert.equal(body.results[0].diagnostic.symbol, "BTCUSDT");
    assert.ok(body.results[0].diagnostic.technicalScore > 0);
    assert.ok(body.results[0].diagnostic.oiChangePercent > 0);
    assert.equal(body.results[0].diagnostic.takerBuySellRatio, 1.1);
    assert.ok(body.results[0].diagnostic.snapshots);
    assert.ok("watchCandidate" in body.results[0]);
    assert.ok(body.results[0].earlySignal);
    assert.equal(body.results[0].earlySignal.symbol, "BTCUSDT");
    assert.ok(["BASE ZONE", "ACCUMULATING", "ARMED", "WAIT", "LATE", "INVALID"].includes(body.results[0].earlySignal.status));
    assert.equal(body.results[0].earlySignal.direction, "LONG");
    assert.ok(body.results[0].earlySignal.nearestLevel.price > 0);
    assert.ok(Number.isFinite(body.results[0].earlySignal.nearestLevel.distanceAtr));
    assert.ok(["LOW", "NORMAL", "HIGH"].includes(body.results[0].earlySignal.volatilityState));
    assert.ok(Number.isFinite(body.results[0].earlySignal.atrPercentile));
    assert.ok(Number.isFinite(body.results[0].earlySignal.volumeRatio));
    assert.equal(body.results[0].diagnostic.adaptiveShadow.version, "ADAPTIVE_V3_SHADOW");
    assert.equal(body.results[0].diagnostic.adaptiveShadow.mode, "SHADOW");
    assert.equal(body.results[0].diagnostic.adaptiveShadow.direction, "LONG");
    assert.ok(body.results[0].diagnostic.adaptiveShadow.longScore > body.results[0].diagnostic.adaptiveShadow.shortScore);
    assert.ok(body.results[0].diagnostic.adaptiveShadow.stopLoss > 0);
    assert.ok(body.results[0].diagnostic.adaptiveShadow.takeProfit > 0);
    assert.ok(!body.results[0].failedGates.includes("PROVIDER_UNAVAILABLE"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRelayUrl === undefined) delete process.env.BINANCE_RELAY_URL;
    else process.env.BINANCE_RELAY_URL = originalRelayUrl;
    if (originalRelayToken === undefined) delete process.env.BINANCE_RELAY_TOKEN;
    else process.env.BINANCE_RELAY_TOKEN = originalRelayToken;
  }
});

test("adaptive shadow scores a bearish market as SHORT without opening a paper trade", async () => {
  const originalFetch = globalThis.fetch;
  const originalRelayUrl = process.env.BINANCE_RELAY_URL;
  const originalRelayToken = process.env.BINANCE_RELAY_TOKEN;
  delete process.env.BINANCE_RELAY_URL;
  delete process.env.BINANCE_RELAY_TOKEN;
  globalThis.fetch = marketFetch("down");

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("scan-short-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/scan"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dataHealth.schemaVersion, "data-health-v1");
    assert.equal(body.dataHealth.state, "HEALTHY");
    const diagnostic = body.results[0].diagnostic;
    assert.equal(diagnostic.direction, "SHORT");
    assert.equal(diagnostic.adaptiveShadow.version, "ADAPTIVE_V3_SHADOW");
    assert.equal(diagnostic.adaptiveShadow.mode, "SHADOW");
    assert.equal(diagnostic.adaptiveShadow.direction, "SHORT");
    assert.ok(diagnostic.adaptiveShadow.shortScore > diagnostic.adaptiveShadow.longScore);
    assert.ok(diagnostic.adaptiveShadow.executionEntry > 0);
    assert.ok(diagnostic.adaptiveShadow.stopLoss > diagnostic.adaptiveShadow.executionEntry);
    assert.ok(diagnostic.adaptiveShadow.takeProfit < diagnostic.adaptiveShadow.executionEntry);
    assert.ok(diagnostic.adaptiveShadow.risk);
    assert.equal(body.results[0].earlySignal.direction, "SHORT");
    assert.ok(["BASE ZONE", "ACCUMULATING", "ARMED", "WAIT", "LATE", "INVALID"].includes(body.results[0].earlySignal.status));
    assert.ok(body.results[0].earlySignal.nearestLevel.price > 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRelayUrl === undefined) delete process.env.BINANCE_RELAY_URL;
    else process.env.BINANCE_RELAY_URL = originalRelayUrl;
    if (originalRelayToken === undefined) delete process.env.BINANCE_RELAY_TOKEN;
    else process.env.BINANCE_RELAY_TOKEN = originalRelayToken;
  }
});
