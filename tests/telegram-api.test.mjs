import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

class FakeD1 {
  constructor() { this.settings = new Map(); }
  prepare(sql) {
    let values = [];
    const settings = this.settings;
    return {
      bind(...bound) { values = bound; return this; },
      async first() {
        if (sql.includes("SELECT value FROM telegram_settings")) {
          const value = settings.get(String(values[0]));
          return value === undefined ? null : { value };
        }
        if (sql.includes("telegram_subscriptions")) return { count: 0 };
        return null;
      },
      async all() { return { results: [] }; },
      async run() {
        if (sql.includes("INSERT INTO telegram_settings")) settings.set(String(values[0]), String(values[1]));
        return { success: true };
      },
    };
  }
}

async function worker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("telegram-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

const context = { waitUntil() {}, passThroughOnException() {} };

test("Telegram companion is disabled by default and never exposes a token", async () => {
  globalThis.__TELEGRAM_D1_TEST_BINDING__ = new FakeD1();
  globalThis.__TELEGRAM_ENV_TEST_BINDING__ = {};
  const app = await worker();
  const response = await app.fetch(new Request("http://localhost/api/telegram/status"), {
    DB: new FakeD1(),
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, context);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "READ_ONLY_COMPANION");
  assert.equal(body.schemaVersion, "telegram-companion-v3");
  assert.equal(body.configured, false);
  assert.equal(body.paired, false);
  assert.equal(body.backgroundReady, false);
  assert.equal(body.evidenceGate, "UNAVAILABLE");
  assert.equal(body.promotionGates.early.verdict, "INSUFFICIENT DATA");
  assert.equal(body.promotionGates.early.targetResolved, 30);
  assert.equal(body.promotionGates.hotVolume.verdict, "UNAVAILABLE");
  assert.deepEqual(body.safety, ["NO_ORDER_API", "NO_PRIVATE_EXCHANGE_KEY", "AUTO_PAPER_ONLY", "STATE_CHANGE_ALERTS_ONLY"]);
  assert.doesNotMatch(JSON.stringify(body), /bot_token|webhook_secret|pairing_code/i);
});

test("owner setup validates the expected bot and stores its token encrypted", async () => {
  const database = new FakeD1();
  globalThis.__TELEGRAM_D1_TEST_BINDING__ = database;
  globalThis.__TELEGRAM_ENV_TEST_BINDING__ = {
    TELEGRAM_CONFIG_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    TELEGRAM_PAIRING_CODE: "FIKO-8264",
    TELEGRAM_EXPECTED_BOT_USERNAME: "FikoFuturesMonitorBot",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/getMe")) return Response.json({ ok: true, result: { id: 123, is_bot: true, username: "FikoFuturesMonitorBot" } });
    if (url.endsWith("/deleteWebhook")) return Response.json({ ok: true, result: true });
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    const app = await worker();
    const token = `123456789:${"A".repeat(40)}`;
    const response = await app.fetch(new Request("http://localhost/api/telegram/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }), { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, context);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.botUsername, "FikoFuturesMonitorBot");
    assert.equal(body.pairingCommand, "/start FIKO-8264");
    assert.doesNotMatch(JSON.stringify(body), new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(database.settings.get("bot_token"), /^v1\./);
    assert.notEqual(database.settings.get("bot_token"), token);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram webhook and scheduler fail closed without valid secrets", async () => {
  globalThis.__TELEGRAM_D1_TEST_BINDING__ = new FakeD1();
  globalThis.__TELEGRAM_ENV_TEST_BINDING__ = {};
  const app = await worker();
  const runtime = { DB: new FakeD1(), ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const webhook = await app.fetch(new Request("http://localhost/api/telegram/webhook", { method: "POST", body: "{}" }), runtime, context);
  const monitor = await app.fetch(new Request("http://localhost/api/telegram/monitor", { method: "POST" }), runtime, context);
  assert.equal(webhook.status, 401);
  assert.equal(monitor.status, 401);
});

test("monitor policy requires structure plus momentum; volume alone is context", async () => {
  const source = await readFile(new URL("../lib/telegram-monitor.ts", import.meta.url), "utf8");
  assert.match(source, /structureLost && momentumAdverse/);
  assert.match(source, /tidak menjadi alasan close sendirian/i);
  assert.match(source, /currentR >= 1/);
  assert.doesNotMatch(source, /relativeVolume\s*[<>]=?\s*[\d.]+\)\s*return \{ state: "CLOSE_REVIEW"/);
});

test("terminal manual execution is owner-controlled and independent from Telegram pairing", async () => {
  const [source, route] = await Promise.all([
    readFile(new URL("../lib/telegram-monitor.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/manual-execution/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireViewerApi/);
  assert.match(route, /requireOwnerApi/);
  assert.match(route, /EXECUTE/);
  assert.match(route, /PASS/);
  assert.match(source, /terminal-manual-v1:/);
  assert.match(source, /chat_id.*NULL/si);
  assert.match(source, /if \(row\.chat_id\)/);
  assert.match(source, /if \(!row\.chat_id\) return/);
});

test("Telegram paper/shadow offers require KEEP and state alerts attach a bounded chart snapshot", async () => {
  const source = await readFile(new URL("../lib/telegram-monitor.ts", import.meta.url), "utf8");
  assert.match(source, /evaluation\.verdict !== "KEEP"/);
  assert.match(source, /BLOCKED_EVIDENCE_GATE/);
  assert.match(source, /telegram-hot-breakout-v2/);
  assert.match(source, /telegram-early-learning-v2/);
  assert.match(source, /signal-policy-v83/);
  assert.match(source, /BREAKOUT_READY/);
  assert.match(source, /TELEGRAM_EXECUTION_MIN_SCORE = 75/);
  assert.match(source, /TELEGRAM_HOT_VOLUME_MIN_SCORE = 80/);
  assert.match(source, /TELEGRAM_QUALITY_MIN_CATEGORIES = 4/);
  assert.match(source, /signal\.status === "ARMED"/);
  assert.match(source, /candidate\.status === "BREAKOUT_READY"/);
  assert.match(source, /evaluateEarlyTelegramQuality\(signal\)\.passed/);
  assert.match(source, /evaluateHotVolumeTelegramQuality\(candidate\)\.passed/);
  assert.match(source, /promotion\.verdict !== "KEEP"/);
  assert.match(source, /LEARNING_SHADOW/);
  assert.match(source, /SHADOW_ONLY/);
  assert.match(source, /EARLY_PROMOTION_TARGET_RESOLVED = 30/);
  assert.match(source, /candidate\.retest\.confirmed/);
  assert.match(source, /candidate\.regime\.aligned/);
  assert.match(source, /momentumNotExhausted/);
  assert.match(source, /TELEGRAM_SYMBOL_COOLDOWN_MINUTES = 15/);
  assert.match(source, /TELEGRAM_OFFER_TTL_MINUTES = 4 \* 15/);
  assert.match(source, /\["EXECUTED", "TRACKING"\]\.includes\(latest\.decision\)/);
  assert.match(source, /latest\.decision === "OFFERED"/);
  assert.match(source, /STALE_OFFER_4_CLOSED_15M/);
  assert.match(source, /expireStaleTelegramOffers\(database\)/);
  assert.match(source, /ranking_score.*TELEGRAM_EXECUTION_MIN_SCORE/);
  assert.match(source, /qualityGate\?\.passed === true/);
  assert.match(source, /Number\(row\.ranking_score\) < TELEGRAM_EXECUTION_MIN_SCORE/);
  assert.match(source, /Risk maksimum 2% saldo/);
  assert.match(source, /INVALID:<\/b> <code>2× CLOSED 1H/);
  assert.match(source, /TRIGGER 15M:<\/b> <code>/);
  assert.match(source, /FLOW & VOLATILITY/);
  assert.match(source, /decision IN \('EXECUTED','TRACKING'\)/);
  assert.match(source, /sha256\(`\$\{row\.id\}\|\$\{advice\.state\}`\)/);
  assert.match(source, /advice\.state !== "HOLD"/);
  assert.match(source, /LEARNING RESULT/);
  assert.match(source, /\/status/);
  assert.match(source, /\/pnl/);
  assert.match(source, /PNL EXECUTION REPORT/);
  assert.match(source, /json_type\(evidence_json, '\$\.execution'\) = 'object'/);
  assert.match(source, /REALIZED NET/);
  assert.match(source, /RUNNING NET/);
  assert.match(source, /agregat di atas menghitung seluruh execution/);
  assert.match(source, /RULE SCORE/);
  assert.match(source, /EVIDENCE CONFIDENCE/);
  assert.match(source, /EXECUTION & LEARNING STATUS/);
  assert.match(source, /HASIL EXECUTION/);
  assert.match(source, /HASIL LEARNING/);
  assert.match(source, /PASS TERCATAT/);
  assert.match(source, /PAPER_MARGIN_PER_TRADE_USD/);
  assert.match(source, /calculatePaperPositionAccounting/);
  assert.match(source, /loadLivePrices/);
  assert.match(source, /UPDATE_FAILED/);
  assert.match(source, /ENTRY_HELP/);
  assert.match(source, /BINANCE_LIVE_BUTTON/);
  assert.match(source, /BINANCE_AUTO_TRIGGER/);
  assert.match(source, /AUTO_PAPER/);
  assert.match(source, /TELEGRAM_AUTO_EXECUTION_MAX_ACTIVE = 10/);
  assert.match(source, /TELEGRAM_AUTO_MAX_ENTRY_DRIFT_R = 0\.35/);
  assert.match(source, /activateAutomaticPaperExecution/);
  assert.match(source, /openActionablePaperTrade/);
  assert.match(source, /paperTradeId/);
  assert.match(source, /riskBudgetUsd/);
  assert.match(source, /accountBalanceUsd/);
  assert.match(source, /riskDistance \* 3\.2/);
  assert.match(source, /auto\.marginUsd/);
  assert.match(source, /auto\.riskBudgetUsd/);
  assert.match(source, /AUTO_EXECUTION_BLOCKED/);
  assert.match(source, /ENTRY LIVE \$10×20/);
  assert.match(source, /liveentry/);
  assert.match(source, /activateExecutionMonitor/);
  assert.match(source, /answerCallbackQuery[\s\S]*?\.catch\(\(\) => null\)/);
  assert.match(source, /editMessageReplyMarkup/);
  assert.match(source, /DECISION_ALREADY_RECORDED/);
  assert.match(source, /UPDATE_HANDLED/);
  assert.match(source, /EXECUTED · PNL/);
  assert.match(source, /MONITORING · ACTIVE/);
  assert.match(source, /PASSED · RECORDED/);
  assert.match(source, /finally \{/);
  assert.match(source, /MOMENTUM:<\/b> <code>\$\{momentum\}<\/code>/);
  assert.match(source, /BIAS:<\/b> <code>/);
  assert.match(source, /DECISION:<\/b> <code>/);
  assert.match(source, /ENTRY ZONE:<\/b> <code>/);
  assert.match(source, /REFERENCE ENTRY:<\/b> <code>/);
  assert.match(source, /STOP LOSS:<\/b> <code>/);
  assert.match(source, /NET PNL:<\/b> <code>/);
  assert.match(source, /YANG BELUM SIAP/);
  assert.match(source, /KONFLIK — JANGAN ENTRY/);
  assert.match(source, /SEARAH:/);
  assert.match(source, /TELEGRAM_DIVIDER/);
  assert.match(source, /HARGA SAAT INI/);
  assert.match(source, /POSITION UPDATE/);
  assert.match(source, /MARKET CHECK/);
  assert.match(source, /location: signal\.nearBase[\s\S]*?signal\.extensionAtr <= 1\.2/);
  assert.match(source, /series\.slice\(-48\)/);
  assert.match(source, /sendPhoto/);
  assert.match(source, /sendDocument/);
  assert.match(source, /PAPER\/SHADOW/);
});

test("private Telegram setup uses outbound polling and never renders the token back", async () => {
  const [source, setupRoute, pollRoute, dashboard] = await Promise.all([
    readFile(new URL("../lib/telegram-monitor.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/telegram/setup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/telegram/poll/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/terminal-dashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(setupRoute, /requireOwnerApi/);
  assert.match(source, /AES-GCM/);
  assert.match(source, /getUpdates/);
  assert.match(source, /deleteWebhook/);
  assert.match(pollRoute, /pollTelegramUpdates/);
  assert.match(dashboard, /type="password"/);
  assert.doesNotMatch(setupRoute, /NextResponse\.json\(body/);
  assert.match(source, /type TelegramSetupResult = \{[\s\S]*pairingCommand: string;[\s\S]*\};/);
});
