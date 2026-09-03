import assert from "node:assert/strict";
import test from "node:test";

test("cross-exchange route remains authenticated, bounded, and shadow-only", async () => {
  const originalFetch = globalThis.fetch;
  const originalRelayUrl = process.env.BINANCE_RELAY_URL;
  const originalRelayToken = process.env.BINANCE_RELAY_TOKEN;
  process.env.BINANCE_RELAY_URL = "https://relay.example";
  process.env.BINANCE_RELAY_TOKEN = "relay-test-token";
  let sawRelay = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin === "https://relay.example" && url.pathname === "/api/cross-exchange") {
      sawRelay = true;
      assert.equal(init.headers["X-Relay-Token"], "relay-test-token");
      assert.equal(url.searchParams.get("symbol"), "BTCUSDT");
      assert.equal(url.searchParams.get("direction"), "SHORT");
      assert.equal(url.searchParams.get("referencePrice"), "100");
      return new Response(JSON.stringify({
        schemaVersion: "CROSS_EXCHANGE_V1",
        mode: "READ_ONLY_SHADOW",
        status: "CONFIRMED",
        confidence: "HIGH",
        summary: { available: 3, total: 3, aligned: 3, opposed: 0, neutral: 0, priceIntegrity: 3 },
        exchanges: [],
        generatedAt: "2026-08-26T04:00:00.000Z",
        evidenceHash: "a".repeat(64),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("cross-exchange-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const response = await worker.fetch(
      new Request("http://localhost/api/cross-exchange?symbol=BTCUSDT&direction=SHORT&referencePrice=100"),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(sawRelay, true);
    assert.equal(body.state, "healthy");
    assert.equal(body.mode, "READ_ONLY_SHADOW");
    assert.equal(body.status, "CONFIRMED");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRelayUrl === undefined) delete process.env.BINANCE_RELAY_URL;
    else process.env.BINANCE_RELAY_URL = originalRelayUrl;
    if (originalRelayToken === undefined) delete process.env.BINANCE_RELAY_TOKEN;
    else process.env.BINANCE_RELAY_TOKEN = originalRelayToken;
  }
});
