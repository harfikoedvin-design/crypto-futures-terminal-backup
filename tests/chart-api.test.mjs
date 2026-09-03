import assert from "node:assert/strict";
import test from "node:test";

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function candles(intervalMs) {
  const now = Date.now();
  return Array.from({ length: 220 }, (_, index) => {
    const openTime = now - intervalMs * (220 - index);
    const open = 100 + index * 0.2;
    const close = open + (index % 3 === 0 ? -0.08 : 0.14);
    return [
      openTime,
      String(open),
      String(Math.max(open, close) + 0.35),
      String(Math.min(open, close) - 0.28),
      String(close),
      String(1_000 + index * 4),
      openTime + intervalMs - 1,
    ];
  });
}

test("chart endpoint returns closed candles with EMA overlays", async () => {
  const originalFetch = globalThis.fetch;
  const originalRelayUrl = process.env.BINANCE_RELAY_URL;
  const originalRelayToken = process.env.BINANCE_RELAY_TOKEN;
  delete process.env.BINANCE_RELAY_URL;
  delete process.env.BINANCE_RELAY_TOKEN;

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/fapi/v1/klines") {
      const interval = url.searchParams.get("interval");
      return json(candles(interval === "4h" ? 14_400_000 : interval === "15m" ? 900_000 : 3_600_000));
    }
    if (url.pathname === "/fapi/v1/ticker/24hr") {
      return json({ symbol: "BTCUSDT", lastPrice: "143.95" });
    }
    if (url.pathname === "/futures/data/openInterestHist") {
      const now = Date.now();
      return json(Array.from({ length: 220 }, (_, index) => ({
        timestamp: now - 3_600_000 * (220 - index),
        sumOpenInterestValue: String(1_000_000 + index * 12_500),
      })));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("chart-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/chart?symbol=BTCUSDT&interval=1h"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.symbol, "BTCUSDT");
    assert.equal(body.interval, "1h");
    assert.equal(body.points.length, 120);
    assert.equal(body.livePrice, 143.95);
    assert.ok(body.levels.length >= 7);
    assert.ok(body.levels.some((level) => level.key === "PDH" && Number.isFinite(level.price)));
    assert.ok(body.levels.some((level) => level.key === "PWL" && Number.isFinite(level.price)));
    assert.ok(body.points.every((point) => point.time <= Date.now()));
    assert.ok(Number.isFinite(body.points.at(-1).ema21));
    assert.ok(Number.isFinite(body.points.at(-1).ema50));
    assert.equal(body.flowSource, "OPEN_INTEREST");
    assert.ok(Number.isFinite(body.points.at(-1).openInterestDelta));
    assert.ok(body.points.at(-1).openInterestDelta > 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRelayUrl === undefined) delete process.env.BINANCE_RELAY_URL;
    else process.env.BINANCE_RELAY_URL = originalRelayUrl;
    if (originalRelayToken === undefined) delete process.env.BINANCE_RELAY_TOKEN;
    else process.env.BINANCE_RELAY_TOKEN = originalRelayToken;
  }
});
