import assert from "node:assert/strict";
import test from "node:test";

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function text(value, contentType = "text/plain") {
  return new Response(value, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function fredCsv(id) {
  if (id === "CPIAUCSL") {
    const rows = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 6 + index, 1)).toISOString().slice(0, 10);
      return `${date},${320 + index}`;
    });
    return `observation_date,${id}\n${rows.join("\n")}`;
  }
  const base = { DGS10: 4.2, VIXCLS: 18.5, DTWEXBGS: 100, DFF: 5.25 }[id];
  const rows = Array.from({ length: 6 }, (_, index) =>
    `2026-08-${String(10 + index).padStart(2, "0")},${base + index * 0.1}`,
  );
  return `observation_date,${id}\n${rows.join("\n")}`;
}

test("context stays useful without FRED credentials", async () => {
  const originalFetch = globalThis.fetch;
  const originalFred = process.env.FRED_API_KEY;
  const originalArkham = process.env.ARKHAM_API_KEY;
  delete process.env.FRED_API_KEY;
  delete process.env.ARKHAM_API_KEY;
  const published = new Date().toISOString();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://cryptocurrency.cv/api/news")) {
      return json({
        articles: [
          { title: "Bitcoin ETF inflow supports rally", url: "https://www.coindesk.com/markets/a?utm_source=test", published_at: published, source: "CoinDesk" },
          { title: "Bitcoin ETF inflow supports rally", url: "https://www.reuters.com/technology/a?ref=test", published_at: published, source: "Reuters" },
          { title: "BTC adoption and accumulation expand", url: "https://www.bloomberg.com/news/b", published_at: published, source: "Bloomberg" },
          { title: "BTC hack risk from old report", url: "https://www.coindesk.com/markets/old", published_at: "2026-08-01T00:00:00Z", source: "CoinDesk" },
          { title: "Fed signals rate cut as inflation cools", url: "https://www.reuters.com/markets/c", published_at: published, source: "Reuters" },
        ],
      });
    }
    if (url.startsWith("https://gamma-api.polymarket.com/events")) {
      return json([{
        slug: "will-bitcoin-reach-150k-in-2026",
        title: "Will Bitcoin reach $150k in 2026?",
        endDate: "2026-12-31T23:59:59Z",
        active: true,
        closed: false,
        volume24hr: 500000,
        markets: [{
          question: "Will Bitcoin reach $150k in 2026?",
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.62","0.38"]',
          active: true,
          closed: false,
          acceptingOrders: true,
          volume24hr: 500000,
          liquidityNum: 100000,
          oneDayPriceChange: 0.03,
          endDate: "2026-12-31T23:59:59Z",
        }],
      }]);
    }
    if (url.startsWith("https://api.alternative.me/fng/")) {
      return json({ data: [
        { value: "42", value_classification: "Fear", timestamp: "1786924800" },
        { value: "39", value_classification: "Fear", timestamp: "1786838400" },
      ] });
    }
    if (url.startsWith("https://fred.stlouisfed.org/graph/fredgraph.csv")) {
      const id = new URL(url).searchParams.get("id");
      return text(fredCsv(id), "application/csv");
    }
    if (url.startsWith("https://www.bls.gov/schedule/news_release/bls.ics")) {
      return text([
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "DTSTART;TZID=America/New_York:20260904T083000",
        "SUMMARY:Employment Situation for August 2026",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"), "text/calendar");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("context-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    const items = encodeURIComponent(JSON.stringify([{ symbol: "BTCUSDT", direction: "LONG" }]));
    const symbols = encodeURIComponent(JSON.stringify(["BTCUSDT", "ETHUSDT"]));
    const response = await worker.fetch(
      new Request(`http://localhost/api/context?items=${items}&symbols=${symbols}`),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.news.state, "healthy");
    assert.equal(body.news.items.length, 4);
    assert.equal(body.news.quality.schemaVersion, "intel-v2");
    assert.equal(body.news.quality.duplicatesRemoved, 1);
    assert.ok(body.news.quality.fresh >= 3);
    assert.equal(body.news.quality.stale, 1);
    assert.match(body.news.items[0].evidenceHash, /^sha256:/);
    assert.equal(body.news.items.find((item) => item.headline.includes("ETF inflow")).independentSourceCount, 2);
    assert.equal(
      body.news.items.find((item) => item.headline.includes("rate cut")).marketImpact,
      "POSITIVE CRYPTO/USDT",
    );
    assert.equal(
      body.news.items.find((item) => item.headline.includes("rate cut")).impactConfidence,
      "MEDIUM",
    );
    assert.equal(body.fearGreed.value, 42);
    assert.equal(body.macro.state, "healthy");
    assert.equal(body.macro.sourceMode, "public_csv");
    assert.equal(body.macro.metrics.length, 5);
    assert.equal("social" in body, false);
    assert.equal(body.arkham.state, "disabled");
    assert.equal(body.arkham.items.length, 0);
    assert.equal(body.predictionMarkets.state, "healthy");
    assert.equal(body.predictionMarkets.items[0].probability, 62);
    assert.equal(body.predictionMarkets.items[0].category, "CRYPTO");
    assert.deepEqual(body.predictionMarkets.items[0].relatedAssets, ["BTC"]);
    assert.equal(body.predictionMarkets.items[0].change24h, 3);
    assert.match(body.predictionMarkets.items[0].sourceUrl, /^https:\/\/polymarket\.com\/event\//);
    assert.equal(body.events.state, "healthy");
    assert.ok(body.events.items.length > 0);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    assert.ok(Date.parse(body.events.items[0].scheduledAt ?? `${body.events.items[0].eventDate}T23:59:59Z`) >= startOfToday.getTime());
    assert.ok(body.events.items.some((event) => event.name.includes("Employment Situation")));
    assert.equal(body.context.BTCUSDT.adjustment, 3);
    assert.equal(body.context.BTCUSDT.newsAdjustment, 3);
    assert.equal("xAdjustment" in body.context.BTCUSDT, false);
    assert.equal("xSnapshot" in body.context.BTCUSDT, false);
    assert.match(body.context.BTCUSDT.catalysts[0], /ranking saja/i);
    assert.match(body.context.BTCUSDT.catalysts[0], /sumber independen/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFred === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = originalFred;
    if (originalArkham === undefined) delete process.env.ARKHAM_API_KEY;
    else process.env.ARKHAM_API_KEY = originalArkham;
  }
});
