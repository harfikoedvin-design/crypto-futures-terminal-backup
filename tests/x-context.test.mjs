import assert from "node:assert/strict";
import test from "node:test";

function response(value, contentType = "application/json") {
  return new Response(contentType === "application/json" ? JSON.stringify(value) : value, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function fredCsv(id) {
  const count = id === "CPIAUCSL" ? 14 : 6;
  const start = id === "CPIAUCSL" ? 300 : id === "VIXCLS" ? 18 : id === "DTWEXBGS" ? 100 : 4;
  const rows = Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(id === "CPIAUCSL" ? 2025 : 2026, index, 1)).toISOString().slice(0, 10);
    return `${date},${start + index * 0.1}`;
  });
  return `observation_date,${id}\n${rows.join("\n")}`;
}

test("context never calls the removed X screening endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const originalRelayUrl = process.env.BINANCE_RELAY_URL;
  const originalRelayToken = process.env.BINANCE_RELAY_TOKEN;
  const originalFred = process.env.FRED_API_KEY;
  const originalArkham = process.env.ARKHAM_API_KEY;
  process.env.BINANCE_RELAY_URL = "https://relay.example";
  process.env.BINANCE_RELAY_TOKEN = "relay-test-token";
  process.env.ARKHAM_API_KEY = "arkham-test-token";
  delete process.env.FRED_API_KEY;
  let sawX = false;
  let sawArkham = false;
  const published = new Date().toISOString();

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("https://cryptocurrency.cv/api/news")) {
      return response({ articles: [
        { title: "Bitcoin ETF inflow supports rally", url: "https://www.coindesk.com/markets/a", published_at: published, source: "CoinDesk" },
        { title: "BTC adoption and accumulation expand", url: "https://www.reuters.com/technology/b", published_at: published, source: "Reuters" },
      ] });
    }
    if (url.startsWith("https://api.alternative.me/fng/")) {
      return response({ data: [
        { value: "50", value_classification: "Neutral", timestamp: "1786924800" },
        { value: "48", value_classification: "Neutral", timestamp: "1786838400" },
      ] });
    }
    if (url.startsWith("https://gamma-api.polymarket.com/events")) {
      return response([]);
    }
    if (url.startsWith("https://fred.stlouisfed.org/graph/fredgraph.csv")) {
      const id = new URL(url).searchParams.get("id");
      return response(fredCsv(id), "application/csv");
    }
    if (url.startsWith("https://www.bls.gov/schedule/news_release/bls.ics")) {
      return response("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260904T123000Z\r\nSUMMARY:Employment Situation for August 2026\r\nEND:VEVENT\r\nEND:VCALENDAR", "text/calendar");
    }
    if (url === "https://relay.example/api/x") {
      sawX = true;
      throw new Error("Removed X screening endpoint was called");
    }
    if (url.startsWith("https://api.arkm.com/token/top")) {
      sawArkham = true;
      assert.equal(init.headers["API-Key"], "arkham-test-token");
      return response({ data: [
        { symbol: "BTC", inflowUsd: 2_000_000, outflowUsd: 5_000_000 },
        { symbol: "NOTINUNIVERSE", inflowUsd: 1, outflowUsd: 10 },
      ] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("x-context-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const items = encodeURIComponent(JSON.stringify([{ symbol: "BTCUSDT", direction: "LONG" }]));
    const symbols = encodeURIComponent(JSON.stringify(["BTCUSDT", "ETHUSDT"]));
    const result = await worker.fetch(
      new Request(`http://localhost/api/context?items=${items}&symbols=${symbols}`),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.equal(sawX, false);
    assert.equal("social" in body, false);
    assert.equal(sawArkham, true);
    assert.equal(body.arkham.state, "healthy");
    assert.equal(body.arkham.items[0].asset, "BTC");
    assert.equal(body.arkham.items[0].bias, "ACCUMULATION");
    assert.equal(body.context.BTCUSDT.adjustment, 3);
    assert.equal(body.context.BTCUSDT.newsAdjustment, 3);
    assert.equal("xAdjustment" in body.context.BTCUSDT, false);
    assert.equal("xSnapshot" in body.context.BTCUSDT, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRelayUrl === undefined) delete process.env.BINANCE_RELAY_URL;
    else process.env.BINANCE_RELAY_URL = originalRelayUrl;
    if (originalRelayToken === undefined) delete process.env.BINANCE_RELAY_TOKEN;
    else process.env.BINANCE_RELAY_TOKEN = originalRelayToken;
    if (originalFred === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = originalFred;
    if (originalArkham === undefined) delete process.env.ARKHAM_API_KEY;
    else process.env.ARKHAM_API_KEY = originalArkham;
  }
});
