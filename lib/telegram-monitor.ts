import { type HotVolumeCandidate } from "@/lib/hot-volume";
import { getHotVolumeEvaluationReport, type HotVolumeEvaluationReport } from "@/lib/hot-volume-evaluation";
import { loadChartSeries, loadLivePrice, loadLivePrices, type Candidate, type ChartPoint, type EarlySignal } from "@/lib/market";
import { getEvaluationReport } from "@/lib/evaluation";
import {
  calculatePaperPositionAccounting,
  PAPER_DEFAULT_LEVERAGE,
  PAPER_MARGIN_PER_TRADE_USD,
} from "@/lib/paper-account";
import {
  manualClosePaperTrade,
  openActionablePaperTrade,
  type ActionablePaperInput,
  type PaperTradeRecord,
} from "@/lib/paper-trading";

type TelegramStatement = {
  bind: (...values: unknown[]) => TelegramStatement;
  all: <T>() => Promise<{ results?: T[] }>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<{ meta?: { changes?: number } } | unknown>;
};

type TelegramDatabase = { prepare: (query: string) => TelegramStatement };

declare global {
  var __TELEGRAM_D1_TEST_BINDING__: TelegramDatabase | undefined;
  var __TELEGRAM_ENV_TEST_BINDING__: Record<string, string | undefined> | undefined;
}

export type TelegramCompanionStatus = {
  schemaVersion: "telegram-companion-v3";
  mode: "READ_ONLY_COMPANION";
  configured: boolean;
  paired: boolean;
  botUsername: string | null;
  pollingReady: boolean;
  schedulerReady: boolean;
  backgroundReady: boolean;
  evidenceGate: "INSUFFICIENT DATA" | "OBSERVE" | "KEEP" | "REVERT" | "UNAVAILABLE";
  promotionGates: {
    hardGate: PromotionVerdict | "UNAVAILABLE";
    early: EarlyPromotionReport;
    hotVolume: { verdict: PromotionVerdict | "UNAVAILABLE"; resolved: number; targetResolved: number; confidence: "LOW" | "OBSERVE" | "PROMOTED" | "REJECTED" };
  };
  snapshotMode: "PNG" | "SVG_FALLBACK";
  activeSubscriptions: number;
  offered: number;
  monitoring: number;
  passed: number;
  safety: string[];
};

export type TelegramSetupResult = {
  schemaVersion: "telegram-secure-setup-v1";
  state: "CONNECTED";
  botUsername: string;
  pairingCommand: string;
};

export type TelegramEarlyWatch = {
  signal: EarlySignal;
  sourceClosedAt: number;
};

export type MonitorSnapshot = {
  direction: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  tp1: number;
  close: number;
  high: number;
  low: number;
  ema21: number | null;
  rsi: number;
  relativeVolume: number;
};

export type MonitorAdvice = {
  state: "WAIT" | "HOLD" | "PROTECT" | "CLOSE_REVIEW" | "TP" | "SL";
  r: number;
  reason: string;
};

type MonitorRow = {
  id: string;
  signal_key: string;
  chat_id: string | null;
  message_id: string | null;
  symbol: string;
  base_asset: string;
  direction: "LONG" | "SHORT";
  setup_type: string;
  monitor_state: string;
  ranking_score: number;
  actual_entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  source_closed_at: number;
  last_alert_hash: string | null;
  last_checked_at: string | null;
  decision: "OFFERED" | "EXECUTED" | "TRACKING" | "PASSED" | "EXPIRED" | "CLOSED";
  evidence_json: string;
};

export type ManualExecutionMonitor = {
  id: string;
  paperTradeId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  setupType: string;
  decision: MonitorRow["decision"];
  state: string;
  actualEntry: number | null;
  stopLoss: number;
  tp1: number;
  lastCheckedAt: string | null;
  latestAdvice: { state: string; r: number; reason: string; close: number; rsi: number; relativeVolume: number } | null;
};

export type ManualExecutionStatus = {
  schemaVersion: "manual-execution-terminal-v1";
  state: "READY";
  active: number;
  passed: number;
  closed: number;
  monitors: ManualExecutionMonitor[];
};

async function db(): Promise<TelegramDatabase> {
  if (globalThis.__TELEGRAM_D1_TEST_BINDING__) return globalThis.__TELEGRAM_D1_TEST_BINDING__;
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Telegram companion database is unavailable");
  return env.DB as TelegramDatabase;
}

async function runtimeEnv(): Promise<Record<string, string | undefined>> {
  if (globalThis.__TELEGRAM_ENV_TEST_BINDING__) return globalThis.__TELEGRAM_ENV_TEST_BINDING__;
  try {
    const { env } = await import("cloudflare:workers");
    return env as unknown as Record<string, string | undefined>;
  } catch {
    return process.env;
  }
}

async function readSetting(key: string): Promise<string | null> {
  const row = await (await db()).prepare("SELECT value FROM telegram_settings WHERE key = ? LIMIT 1").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  await (await db()).prepare("INSERT INTO telegram_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, value, new Date().toISOString()).run();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function telegramConfigKey(): Promise<CryptoKey> {
  const env = await runtimeEnv();
  const encoded = env.TELEGRAM_CONFIG_KEY;
  if (!encoded) throw new Error("Telegram secure storage is not configured");
  const raw = base64UrlToBytes(encoded);
  if (raw.byteLength !== 32) throw new Error("Telegram secure storage key is invalid");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptBotToken(token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await telegramConfigKey(), new TextEncoder().encode(token));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

async function decryptBotToken(value: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext, extra] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext || extra) throw new Error("Encrypted Telegram token is invalid");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(encodedIv) },
    await telegramConfigKey(),
    base64UrlToBytes(encodedCiphertext),
  );
  return new TextDecoder().decode(plaintext);
}

async function telegramBotToken(): Promise<string | null> {
  const env = await runtimeEnv();
  if (env.TELEGRAM_BOT_TOKEN) return env.TELEGRAM_BOT_TOKEN;
  const encrypted = await readSetting("bot_token");
  if (!encrypted) return null;
  try {
    return await decryptBotToken(encrypted);
  } catch {
    return null;
  }
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function safeCandidate(value: unknown): Candidate | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Candidate>;
  const direction = item.direction === "LONG" || item.direction === "SHORT" ? item.direction : null;
  const symbol = typeof item.symbol === "string" && /^[A-Z0-9]{3,20}USDT$/.test(item.symbol) ? item.symbol : null;
  const entryLow = finite(item.entryLow);
  const entryHigh = finite(item.entryHigh);
  const stopLoss = finite(item.stopLoss);
  const tp1 = finite(item.tp1);
  const tp2 = finite(item.tp2);
  const tp3 = finite(item.tp3);
  const rankingScore = Number(item.rankingScore);
  const sourceClosedAt = Number(item.snapshots?.primary.closedAt);
  if (!direction || !symbol || !entryLow || !entryHigh || !stopLoss || !tp1 || !tp2 || !tp3 || !Number.isFinite(rankingScore) || !Number.isFinite(sourceClosedAt)) return null;
  if (direction === "LONG" && !(stopLoss < entryLow && entryHigh < tp1)) return null;
  if (direction === "SHORT" && !(tp1 < entryLow && entryHigh < stopLoss)) return null;
  return item as Candidate;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function telegramWithToken<T>(token: string, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json() as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !result.ok) throw new Error(`Telegram delivery failed: ${result.description ?? response.status}`);
  return result.result as T;
}

async function telegram(method: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = await telegramBotToken();
  if (!token) throw new Error("Telegram bot is disabled");
  return telegramWithToken<Record<string, unknown>>(token, method, payload);
}

async function telegramMultipart(method: string, body: FormData): Promise<Record<string, unknown>> {
  const token = await telegramBotToken();
  if (!token) throw new Error("Telegram bot is disabled");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body });
  const result = await response.json() as { ok?: boolean; result?: Record<string, unknown>; description?: string };
  if (!response.ok || !result.ok) throw new Error(`Telegram delivery failed: ${result.description ?? response.status}`);
  return result.result ?? {};
}

async function activeChatId(): Promise<string | null> {
  const row = await (await db()).prepare("SELECT chat_id FROM telegram_subscriptions WHERE state = 'ACTIVE' ORDER BY last_seen_at DESC LIMIT 1").first<{ chat_id: string }>();
  return row?.chat_id ?? null;
}

async function recordEvent(monitorId: string, event: string, payload: Record<string, unknown>, deliveryStatus: "PENDING" | "SENT" | "FAILED" | "NOT_REQUIRED") {
  const occurredAt = new Date().toISOString();
  const payloadJson = JSON.stringify(payload);
  const evidenceHash = await sha256(`${monitorId}|${event}|${occurredAt}|${payloadJson}`);
  await (await db()).prepare("INSERT INTO telegram_events (id, monitor_id, event, occurred_at, evidence_hash, payload_json, delivery_status) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), monitorId, event, occurredAt, evidenceHash, payloadJson, deliveryStatus).run();
}

function tradePrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Number(value.toPrecision(8)).toString();
}

function signedMetric(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function compactUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

const TELEGRAM_DIVIDER = "━━━━━━━━━━━━━━━━━━━━";
const TELEGRAM_ITEM_DIVIDER = "──────────────";

type ExecutionEvidence = {
  marginUsd: number;
  leverage: number;
  enteredAt: string;
  priceSource: "USER_ACTUAL_ENTRY" | "BINANCE_LIVE_BUTTON" | "BINANCE_AUTO_TRIGGER";
  executionMode: "CUSTOM_ENTRY" | "MANUAL_LIVE_BUTTON" | "AUTO_PAPER";
  paperTradeId?: string;
  accountBalanceUsd?: number;
  riskBudgetUsd?: number;
  estimatedLossAtStopUsd?: number;
  riskPerTradePct?: number;
};

type ParsedMonitorEvidence = Record<string, unknown> & {
  execution?: ExecutionEvidence;
  executionExit?: { price: number; closedAt: string; source: "BINANCE_LIVE" };
  latestAdvice?: { state?: string; close?: number; outcome?: string };
};

const TELEGRAM_EXECUTION_MIN_SCORE = 75;
const TELEGRAM_HOT_VOLUME_MIN_SCORE = 80;
const TELEGRAM_QUALITY_MIN_CATEGORIES = 4;
const TELEGRAM_SYMBOL_COOLDOWN_MINUTES = 15;
const TELEGRAM_OFFER_TTL_MINUTES = 4 * 15;
const TELEGRAM_AUTO_EXECUTION_MAX_ACTIVE = 10;
const TELEGRAM_AUTO_MAX_ENTRY_DRIFT_R = 0.35;
const EARLY_PROMOTION_TARGET_RESOLVED = 30;
const SIGNAL_POLICY_VERSION = "signal-policy-v83";

type PromotionVerdict = "INSUFFICIENT DATA" | "OBSERVE" | "KEEP" | "REVERT";
export type EarlyPromotionReport = {
  verdict: PromotionVerdict;
  resolved: number;
  targetResolved: typeof EARLY_PROMOTION_TARGET_RESOLVED;
  wins: number;
  losses: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  confidence: "LOW" | "OBSERVE" | "PROMOTED" | "REJECTED";
};

type TelegramQualityCategory = "location" | "trigger" | "flow" | "priceAction" | "entryQuality";
type TelegramQualityGate = {
  passed: boolean;
  passedCount: number;
  total: 5;
  ratio: number;
  categories: Record<TelegramQualityCategory, boolean>;
};

function qualityGate(categories: Record<TelegramQualityCategory, boolean>, mandatory: TelegramQualityCategory[]): TelegramQualityGate {
  const passedCount = Object.values(categories).filter(Boolean).length;
  return {
    passed: passedCount >= TELEGRAM_QUALITY_MIN_CATEGORIES && mandatory.every((category) => categories[category]),
    passedCount,
    total: 5,
    ratio: passedCount / 5,
    categories,
  };
}

export function evaluateEarlyTelegramQuality(signal: EarlySignal): TelegramQualityGate {
  const takerAligned = signal.takerBuySellRatio !== null && (signal.direction === "LONG" ? signal.takerBuySellRatio >= 1.05 : signal.takerBuySellRatio <= 0.95);
  const categories = {
    location: signal.nearBase && signal.nearestLevel.distanceAtr <= 0.9 && signal.extensionAtr <= 1.2,
    trigger: signal.status === "ARMED" && (signal.reclaimConfirmed || signal.sweepReclaim),
    flow: signal.volumeRatio >= 1.1 || signal.oiChangePercent >= 0.5 || takerAligned,
    priceAction: signal.divergenceKind !== "NONE" || signal.sweepReclaim || signal.reclaimConfirmed,
    entryQuality: (signal.nextLevel === null || signal.nextLevel.spaceAtr >= 1) && Math.abs(signal.recentReturnPercent) <= 4,
  } satisfies Record<TelegramQualityCategory, boolean>;
  return qualityGate(categories, ["location", "trigger", "entryQuality"]);
}

export function evaluateHotVolumeTelegramQuality(candidate: HotVolumeCandidate): TelegramQualityGate {
  const expectedMomentum = candidate.direction === "LONG" ? "BULLISH" : "BEARISH";
  const higherTimeframeAligned = candidate.direction === "LONG" ? candidate.priceChange.h4 > 0 : candidate.priceChange.h4 < 0;
  const takerAligned = candidate.takerBuySellRatio !== null && (candidate.direction === "LONG" ? candidate.takerBuySellRatio >= 1 : candidate.takerBuySellRatio <= 1);
  const momentumNotExhausted = candidate.direction === "LONG"
    ? candidate.rsi.m15 >= 45 && candidate.rsi.m15 <= 68 && candidate.rsi.h1 <= 72
    : candidate.rsi.m15 >= 32 && candidate.rsi.m15 <= 55 && candidate.rsi.h1 >= 28;
  const categories = {
    location: candidate.extensionAtr <= 0.9 && candidate.retest.distanceAtr <= 0.9,
    trigger: candidate.status === "BREAKOUT_READY" && candidate.breakout.confirmed && candidate.retest.confirmed && candidate.stochastic.signal === expectedMomentum && Boolean(candidate.breakout.level),
    flow: candidate.volumeChange.h1 >= 20 && candidate.volumeUsd.h1 >= 500_000 && candidate.oiChange.h1 > 0,
    priceAction: higherTimeframeAligned && candidate.regime.aligned && candidate.ema15m.alignment === expectedMomentum && takerAligned,
    entryQuality: candidate.spreadBps <= 8 && candidate.breakout.distanceAtr <= 1.2 && momentumNotExhausted,
  } satisfies Record<TelegramQualityCategory, boolean>;
  return qualityGate(categories, ["location", "trigger", "flow", "priceAction", "entryQuality"]);
}

function evidenceSignalStatus(value: string): string | null {
  const evidence = parsedMonitorEvidence(value) as ParsedMonitorEvidence & { signal?: { status?: string }; breakout?: { confirmed?: boolean } };
  return evidence.signal?.status ?? (evidence.breakout?.confirmed ? "BREAKOUT_READY" : null);
}

async function telegramSymbolBlocked(input: {
  database: TelegramDatabase;
  symbol: string;
  setupType: string;
  direction: "LONG" | "SHORT";
  status: string;
}): Promise<boolean> {
  const latest = await input.database.prepare(
    "SELECT offered_at, direction, decision, evidence_json FROM telegram_trade_monitors WHERE symbol = ? AND setup_type = ? ORDER BY offered_at DESC LIMIT 1",
  ).bind(input.symbol, input.setupType).first<{ offered_at: string; direction: string; decision: string; evidence_json: string }>();
  if (!latest || latest.direction !== input.direction || evidenceSignalStatus(latest.evidence_json) !== input.status) return false;
  if (["EXECUTED", "TRACKING"].includes(latest.decision)) return true;
  const elapsed = Date.now() - Date.parse(latest.offered_at);
  if (latest.decision === "OFFERED") {
    return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < TELEGRAM_OFFER_TTL_MINUTES * 60_000;
  }
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < TELEGRAM_SYMBOL_COOLDOWN_MINUTES * 60_000;
}

async function expireStaleTelegramOffers(database: TelegramDatabase): Promise<number> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - TELEGRAM_OFFER_TTL_MINUTES * 60_000).toISOString();
  const result = await database.prepare(
    "UPDATE telegram_trade_monitors SET decision = 'EXPIRED', monitor_state = 'STALE_OFFER_4_CLOSED_15M', decided_at = ? WHERE decision = 'OFFERED' AND offered_at < ?",
  ).bind(now.toISOString(), cutoff).run() as { meta?: { changes?: number } };
  return Number(result.meta?.changes ?? 0);
}

function parsedMonitorEvidence(value: string): ParsedMonitorEvidence {
  try {
    return JSON.parse(value) as ParsedMonitorEvidence;
  } catch {
    return {};
  }
}

type EarlyPromotionRow = Pick<MonitorRow, "decision" | "monitor_state" | "evidence_json"> & { offered_at?: string };

export function evaluateEarlyPromotionCohort(rows: EarlyPromotionRow[]): EarlyPromotionReport {
  const outcomes = [...rows]
    .sort((left, right) => String(left.offered_at ?? "").localeCompare(String(right.offered_at ?? "")))
    .flatMap((row): Array<"WIN" | "LOSE"> => {
      if (row.decision !== "CLOSED") return [];
      const evidence = parsedMonitorEvidence(row.evidence_json);
      const outcome = evidence.latestAdvice?.outcome ?? (row.monitor_state === "TP" ? "WIN" : row.monitor_state === "SL" ? "LOSE" : null);
      return outcome === "WIN" || outcome === "LOSE" ? [outcome] : [];
    });
  const wins = outcomes.filter((outcome) => outcome === "WIN").length;
  const losses = outcomes.length - wins;
  const netR = wins * 2 - losses;
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const outcome of outcomes) {
    equity += outcome === "WIN" ? 2 : -1;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }
  const resolved = outcomes.length;
  const expectancyR = resolved ? netR / resolved : 0;
  const profitFactor = losses > 0 ? wins * 2 / losses : wins > 0 ? 99 : 0;
  let verdict: PromotionVerdict = "INSUFFICIENT DATA";
  if (resolved >= EARLY_PROMOTION_TARGET_RESOLVED) {
    if (expectancyR <= 0) verdict = "REVERT";
    else if (profitFactor >= 1.2 && maxDrawdownR <= 10) verdict = "KEEP";
    else verdict = "OBSERVE";
  }
  return {
    verdict,
    resolved,
    targetResolved: EARLY_PROMOTION_TARGET_RESOLVED,
    wins,
    losses,
    winRate: resolved ? wins / resolved * 100 : 0,
    expectancyR,
    profitFactor,
    maxDrawdownR,
    confidence: verdict === "KEEP" ? "PROMOTED" : verdict === "REVERT" ? "REJECTED" : verdict === "OBSERVE" ? "OBSERVE" : "LOW",
  };
}

async function getEarlyPromotionReport(database: TelegramDatabase): Promise<EarlyPromotionReport> {
  const rows = await database.prepare(
    "SELECT decision, monitor_state, evidence_json, offered_at FROM telegram_trade_monitors WHERE setup_type = 'Early learning' AND evidence_json LIKE '%\"schemaVersion\":\"telegram-early-learning-v2\"%' ORDER BY offered_at ASC LIMIT 1000",
  ).all<EarlyPromotionRow>();
  return evaluateEarlyPromotionCohort(rows.results ?? []);
}

function promotionConfidenceText(report: Pick<EarlyPromotionReport, "confidence" | "resolved" | "targetResolved" | "verdict">): string {
  return `${report.confidence} · ${report.resolved}/${report.targetResolved} · ${report.verdict}`;
}

function executionModeLabel(execution?: ExecutionEvidence): string {
  if (execution?.executionMode === "AUTO_PAPER" || execution?.priceSource === "BINANCE_AUTO_TRIGGER") return "AUTO PAPER";
  if (execution?.executionMode === "CUSTOM_ENTRY" || execution?.priceSource === "USER_ACTUAL_ENTRY") return "CUSTOM";
  return "MANUAL BUTTON";
}

async function automaticExecutionBlocked(database: TelegramDatabase, symbol: string): Promise<"CAPACITY" | "SYMBOL_ACTIVE" | null> {
  const [active, sameSymbol] = await Promise.all([
    database.prepare("SELECT COUNT(*) AS count FROM telegram_trade_monitors WHERE decision = 'EXECUTED'").first<{ count: number }>(),
    database.prepare("SELECT id FROM telegram_trade_monitors WHERE symbol = ? AND decision IN ('EXECUTED','TRACKING') LIMIT 1").bind(symbol).first<{ id: string }>(),
  ]);
  if (sameSymbol) return "SYMBOL_ACTIVE";
  return Number(active?.count ?? 0) >= TELEGRAM_AUTO_EXECUTION_MAX_ACTIVE ? "CAPACITY" : null;
}

function statusColor(status: string): string {
  if (["ARMED", "BREAKOUT_READY", "TP", "WIN", "PROTECT"].includes(status)) return "🟢";
  if (["SHORT", "SL", "LOSE", "INVALID", "CLOSE_REVIEW"].includes(status)) return "🔴";
  if (["WAIT", "HOLD", "BE_SET", "BASE ZONE", "ACCUMULATING", "BREAKOUT_CONFIRMED"].includes(status)) return "🟡";
  return "🔵";
}

function directionalBadge(value: "BULLISH" | "BEARISH" | "MIXED" | "WAIT"): string {
  if (value === "BULLISH") return "🟢";
  if (value === "BEARISH") return "🔴";
  return "🟡";
}

function hotMomentumSummary(candidate: HotVolumeCandidate): string[] {
  const stochastic = candidate.stochastic.signal;
  const ema = candidate.ema15m.alignment;
  const momentum = stochastic === "BULLISH" && ema === "BULLISH"
    ? "BULLISH"
    : stochastic === "BEARISH" && ema === "BEARISH"
      ? "BEARISH"
      : "MIXED";
  const expected = candidate.direction === "LONG" ? "BULLISH" : "BEARISH";
  const aligned = momentum === expected;
  return [
    `${candidate.direction === "LONG" ? "🟢" : "🔴"} <b>BIAS:</b> <code>${escapeHtml(candidate.direction)}</code>`,
    `${directionalBadge(momentum)} <b>MOMENTUM:</b> <code>${momentum}</code> · Stoch ${directionalBadge(stochastic)} <code>${stochastic}</code> · EMA15 ${directionalBadge(ema)} <code>${ema}</code>`,
    aligned
      ? `✅ <b>SEARAH:</b> momentum mendukung bias ${escapeHtml(candidate.direction)}.`
      : `⚠️ <b>KONFLIK — JANGAN ENTRY:</b> bias ${escapeHtml(candidate.direction)}, tetapi momentum belum searah.`,
  ];
}

function executionMarkPrice(row: MonitorRow, evidence: ParsedMonitorEvidence, livePrice?: number): { price: number; label: string } | null {
  if (row.decision === "EXECUTED" && Number.isFinite(livePrice) && Number(livePrice) > 0) {
    return { price: Number(livePrice), label: "BINANCE LIVE" };
  }
  if (evidence.executionExit && evidence.executionExit.price > 0) return { price: evidence.executionExit.price, label: "MANUAL CLOSE" };
  if (row.monitor_state === "TP") return { price: row.tp1, label: "TP1" };
  if (row.monitor_state === "SL") return { price: row.stop_loss, label: "SL" };
  const adviceClose = finite(evidence.latestAdvice?.close);
  return adviceClose ? { price: adviceClose, label: "LAST CLOSED 15M" } : null;
}

function executionPnlLine(row: MonitorRow, mark: { price: number; label: string }): { text: string; netPnlUsd: number; marginUsd: number; closed: boolean; outcome: "WIN" | "LOSE" | null; mode: string } | null {
  const evidence = parsedMonitorEvidence(row.evidence_json);
  const execution = evidence.execution;
  if (!execution || !finite(row.actual_entry)) return null;
  const accounting = calculatePaperPositionAccounting({
    direction: row.direction,
    entryPrice: row.actual_entry,
    markPrice: mark.price,
    marginUsd: execution.marginUsd,
    leverage: execution.leverage,
  });
  const icon = accounting.netPnlUsd >= 0 ? "🟢" : "🔴";
  return {
    text: [
      `${icon} <b>${escapeHtml(row.symbol)}</b> · <code>${row.direction}</code> · <code>${row.decision === "EXECUTED" ? "RUNNING" : "CLOSED"}</code> · <code>${executionModeLabel(execution)}</code>`,
      `⚡ <b>ENTRY:</b> <code>${tradePrice(row.actual_entry)}</code> → <b>${mark.label}:</b> <code>${tradePrice(mark.price)}</code>`,
      `💵 <b>MARGIN:</b> <code>$${accounting.marginUsd.toFixed(2)} × ${accounting.leverage}</code> · Notional <code>$${accounting.notionalUsd.toFixed(2)}</code>`,
      `• Gross: ${signedMetric(accounting.grossPnlUsd)} USDT · Fee est.: $${accounting.estimatedRoundTripFeesUsd.toFixed(2)}`,
      `📊 <b>NET PNL:</b> <code>${signedMetric(accounting.netPnlUsd)} USDT</code> · <b>ROI:</b> <code>${signedMetric(accounting.netRoiPct)}%</code>`,
    ].join("\n"),
    netPnlUsd: accounting.netPnlUsd,
    marginUsd: accounting.marginUsd,
    closed: row.decision === "CLOSED",
    outcome: learningOutcome(row),
    mode: executionModeLabel(execution),
  };
}

async function executionPnlReport(database: TelegramDatabase, chatId: string, onlyId?: string): Promise<string> {
  const query = onlyId
    ? "SELECT * FROM telegram_trade_monitors WHERE chat_id = ? AND id = ? AND decision IN ('EXECUTED','CLOSED') AND json_type(evidence_json, '$.execution') = 'object' LIMIT 1"
    : "SELECT * FROM telegram_trade_monitors WHERE chat_id = ? AND decision IN ('EXECUTED','CLOSED') AND json_type(evidence_json, '$.execution') = 'object' ORDER BY COALESCE(last_checked_at, decided_at, offered_at) DESC";
  const statement = database.prepare(query);
  const result = onlyId ? await statement.bind(chatId, onlyId).all<MonitorRow>() : await statement.bind(chatId).all<MonitorRow>();
  const rows = (result.results ?? []).filter((row) => Boolean(parsedMonitorEvidence(row.evidence_json).execution));
  if (!rows.length) return "📊 Belum ada EXECUTION yang memiliki entry aktual. Pilih EXECUTION pada setup actionable terlebih dahulu.";
  const liveSymbols = rows.filter((row) => row.decision === "EXECUTED").map((row) => row.symbol);
  const livePrices = await loadLivePrices(liveSymbols).catch(() => ({}));
  const items = rows.flatMap((row) => {
    const evidence = parsedMonitorEvidence(row.evidence_json);
    const mark = executionMarkPrice(row, evidence, livePrices[row.symbol]);
    const line = mark ? executionPnlLine(row, mark) : null;
    return line ? [line] : [];
  });
  if (!items.length) return "📊 PNL belum dapat dihitung karena harga pembanding belum tersedia.";
  const totalNet = items.reduce((sum, item) => sum + item.netPnlUsd, 0);
  const totalMargin = items.reduce((sum, item) => sum + item.marginUsd, 0);
  const realizedNet = items.filter((item) => item.closed).reduce((sum, item) => sum + item.netPnlUsd, 0);
  const runningNet = items.filter((item) => !item.closed).reduce((sum, item) => sum + item.netPnlUsd, 0);
  const wins = items.filter((item) => item.outcome === "WIN").length;
  const losses = items.filter((item) => item.outcome === "LOSE").length;
  const active = items.filter((item) => !item.closed).length;
  const autoCount = items.filter((item) => item.mode === "AUTO PAPER").length;
  const manualCount = items.length - autoCount;
  return [
    "<b>📊 PNL EXECUTION REPORT</b>",
    `<b>EXECUTION:</b> <code>${items.length}</code> · aktif <code>${active}</code> · selesai 🟢 <code>${wins}</code> / 🔴 <code>${losses}</code>`,
    `🤖 <b>AUTO PAPER:</b> <code>${autoCount}</code> · 👤 <b>MANUAL/CUSTOM:</b> <code>${manualCount}</code>`,
    `🏁 <b>REALIZED NET:</b> <code>${signedMetric(realizedNet)} USDT</code> · ⚡ <b>RUNNING NET:</b> <code>${signedMetric(runningNet)} USDT</code>`,
    `💰 <b>TOTAL NET:</b> <code>${signedMetric(totalNet)} USDT</code> · <b>ROI:</b> <code>${signedMetric(totalMargin > 0 ? totalNet / totalMargin * 100 : 0)}%</code>`,
    "<i>Harga Binance Futures publik; fee round-trip estimasi. Bukan statement exchange.</i>",
    TELEGRAM_DIVIDER,
    ...items.slice(0, 8).flatMap((item, index) => index === 0 ? [item.text] : [TELEGRAM_ITEM_DIVIDER, item.text]),
    ...(items.length > 8 ? [TELEGRAM_ITEM_DIVIDER, `<i>Menampilkan 8 terbaru dari ${items.length} execution; agregat di atas menghitung seluruh execution.</i>`] : []),
  ].join("\n\n");
}

function telegramChartUrl(symbol: string): string {
  return `https://www.tradingview.com/chart/?symbol=BINANCE%3A${encodeURIComponent(symbol)}.P`;
}

function setupText(candidate: Candidate): string {
  const entry = `${candidate.entryLow} – ${candidate.entryHigh}`;
  const reasons = candidate.reasons.slice(0, 3).map((reason) => `• ${escapeHtml(reason)}`).join("\n");
  const directionIcon = candidate.direction === "LONG" ? "🟢" : "🔴";
  return [
    `<b>🎯 SETUP READY · ${escapeHtml(candidate.symbol)}</b>`,
    `${directionIcon} <b>BIAS:</b> <code>${escapeHtml(candidate.direction)}</code> · <b>RULE SCORE:</b> <code>${Math.round(candidate.rankingScore)}/100</code>`,
    `🟢 <b>EVIDENCE CONFIDENCE:</b> <code>PROMOTED · KEEP</code>`,
    `🟢 <b>DECISION:</b> <code>ACTIONABLE</code> · ${escapeHtml(candidate.setupType)}`,
    TELEGRAM_DIVIDER,
    `<b>🔵 HARGA SAAT INI</b>`,
    `<code>${tradePrice(candidate.price)}</code> · 24H ${signedMetric(candidate.change24h)}%`,
    "",
    `<b>🟦 EXECUTION PLAN</b>`,
    `⚡ <b>ENTRY ZONE:</b> <code>${entry}</code>`,
    `🛑 <b>STOP LOSS:</b> <code>${tradePrice(candidate.stopLoss)}</code>`,
    `🎯 <b>TP1:</b> <code>${tradePrice(candidate.tp1)}</code> · <b>TP2:</b> <code>${tradePrice(candidate.tp2)}</code> · <b>TP3:</b> <code>${tradePrice(candidate.tp3)}</code>`,
    `• Net R:R: <b>1:${candidate.adjustedRr.toFixed(2)}</b> · risk maksimum 2% saldo`,
    "",
    `<b>🟪 MARKET FLOW</b>`,
    `• Volume 24H: ${compactUsd(candidate.quoteVolume24h)}`,
    `• OI: ${signedMetric(candidate.oiChangePercent)}% · Taker: ${candidate.takerBuySellRatio?.toFixed(2) ?? "—"}`,
    `• Funding: ${signedMetric(candidate.fundingRate * 100, 4)}% · Spread: ${candidate.spreadBps.toFixed(2)} bps`,
    "",
    `<b>🟩 ALASAN</b>\n${reasons || "• Gate teknikal lengkap"}`,
    TELEGRAM_DIVIDER,
    `<b>🎯 NEXT ACTION</b>`,
    "<i>Setup actionable otomatis masuk AUTO PAPER. Terminal memonitor closed candle 15m; tidak ada order yang dikirim ke exchange.</i>",
  ].join("\n");
}

// Kept for backward-compatible callbacks on alerts sent before AUTO PAPER.
export function executionDecisionRows(id: string, includeMonitor = false) {
  return [
    [
      { text: "⚡ ENTRY LIVE $10×20", callback_data: `liveentry:${id}` },
      { text: "✍️ CUSTOM ENTRY", callback_data: `exec:${id}` },
    ],
    includeMonitor
      ? [{ text: "🧪 MONITOR", callback_data: `track:${id}` }, { text: "⏭ PASS", callback_data: `pass:${id}` }]
      : [{ text: "⏭ PASS", callback_data: `pass:${id}` }],
  ];
}

async function activateExecutionMonitor(input: {
  database: TelegramDatabase;
  chatId: string;
  id: string;
  price: number;
  marginUsd: number;
  leverage: number;
  priceSource: ExecutionEvidence["priceSource"];
  notify?: boolean;
  paperTrade?: PaperTradeRecord;
}): Promise<boolean> {
  const row = await input.database.prepare("SELECT planned_entry, stop_loss, tp1, tp2, tp3, setup_type, evidence_json, message_id, symbol, ranking_score FROM telegram_trade_monitors WHERE id = ? AND chat_id = ? AND decision = 'OFFERED'")
    .bind(input.id, input.chatId).first<{ planned_entry: number; stop_loss: number; tp1: number; tp2: number; tp3: number; setup_type: string; evidence_json: string; message_id: string | null; symbol: string; ranking_score: number }>();
  if (!row || !earlyOfferIsActionable(row) || Math.abs(input.price - row.planned_entry) / row.planned_entry > 0.15) return false;
  const now = new Date().toISOString();
  const evidence = parsedMonitorEvidence(row.evidence_json);
  const execution: ExecutionEvidence = {
    marginUsd: input.marginUsd,
    leverage: input.leverage,
    enteredAt: now,
    priceSource: input.priceSource,
    executionMode: input.priceSource === "BINANCE_AUTO_TRIGGER"
      ? "AUTO_PAPER"
      : input.priceSource === "USER_ACTUAL_ENTRY" ? "CUSTOM_ENTRY" : "MANUAL_LIVE_BUTTON",
    paperTradeId: input.paperTrade?.id,
    accountBalanceUsd: input.paperTrade?.risk.accountEquityUsd,
    riskBudgetUsd: input.paperTrade?.risk.riskBudgetUsd,
    estimatedLossAtStopUsd: input.paperTrade?.risk.estimatedLossAtStopUsd,
    riskPerTradePct: input.paperTrade?.risk.riskPerTradePct,
  };
  const update = await input.database.prepare("UPDATE telegram_trade_monitors SET decision = 'EXECUTED', monitor_state = 'MONITORING', actual_entry = ?, stop_loss = ?, tp1 = ?, tp2 = ?, tp3 = ?, decided_at = ?, evidence_json = ? WHERE id = ? AND chat_id = ? AND decision = 'OFFERED'")
    .bind(
      input.price,
      input.paperTrade?.stopLoss ?? row.stop_loss,
      input.paperTrade?.takeProfit ?? row.tp1,
      input.paperTrade?.takeProfit2 ?? row.tp2,
      input.paperTrade?.takeProfit3 ?? row.tp3,
      now,
      JSON.stringify({ ...evidence, execution }),
      input.id,
      input.chatId,
    ).run() as { meta?: { changes?: number } };
  if (Number(update.meta?.changes ?? 0) < 1) return false;
  await recordEvent(input.id, "EXECUTED", { actualEntry: input.price, marginUsd: input.marginUsd, leverage: input.leverage, priceSource: input.priceSource }, "NOT_REQUIRED");
  if (input.notify !== false) {
    await telegram("sendMessage", {
      chat_id: input.chatId,
      text: [
        `✅ <b>EXECUTION MONITOR AKTIF</b>`,
        TELEGRAM_DIVIDER,
        `<b>🟦 POSITION PLAN</b>`,
        `⚡ <b>ENTRY:</b> <code>${tradePrice(input.price)}</code>`,
        `💵 <b>MARGIN:</b> <code>$${input.marginUsd.toFixed(2)} × ${input.leverage}</code>`,
        `• Mode: <code>${executionModeLabel(execution)}</code>`,
        "",
        `<b>🎯 NEXT ACTION</b>`,
        "<i>Terminal membandingkan PNL dengan harga Binance Futures terbaru. Gunakan /pnl untuk laporan.</i>",
      ].join("\n"),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "📊 PNL REPORT", callback_data: `pnl:${input.id}` }]] },
    });
    await markOfferDecision({ chatId: input.chatId, messageId: row.message_id, id: input.id, symbol: row.symbol, state: "EXECUTED" });
  }
  return true;
}

async function activateAutomaticPaperExecution(input: {
  database: TelegramDatabase;
  chatId: string;
  id: string;
  symbol: string;
  plannedEntry: number;
  stopLoss: number;
  paperPlan: ActionablePaperInput;
}): Promise<{
  active: boolean;
  price: number | null;
  marginUsd: number | null;
  leverage: number | null;
  riskBudgetUsd: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  reason: string;
}> {
  const price = await loadLivePrice(input.symbol).catch(() => 0);
  if (!(price > 0)) return { active: false, price: null, marginUsd: null, leverage: null, riskBudgetUsd: null, stopLoss: null, tp1: null, tp2: null, tp3: null, reason: "LIVE_PRICE_UNAVAILABLE" };
  const risk = Math.abs(input.plannedEntry - input.stopLoss);
  if (!(risk > 0) || Math.abs(price - input.plannedEntry) > risk * TELEGRAM_AUTO_MAX_ENTRY_DRIFT_R) {
    return { active: false, price, marginUsd: null, leverage: null, riskBudgetUsd: null, stopLoss: null, tp1: null, tp2: null, tp3: null, reason: "ENTRY_DRIFT" };
  }
  const liveRisk = Math.abs(price - input.stopLoss);
  const directionFactor = input.paperPlan.direction === "LONG" ? 1 : -1;
  const paper = await openActionablePaperTrade({
    ...input.paperPlan,
    entryPrice: price,
    takeProfit: price + directionFactor * liveRisk * 3.2,
    takeProfit2: price + directionFactor * liveRisk * 4,
    takeProfit3: price + directionFactor * liveRisk * 5,
  });
  if (!paper.active || !paper.trade) {
    return { active: false, price, marginUsd: null, leverage: null, riskBudgetUsd: null, stopLoss: null, tp1: null, tp2: null, tp3: null, reason: `PAPER_${paper.reason}` };
  }
  const blocked = await automaticExecutionBlocked(input.database, input.symbol);
  if (blocked) {
    return {
      active: false,
      price: paper.trade.entryPrice,
      marginUsd: paper.trade.accounting.marginUsd,
      leverage: paper.trade.accounting.leverage,
      riskBudgetUsd: paper.trade.risk.riskBudgetUsd,
      stopLoss: paper.trade.stopLoss,
      tp1: paper.trade.takeProfit,
      tp2: paper.trade.takeProfit2,
      tp3: paper.trade.takeProfit3,
      reason: `MONITOR_${blocked}`,
    };
  }
  const active = await activateExecutionMonitor({
    database: input.database,
    chatId: input.chatId,
    id: input.id,
    price: paper.trade.entryPrice,
    marginUsd: paper.trade.accounting.marginUsd,
    leverage: paper.trade.accounting.leverage,
    priceSource: "BINANCE_AUTO_TRIGGER",
    notify: false,
    paperTrade: paper.trade,
  });
  return {
    active,
    price: paper.trade.entryPrice,
    marginUsd: paper.trade.accounting.marginUsd,
    leverage: paper.trade.accounting.leverage,
    riskBudgetUsd: paper.trade.risk.riskBudgetUsd,
    stopLoss: paper.trade.stopLoss,
    tp1: paper.trade.takeProfit,
    tp2: paper.trade.takeProfit2,
    tp3: paper.trade.takeProfit3,
    reason: active ? paper.reason : "RACE_LOST",
  };
}

async function markOfferDecision(input: {
  chatId: string;
  messageId: string | number | null | undefined;
  id: string;
  symbol: string;
  state: "EXECUTED" | "TRACKING" | "PASSED";
}): Promise<void> {
  if (!input.messageId) return;
  const statusButton = input.state === "EXECUTED"
    ? { text: "✅ EXECUTED · PNL", callback_data: `pnl:${input.id}` }
    : { text: input.state === "TRACKING" ? "🧪 MONITORING · ACTIVE" : "⏭ PASSED · RECORDED", callback_data: `noop:${input.id}` };
  const controls = input.state === "PASSED" ? [] : [{ text: "✅ BE SET", callback_data: `be:${input.id}` }, { text: "⏹ CLOSED", callback_data: `closed:${input.id}` }];
  await telegram("editMessageReplyMarkup", {
    chat_id: input.chatId,
    message_id: Number(input.messageId),
    reply_markup: { inline_keyboard: [
      [statusButton],
      ...(controls.length ? [controls] : []),
      [{ text: "📊 OPEN CHART", url: telegramChartUrl(input.symbol) }],
    ] },
  }).catch(() => null);
}

export async function getTelegramStatus(): Promise<TelegramCompanionStatus> {
  const env = await runtimeEnv();
  const [token, botUsername] = await Promise.all([telegramBotToken(), readSetting("bot_username")]);
  const configured = Boolean(token && env.TELEGRAM_PAIRING_CODE);
  const schedulerReady = Boolean(env.TELEGRAM_MONITOR_TOKEN);
  const backgroundReady = Boolean(env.BACKGROUND_SCANNER_TOKEN);
  const database = await db();
  const [evaluation, earlyPromotion, hotPromotion] = await Promise.all([
    getEvaluationReport().catch(() => null),
    getEarlyPromotionReport(database),
    getHotVolumeEvaluationReport().catch(() => null),
  ]);
  const subscriptions = await database.prepare("SELECT COUNT(*) AS count FROM telegram_subscriptions WHERE state = 'ACTIVE'").first<{ count: number }>();
  const counts = await database.prepare("SELECT decision, COUNT(*) AS count FROM telegram_trade_monitors GROUP BY decision").all<{ decision: string; count: number }>();
  const byDecision = new Map((counts.results ?? []).map((row) => [row.decision, Number(row.count)]));
  return {
    schemaVersion: "telegram-companion-v3",
    mode: "READ_ONLY_COMPANION",
    configured,
    paired: Number(subscriptions?.count ?? 0) > 0,
    botUsername,
    pollingReady: Boolean(token),
    schedulerReady,
    backgroundReady,
    evidenceGate: evaluation?.verdict ?? "UNAVAILABLE",
    promotionGates: {
      hardGate: evaluation?.verdict ?? "UNAVAILABLE",
      early: earlyPromotion,
      hotVolume: {
        verdict: hotPromotion?.verdict ?? "UNAVAILABLE",
        resolved: hotPromotion?.pairedResolved ?? 0,
        targetResolved: hotPromotion?.targetPairedResolved ?? 30,
        confidence: hotPromotion?.verdict === "KEEP" ? "PROMOTED" : hotPromotion?.verdict === "REVERT" ? "REJECTED" : hotPromotion?.verdict === "OBSERVE" ? "OBSERVE" : "LOW",
      },
    },
    snapshotMode: (env as unknown as { IMAGES?: unknown }).IMAGES ? "PNG" : "SVG_FALLBACK",
    activeSubscriptions: Number(subscriptions?.count ?? 0),
    offered: byDecision.get("OFFERED") ?? 0,
    monitoring: (byDecision.get("EXECUTED") ?? 0) + (byDecision.get("TRACKING") ?? 0),
    passed: byDecision.get("PASSED") ?? 0,
    safety: ["NO_ORDER_API", "NO_PRIVATE_EXCHANGE_KEY", "AUTO_PAPER_ONLY", "STATE_CHANGE_ALERTS_ONLY"],
  };
}

export async function offerTelegramSetups(rawCandidates: unknown[], generatedAt: string, dataHealth: unknown) {
  const env = await runtimeEnv();
  if (!(await telegramBotToken()) || !env.TELEGRAM_PAIRING_CODE) return { state: "DISABLED", offered: 0 };
  const evaluation = await getEvaluationReport().catch(() => null);
  if (!evaluation || evaluation.verdict !== "KEEP") return { state: "BLOCKED_EVIDENCE_GATE", offered: 0 };
  const health = dataHealth && typeof dataHealth === "object" ? (dataHealth as { state?: unknown }).state : null;
  if (health !== "HEALTHY") return { state: "BLOCKED_DATA_HEALTH", offered: 0 };
  const chatId = await activeChatId();
  if (!chatId) return { state: "AWAITING_PAIRING", offered: 0 };
  const database = await db();
  let offered = 0;
  for (const candidate of rawCandidates
    .map(safeCandidate)
    .filter((item): item is Candidate => item !== null && item.rankingScore >= TELEGRAM_EXECUTION_MIN_SCORE)
    .slice(0, 3)) {
    const sourceClosedAt = candidate.snapshots.primary.closedAt;
    const signalKey = await sha256(`telegram-v1|${candidate.symbol}|${candidate.direction}|${sourceClosedAt}`);
    const id = signalKey.slice(0, 16);
    const existing = await database.prepare("SELECT id FROM telegram_trade_monitors WHERE signal_key = ?").bind(signalKey).first<{ id: string }>();
    if (existing) continue;
    const plannedEntry = (candidate.entryLow + candidate.entryHigh) / 2;
    await database.prepare("INSERT INTO telegram_trade_monitors (id, signal_key, chat_id, symbol, base_asset, direction, setup_type, ranking_score, planned_entry, stop_loss, tp1, tp2, tp3, source_closed_at, offered_at, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, signalKey, chatId, candidate.symbol, candidate.baseAsset, candidate.direction, candidate.setupType, Math.round(candidate.rankingScore), plannedEntry, candidate.stopLoss, candidate.tp1, candidate.tp2, candidate.tp3, sourceClosedAt, generatedAt, JSON.stringify({ schemaVersion: "telegram-offer-v2", ruleVersion: SIGNAL_POLICY_VERSION, source: "HARD_GATE", promotionGate: { verdict: evaluation.verdict, targetResolved: evaluation.targetResolved, resolved: evaluation.shadow.resolved }, reasons: candidate.reasons, risk: candidate.risk, riskPolicy: { maximumAccountRiskPct: 2, execution: "AUTO_PAPER", monitoringTimeframe: "15M_CLOSED" } })).run();
    const auto = await activateAutomaticPaperExecution({
      database,
      chatId,
      id,
      symbol: candidate.symbol,
      plannedEntry,
      stopLoss: candidate.stopLoss,
      paperPlan: {
        signalKey: `V3:${candidate.symbol}:${candidate.direction}:${candidate.setupType}:${sourceClosedAt}`,
        source: "HARD_GATE",
        symbol: candidate.symbol,
        baseAsset: candidate.baseAsset,
        direction: candidate.direction,
        setupType: candidate.setupType,
        rankingScore: candidate.rankingScore,
        technicalScore: candidate.technicalScore,
        entryPrice: candidate.price,
        stopLoss: candidate.stopLoss,
        takeProfit: candidate.tp1,
        takeProfit2: candidate.tp2,
        takeProfit3: candidate.tp3,
        atr: candidate.snapshots.primary.atr,
        sourceClosedAt,
        openedAt: generatedAt,
        reasons: candidate.reasons,
      },
    });
    if (!auto.active) {
      await recordEvent(id, "AUTO_EXECUTION_BLOCKED", { source: "HARD_GATE", reason: auto.reason, observedPrice: auto.price }, "NOT_REQUIRED");
      await database.prepare("UPDATE telegram_trade_monitors SET decision = 'EXPIRED', monitor_state = ?, decided_at = ? WHERE id = ? AND decision = 'OFFERED'")
        .bind(`AUTO_BLOCKED_${auto.reason}`, new Date().toISOString(), id).run();
      continue;
    }
    try {
      const message = await telegram("sendMessage", {
        chat_id: chatId,
        text: [
          setupText(candidate),
          TELEGRAM_DIVIDER,
          `🤖 <b>AUTO PAPER ACTIVE</b> · <b>ENTRY:</b> <code>${tradePrice(auto.price ?? plannedEntry)}</code> · <code>$${(auto.marginUsd ?? 0).toFixed(2)}×${auto.leverage ?? "—"}</code>`,
          `🛡 <b>PLANNED RISK:</b> <code>$${(auto.riskBudgetUsd ?? 0).toFixed(2)} · max 2% saldo</code>`,
        ].join("\n"),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: "📊 PNL REPORT", callback_data: `pnl:${id}` }], [{ text: "✅ BE SET", callback_data: `be:${id}` }, { text: "⏹ CLOSE PAPER", callback_data: `closed:${id}` }], [{ text: "📊 OPEN CHART", url: telegramChartUrl(candidate.symbol) }]] },
      });
      await database.prepare("UPDATE telegram_trade_monitors SET message_id = ? WHERE id = ?").bind(String(message.message_id ?? ""), id).run();
      await recordEvent(id, auto.active ? "AUTO_EXECUTION_OFFERED" : "OFFERED", { symbol: candidate.symbol, direction: candidate.direction, auto: auto.reason }, "SENT");
      offered += 1;
    } catch (error) {
      await recordEvent(id, "OFFERED", { error: error instanceof Error ? error.message : "delivery failed" }, "FAILED");
    }
  }
  return { state: "READY", offered };
}

export async function offerTelegramEarlyWatches(rawWatches: TelegramEarlyWatch[], dataHealth: unknown) {
  const env = await runtimeEnv();
  if (!(await telegramBotToken()) || !env.TELEGRAM_PAIRING_CODE) return { state: "DISABLED", offered: 0 };
  const health = dataHealth && typeof dataHealth === "object" ? (dataHealth as { state?: unknown }).state : null;
  if (health !== "HEALTHY") return { state: "BLOCKED_DATA_HEALTH", offered: 0 };
  const chatId = await activeChatId();
  if (!chatId) return { state: "AWAITING_PAIRING", offered: 0 };
  const database = await db();
  const promotion = await getEarlyPromotionReport(database);
  const watches = rawWatches
    .filter(({ signal, sourceClosedAt }) => Boolean(signal)
      && Number.isFinite(sourceClosedAt)
      && signal.status === "ARMED"
      && signal.score >= TELEGRAM_EXECUTION_MIN_SCORE
      && evaluateEarlyTelegramQuality(signal).passed)
    .sort((left, right) => right.signal.score - left.signal.score)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.signal.symbol === item.signal.symbol) === index)
    .slice(0, 3);
  let offered = 0;
  for (const { signal, sourceClosedAt } of watches) {
    const quality = evaluateEarlyTelegramQuality(signal);
    const directionIcon = signal.direction === "LONG" ? "🟢" : "🔴";
    const decision = "TRIGGER READY";
    const supporting = [
      signal.nearBase ? `dekat ${signal.nearestLevel.label}` : null,
      signal.volumeRatio >= 1.1 ? `volume ${signal.volumeRatio.toFixed(2)}× baseline` : null,
      signal.oiChangePercent >= 0.5 ? `OI ${signedMetric(signal.oiChangePercent)}%` : null,
      signal.sweepReclaim ? "sweep-reclaim terkonfirmasi" : null,
      signal.reclaimConfirmed ? "closed 15m melewati trigger" : null,
      signal.divergenceKind !== "NONE" ? `${signal.divergenceKind.toLowerCase()} divergence` : null,
    ].filter((item): item is string => Boolean(item));
    const missing = [
      !signal.reclaimConfirmed ? `closed 15m belum melewati ${tradePrice(signal.triggerPrice)}` : null,
      !signal.sweepReclaim ? "sweep-reclaim belum ada" : null,
      signal.divergenceKind === "NONE" ? "divergence belum terkonfirmasi" : null,
      signal.volumeRatio < 1.1 ? "volume belum ≥1.10× baseline" : null,
      signal.oiChangePercent < 0.5 ? "OI belum bertambah ≥0.50%" : null,
    ].filter((item): item is string => Boolean(item));
    const nextAction = signal.status === "ARMED"
      ? `Review ulang setelah closed 15m bertahan ${signal.direction === "LONG" ? "di atas" : "di bawah"} ${tradePrice(signal.triggerPrice)}; jangan kejar jika extension >1.20 ATR.`
      : `Tunggu closed 15m ${signal.direction === "LONG" ? "di atas" : "di bawah"} ${tradePrice(signal.triggerPrice)} disertai volume/OI; status dapat naik ke ARMED atau BREAKOUT READY.`;
    const naturalRisk = Math.abs(signal.price - signal.invalidationPrice);
    const riskDistance = Math.min(signal.atr * 1.5, Math.max(signal.atr * 0.75, naturalRisk));
    const directionFactor = signal.direction === "LONG" ? 1 : -1;
    const stopLoss = signal.price - directionFactor * riskDistance;
    const tp1 = signal.price + directionFactor * riskDistance * 3.2;
    const tp2 = signal.price + directionFactor * riskDistance * 4;
    const tp3 = signal.price + directionFactor * riskDistance * 5;
    const signalKey = await sha256(`telegram-early-learning-v2|${signal.symbol}|${signal.direction}|${sourceClosedAt}`);
    const id = signalKey.slice(0, 16);
    const existing = await database.prepare("SELECT id FROM telegram_trade_monitors WHERE signal_key = ?").bind(signalKey).first<{ id: string }>();
    if (existing) continue;
    if (await telegramSymbolBlocked({ database, symbol: signal.symbol, setupType: "Early learning", direction: signal.direction, status: signal.status })) continue;
    const evidence = {
      schemaVersion: "telegram-early-learning-v2",
      ruleVersion: SIGNAL_POLICY_VERSION,
      source: "EARLY",
      signal: { status: signal.status, triggerPrice: signal.triggerPrice, structuralInvalidation: signal.invalidationPrice },
      qualityGate: quality,
      promotionGate: promotion,
      reasons: signal.reasons,
      riskPolicy: { maximumAccountRiskPct: 2, execution: promotion.verdict === "KEEP" ? "AUTO_PAPER" : "SHADOW_ONLY", learningMode: "LIVE_TRIGGER_ENTRY", monitoringTimeframe: "15M_CLOSED" },
    };
    await database.prepare("INSERT INTO telegram_trade_monitors (id, signal_key, chat_id, symbol, base_asset, direction, setup_type, ranking_score, planned_entry, stop_loss, tp1, tp2, tp3, source_closed_at, offered_at, evidence_json) VALUES (?, ?, ?, ?, ?, ?, 'Early learning', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, signalKey, chatId, signal.symbol, signal.baseAsset, signal.direction, Math.round(signal.score), signal.price, stopLoss, tp1, tp2, tp3, sourceClosedAt, new Date().toISOString(), JSON.stringify(evidence)).run();
    if (promotion.verdict !== "KEEP") {
      const now = new Date().toISOString();
      await database.prepare("UPDATE telegram_trade_monitors SET decision = 'TRACKING', monitor_state = 'LEARNING_SHADOW', actual_entry = ?, decided_at = ? WHERE id = ? AND decision = 'OFFERED'")
        .bind(signal.price, now, id).run();
      try {
        const message = await telegram("sendMessage", {
          chat_id: chatId,
          text: [
            `<b>🧪 EARLY SHADOW · ${escapeHtml(signal.symbol)}</b>`,
            `${directionIcon} <b>BIAS:</b> <code>${escapeHtml(signal.direction)}</code> · <b>RULE SCORE:</b> <code>${Math.round(signal.score)}/100</code>`,
            `🔒 <b>EVIDENCE CONFIDENCE:</b> <code>${escapeHtml(promotionConfidenceText(promotion))}</code>`,
            TELEGRAM_DIVIDER,
            `<b>ENTRY ACUAN:</b> <code>${tradePrice(signal.price)}</code> · <b>SL:</b> <code>${tradePrice(stopLoss)}</code> · <b>TP:</b> <code>${tradePrice(tp1)}</code>`,
            `<b>TRIGGER:</b> <code>${signal.direction === "LONG" ? "&gt;" : "&lt;"} ${tradePrice(signal.triggerPrice)}</code> · <b>QUALITY:</b> <code>${quality.passedCount}/5</code>`,
            "",
            "<b>🎯 NEXT ACTION</b>",
            "<i>Dicatat sebagai learning shadow sampai minimal 30 outcome dan expectancy positif. Tidak masuk AUTO PAPER atau /pnl.</i>",
          ].join("\n"),
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [[{ text: "📊 OPEN CHART", url: telegramChartUrl(signal.symbol) }]] },
        });
        await database.prepare("UPDATE telegram_trade_monitors SET message_id = ? WHERE id = ?").bind(String(message.message_id ?? ""), id).run();
        await recordEvent(id, "EARLY_SHADOW_TRACKING", { symbol: signal.symbol, direction: signal.direction, ruleScore: signal.score, promotion }, "SENT");
        offered += 1;
      } catch (error) {
        await recordEvent(id, "EARLY_SHADOW_FAILED", { error: error instanceof Error ? error.message : "delivery failed", promotion }, "FAILED");
      }
      continue;
    }
    const auto = await activateAutomaticPaperExecution({
      database,
      chatId,
      id,
      symbol: signal.symbol,
      plannedEntry: signal.price,
      stopLoss,
      paperPlan: {
        signalKey: `V3:EARLY:${signalKey}`,
        source: "EARLY",
        symbol: signal.symbol,
        baseAsset: signal.baseAsset,
        direction: signal.direction,
        setupType: "Early armed",
        rankingScore: signal.score,
        technicalScore: signal.score,
        entryPrice: signal.price,
        stopLoss,
        takeProfit: tp1,
        takeProfit2: tp2,
        takeProfit3: tp3,
        atr: signal.atr,
        sourceClosedAt,
        reasons: signal.reasons,
      },
    });
    if (!auto.active) {
      await recordEvent(id, "AUTO_EXECUTION_BLOCKED", { source: "EARLY", reason: auto.reason, observedPrice: auto.price }, "NOT_REQUIRED");
      await database.prepare("UPDATE telegram_trade_monitors SET decision = 'EXPIRED', monitor_state = ?, decided_at = ? WHERE id = ? AND decision = 'OFFERED'")
        .bind(`AUTO_BLOCKED_${auto.reason}`, new Date().toISOString(), id).run();
      continue;
    }
    const text = [
        `<b>🔎 EARLY RADAR · ${escapeHtml(signal.symbol)}</b>`,
        `${directionIcon} <b>BIAS:</b> <code>${escapeHtml(signal.direction)}</code> · <b>RULE SCORE:</b> <code>${Math.round(signal.score)}/100</code>`,
        `🟢 <b>EVIDENCE CONFIDENCE:</b> <code>${escapeHtml(promotionConfidenceText(promotion))}</code>`,
        `${statusColor(signal.status)} <b>DECISION:</b> <code>${decision}</code> · <b>ZONE:</b> <code>${escapeHtml(signal.status)}</code>`,
        `✅ <b>QUALITY GATE:</b> <code>${quality.passedCount}/5 · ${(quality.ratio * 100).toFixed(0)}%</code>`,
        TELEGRAM_DIVIDER,
        `<b>🔵 HARGA SAAT INI</b>`,
        `💰 <b>PRICE:</b> <code>${tradePrice(signal.price)}</code> · <b>24H:</b> <code>${signedMetric(signal.change24h)}%</code> · <b>4H:</b> <code>${signedMetric(signal.recentReturnPercent)}%</code>`,
        "",
        `<b>🟦 LEVEL MAP</b>`,
        `📍 <b>BASE:</b> <code>${escapeHtml(signal.nearestLevel.label)} ${tradePrice(signal.nearestLevel.price)}</code> · <code>${signal.nearestLevel.distanceAtr.toFixed(2)} ATR</code>`,
        `🎯 <b>TRIGGER 15M:</b> <code>${signal.direction === "LONG" ? "&gt;" : "&lt;"} ${tradePrice(signal.triggerPrice)}</code>`,
        `🛑 <b>INVALID:</b> <code>2× CLOSED 1H ${signal.direction === "LONG" ? "&lt;" : "&gt;"} ${tradePrice(signal.invalidationPrice)}</code>`,
        `🏁 <b>NEXT TARGET:</b> ${signal.nextLevel ? `<code>${escapeHtml(signal.nextLevel.label)} ${tradePrice(signal.nextLevel.price)} · ${signal.nextLevel.spaceAtr.toFixed(2)} ATR</code>` : "<code>OPEN SPACE</code>"}`,
        "",
        `<b>🟪 FLOW & VOLATILITY</b>`,
        `• <b>VOLUME:</b> <code>${signal.volumeRatio.toFixed(2)}×</code> · <b>OI:</b> <code>${signedMetric(signal.oiChangePercent)}%</code>`,
        `• <b>TAKER:</b> <code>${signal.takerBuySellRatio?.toFixed(2) ?? "—"}</code> · <b>FUNDING:</b> <code>${signedMetric(signal.fundingRate * 100, 4)}%</code>`,
        `• <b>VOLATILITY:</b> <code>${escapeHtml(signal.volatilityState)} · ATR %ILE ${signal.atrPercentile.toFixed(0)}</code>`,
        `• <b>COMPRESSION:</b> <code>${signal.rangeCompression.toFixed(2)}×</code> · <b>EXTENSION:</b> <code>${signal.extensionAtr.toFixed(2)} ATR</code>`,
        "",
        `<b>🟩 YANG MENDUKUNG</b>\n${supporting.length ? supporting.map((item) => `• ${escapeHtml(item)}`).join("\n") : "• Belum ada konfirmasi utama"}`,
        `<b>🟧 YANG BELUM SIAP</b>\n${missing.length ? missing.map((item) => `• ${escapeHtml(item)}`).join("\n") : "• Semua trigger Early sudah lengkap"}`,
        "",
        `<b>🎯 NEXT ACTION</b>\n<i>${escapeHtml(nextAction)}</i>`,
        TELEGRAM_DIVIDER,
        `<b>🟦 LEARNING PLAN</b>`,
        `⚡ <b>REFERENCE ENTRY:</b> <code>${tradePrice(signal.price)}</code>`,
        `🛑 <b>STOP LOSS:</b> <code>${tradePrice(auto.stopLoss ?? stopLoss)}</code>`,
        `🎯 <b>TP1:</b> <code>${tradePrice(auto.tp1 ?? tp1)}</code> · <b>TP2:</b> <code>${tradePrice(auto.tp2 ?? tp2)}</code> · <b>TP3:</b> <code>${tradePrice(auto.tp3 ?? tp3)}</code>`,
        `🤖 <b>AUTO PAPER ACTIVE</b> · <b>ENTRY:</b> <code>${tradePrice(auto.price ?? signal.price)}</code> · <code>$${(auto.marginUsd ?? 0).toFixed(2)}×${auto.leverage ?? "—"}</code>`,
        `🛡 <b>PLANNED RISK:</b> <code>$${(auto.riskBudgetUsd ?? 0).toFixed(2)} · max 2% saldo</code>`,
        "<i>Terminal belajar otomatis dari hasil WIN/LOSE berdasarkan harga Binance; tidak ada order exchange.</i>",
      ].join("\n");
    const decisions = [[{ text: "📊 PNL REPORT", callback_data: `pnl:${id}` }], [{ text: "✅ BE SET", callback_data: `be:${id}` }, { text: "⏹ CLOSE PAPER", callback_data: `closed:${id}` }]];
    try {
      const message = await telegram("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [...decisions, [{ text: "📊 OPEN CHART", url: telegramChartUrl(signal.symbol) }]] },
      });
      await database.prepare("UPDATE telegram_trade_monitors SET message_id = ? WHERE id = ?").bind(String(message.message_id ?? ""), id).run();
      await recordEvent(id, auto.active ? "EARLY_AUTO_EXECUTED" : "EARLY_OFFERED", { symbol: signal.symbol, direction: signal.direction, status: signal.status, auto: auto.reason }, "SENT");
      offered += 1;
    } catch (error) {
      await recordEvent(id, "EARLY_OFFER_FAILED", { error: error instanceof Error ? error.message : "delivery failed" }, "FAILED");
      await database.prepare("DELETE FROM telegram_trade_monitors WHERE id = ? AND decision = 'OFFERED' AND message_id IS NULL").bind(id).run();
    }
  }
  return { state: "READY", offered };
}

async function offerHotVolumeBreakout(candidate: HotVolumeCandidate, generatedAt: string, promotion: HotVolumeEvaluationReport): Promise<"SENT" | "DUPLICATE" | "FAILED"> {
  if (candidate.direction === "NEUTRAL") return "FAILED";
  const chatId = await activeChatId();
  const quality = evaluateHotVolumeTelegramQuality(candidate);
  if (!chatId || candidate.score < TELEGRAM_HOT_VOLUME_MIN_SCORE || candidate.status !== "BREAKOUT_READY" || !quality.passed || !candidate.breakout.confirmed || !candidate.breakout.level || candidate.atr15m <= 0) return "FAILED";
  const sourceClosedAt = Date.parse(candidate.breakout.sourceClosedAt);
  if (!Number.isFinite(sourceClosedAt)) return "FAILED";
  const database = await db();
  const signalKey = await sha256(`telegram-hot-breakout-v2|${candidate.symbol}|${candidate.direction}|${candidate.breakout.sourceClosedAt}|${candidate.retest.sourceClosedAt}`);
  const id = signalKey.slice(0, 16);
  const existing = await database.prepare("SELECT id FROM telegram_trade_monitors WHERE signal_key = ?").bind(signalKey).first<{ id: string }>();
  if (existing) return "DUPLICATE";
  if (await telegramSymbolBlocked({ database, symbol: candidate.symbol, setupType: "Momentum breakout", direction: candidate.direction, status: candidate.status })) return "DUPLICATE";
  const entry = candidate.closedPrice;
  const naturalRisk = Math.abs(entry - candidate.breakout.level) + candidate.atr15m * 0.25;
  const riskDistance = Math.min(candidate.atr15m * 1.5, Math.max(candidate.atr15m * 0.75, naturalRisk));
  const directionFactor = candidate.direction === "LONG" ? 1 : -1;
  const stopLoss = entry - directionFactor * riskDistance;
  const tp1 = entry + directionFactor * riskDistance * 3.2;
  const tp2 = entry + directionFactor * riskDistance * 4;
  const tp3 = entry + directionFactor * riskDistance * 5;
  const evidence = {
    schemaVersion: "telegram-hot-breakout-v2",
    ruleVersion: SIGNAL_POLICY_VERSION,
    source: "HOT_VOLUME",
    reasons: candidate.reasons,
    breakout: candidate.breakout,
    retest: candidate.retest,
    regime: candidate.regime,
    qualityGate: quality,
    promotionGate: { verdict: promotion.verdict, pairedResolved: promotion.pairedResolved, targetResolved: promotion.targetPairedResolved },
    riskPolicy: { maximumAccountRiskPct: 2, execution: "AUTO_PAPER", monitoringTimeframe: "15M_CLOSED" },
  };
  await database.prepare("INSERT INTO telegram_trade_monitors (id, signal_key, chat_id, symbol, base_asset, direction, setup_type, ranking_score, planned_entry, stop_loss, tp1, tp2, tp3, source_closed_at, offered_at, evidence_json) VALUES (?, ?, ?, ?, ?, ?, 'Momentum breakout', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, signalKey, chatId, candidate.symbol, candidate.baseAsset, candidate.direction, Math.round(candidate.score), entry, stopLoss, tp1, tp2, tp3, sourceClosedAt, generatedAt, JSON.stringify(evidence)).run();
  const auto = await activateAutomaticPaperExecution({
    database,
    chatId,
    id,
    symbol: candidate.symbol,
    plannedEntry: entry,
    stopLoss,
    paperPlan: {
      signalKey: `V3:HOT_VOLUME:${signalKey}`,
      source: "HOT_VOLUME",
      symbol: candidate.symbol,
      baseAsset: candidate.baseAsset,
      direction: candidate.direction,
      setupType: "Momentum breakout",
      rankingScore: candidate.score,
      technicalScore: candidate.score,
      entryPrice: entry,
      stopLoss,
      takeProfit: tp1,
      takeProfit2: tp2,
      takeProfit3: tp3,
      atr: candidate.atr15m,
      sourceClosedAt,
      openedAt: generatedAt,
      reasons: candidate.reasons,
    },
  });
  if (!auto.active) {
    await recordEvent(id, "AUTO_EXECUTION_BLOCKED", { source: "HOT_VOLUME", reason: auto.reason, observedPrice: auto.price }, "NOT_REQUIRED");
    await database.prepare("UPDATE telegram_trade_monitors SET decision = 'EXPIRED', monitor_state = ?, decided_at = ? WHERE id = ? AND decision = 'OFFERED'")
      .bind(`AUTO_BLOCKED_${auto.reason}`, new Date().toISOString(), id).run();
    return "FAILED";
  }
  try {
    const message = await telegram("sendMessage", {
      chat_id: chatId,
      text: [
        `<b>⚡ BREAKOUT READY · ${escapeHtml(candidate.symbol)}</b>`,
        ...hotMomentumSummary(candidate),
        `🟢 <b>DECISION:</b> <code>EXECUTION AVAILABLE</code> · <b>RULE SCORE:</b> <code>${Math.round(candidate.score)}/100</code>`,
        `🟢 <b>EVIDENCE CONFIDENCE:</b> <code>PROMOTED · ${promotion.pairedResolved}/${promotion.targetPairedResolved} · ${promotion.verdict}</code>`,
        `✅ <b>QUALITY GATE:</b> <code>${quality.passedCount}/5 · ${(quality.ratio * 100).toFixed(0)}%</code>`,
        TELEGRAM_DIVIDER,
        `<b>🟦 EXECUTION PLAN</b>`,
        `⚡ <b>BREAKOUT:</b> <code>${tradePrice(candidate.breakout.level)}</code> · ${escapeHtml(candidate.breakout.kind.replaceAll("_", " "))} confirmed 1H`,
        `✅ <b>RETEST 15M:</b> <code>HOLD + REJECTION · ${candidate.retest.distanceAtr.toFixed(2)} ATR</code>`,
        `✅ <b>REGIME:</b> <code>4H ${signedMetric(candidate.regime.h4ChangePercent)}% · 24H ${signedMetric(candidate.regime.h24ChangePercent)}%</code>`,
        `⚡ <b>REFERENCE ENTRY:</b> <code>${tradePrice(entry)}</code>`,
        `🛑 <b>STOP LOSS:</b> <code>${tradePrice(auto.stopLoss ?? stopLoss)}</code>`,
        `🎯 <b>TP1:</b> <code>${tradePrice(auto.tp1 ?? tp1)}</code> · <b>TP2:</b> <code>${tradePrice(auto.tp2 ?? tp2)}</code> · <b>TP3:</b> <code>${tradePrice(auto.tp3 ?? tp3)}</code>`,
        "",
        `<b>🟪 FLOW & MOMENTUM</b>`,
        `• Volume acceleration 1H: ${candidate.volumeChange.h1 >= 0 ? "+" : ""}${candidate.volumeChange.h1.toFixed(1)}%`,
        `• OI 1H: ${candidate.oiChange.h1 >= 0 ? "+" : ""}${candidate.oiChange.h1.toFixed(2)}% · Taker: ${candidate.takerBuySellRatio?.toFixed(2) ?? "—"}`,
        `• RSI 15m / 1H: ${candidate.rsi.m15.toFixed(1)} / ${candidate.rsi.h1.toFixed(1)}`,
        `• Extension: ${candidate.extensionAtr.toFixed(2)} ATR · Funding: ${signedMetric(candidate.fundingRate * 100, 4)}%`,
        `• Spread: ${candidate.spreadBps.toFixed(2)} bps`,
        TELEGRAM_DIVIDER,
        `<b>🎯 NEXT ACTION</b>`,
        `🤖 <b>AUTO PAPER ACTIVE</b> · <b>ENTRY:</b> <code>${tradePrice(auto.price ?? entry)}</code> · <code>$${(auto.marginUsd ?? 0).toFixed(2)}×${auto.leverage ?? "—"}</code>`,
        `🛡 <b>PLANNED RISK:</b> <code>$${(auto.riskBudgetUsd ?? 0).toFixed(2)} · max 2% saldo</code>`,
        "<i>Risk maksimum 2% saldo. Terminal memonitor candle 15m, RSI, volume, BE, dan close; tidak ada order exchange.</i>",
      ].join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "📊 PNL REPORT", callback_data: `pnl:${id}` }], [{ text: "✅ BE SET", callback_data: `be:${id}` }, { text: "⏹ CLOSE PAPER", callback_data: `closed:${id}` }], [{ text: "📊 OPEN CHART", url: telegramChartUrl(candidate.symbol) }]] },
    });
    await database.prepare("UPDATE telegram_trade_monitors SET message_id = ? WHERE id = ?").bind(String(message.message_id ?? ""), id).run();
    await recordEvent(id, auto.active ? "BREAKOUT_AUTO_EXECUTED" : "BREAKOUT_OFFERED", { symbol: candidate.symbol, direction: candidate.direction, score: candidate.score, auto: auto.reason }, "SENT");
    return "SENT";
  } catch (error) {
    await recordEvent(id, "BREAKOUT_OFFER_FAILED", { error: error instanceof Error ? error.message : "delivery failed" }, "FAILED");
    await database.prepare("DELETE FROM telegram_trade_monitors WHERE id = ? AND decision = 'OFFERED' AND message_id IS NULL").bind(id).run();
    return "FAILED";
  }
}

export async function offerTelegramHotVolumeWatches(rawCandidates: HotVolumeCandidate[], sourceState: unknown) {
  const env = await runtimeEnv();
  if (!(await telegramBotToken()) || !env.TELEGRAM_PAIRING_CODE) return { state: "DISABLED", offered: 0 };
  if (sourceState !== "HEALTHY") return { state: "BLOCKED_SOURCE_HEALTH", offered: 0 };
  if (!(await activeChatId())) return { state: "AWAITING_PAIRING", offered: 0 };
  const promotion = await getHotVolumeEvaluationReport().catch(() => null);
  if (!promotion || promotion.verdict !== "KEEP") return { state: "BLOCKED_EVIDENCE_GATE", offered: 0 };
  const watches = rawCandidates
    .filter((candidate) => candidate.direction !== "NEUTRAL"
      && candidate.status === "BREAKOUT_READY"
      && candidate.score >= TELEGRAM_HOT_VOLUME_MIN_SCORE
      && evaluateHotVolumeTelegramQuality(candidate).passed)
    .sort((left, right) => right.score - left.score)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.symbol === item.symbol) === index)
    .slice(0, 3);
  let offered = 0;
  for (const candidate of watches) {
    if (candidate.direction === "NEUTRAL") continue;
    const result = await offerHotVolumeBreakout(candidate, new Date().toISOString(), promotion);
    if (result === "SENT") offered += 1;
  }
  return { state: "READY", offered };
}

function rsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

export function evaluateMonitorSnapshot(snapshot: MonitorSnapshot): MonitorAdvice {
  const risk = Math.abs(snapshot.entry - snapshot.stopLoss);
  const favorable = snapshot.direction === "LONG" ? snapshot.close - snapshot.entry : snapshot.entry - snapshot.close;
  const currentR = risk > 0 ? favorable / risk : 0;
  const stopHit = snapshot.direction === "LONG" ? snapshot.low <= snapshot.stopLoss : snapshot.high >= snapshot.stopLoss;
  const tpHit = snapshot.direction === "LONG" ? snapshot.high >= snapshot.tp1 : snapshot.low <= snapshot.tp1;
  if (stopHit) return { state: "SL", r: currentR, reason: "Invalidation/SL tersentuh pada candle tertutup." };
  if (tpHit) return { state: "TP", r: currentR, reason: "TP1 tersentuh; review realisasi sesuai execution plan." };
  const structureLost = snapshot.ema21 !== null && (snapshot.direction === "LONG" ? snapshot.close < snapshot.ema21 : snapshot.close > snapshot.ema21);
  const momentumAdverse = snapshot.direction === "LONG" ? snapshot.rsi < 42 : snapshot.rsi > 58;
  if (structureLost && momentumAdverse) return { state: "CLOSE_REVIEW", r: currentR, reason: `Struktur 15m dan RSI berbalik bersamaan; review close manual. Volume ${snapshot.relativeVolume.toFixed(2)}× hanya konteks.` };
  if (currentR >= 1) return { state: "PROTECT", r: currentR, reason: "Posisi mencapai ≥1R: pertimbangkan partial dan net BE setelah fee/funding." };
  if (structureLost) return { state: "WAIT", r: currentR, reason: "EMA21 melemah tetapi momentum belum mengonfirmasi. Tunggu candle tertutup berikutnya." };
  return { state: "HOLD", r: currentR, reason: `Struktur masih valid. Relative volume ${snapshot.relativeVolume.toFixed(2)}× tidak menjadi alasan close sendirian.` };
}

function snapshotFromSeries(row: MonitorRow, series: ChartPoint[]): MonitorSnapshot | null {
  const latest = series.at(-1);
  if (!latest) return null;
  const sourceClosedAtMs = row.source_closed_at < 1_000_000_000_000 ? row.source_closed_at * 1000 : row.source_closed_at;
  if (latest.time <= sourceClosedAtMs) return null;
  const recent = series.slice(-21);
  const volumeBase = recent.slice(0, -1).reduce((sum, item) => sum + item.volume, 0) / Math.max(1, recent.length - 1);
  return {
    direction: row.direction,
    entry: row.actual_entry,
    stopLoss: row.stop_loss,
    tp1: row.tp1,
    close: latest.close,
    high: latest.high,
    low: latest.low,
    ema21: latest.ema21,
    rsi: rsi(series.map((item) => item.close)),
    relativeVolume: volumeBase > 0 ? latest.volume / volumeBase : 1,
  };
}

function svgText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderTelegramSnapshot(row: Pick<MonitorRow, "symbol" | "direction" | "actual_entry" | "stop_loss" | "tp1">, series: ChartPoint[]): string {
  const points = series.slice(-48);
  const width = 1200;
  const height = 675;
  const left = 84;
  const right = 38;
  const top = 92;
  const bottom = 62;
  const values = points.flatMap((point) => [point.high, point.low]).concat([row.actual_entry, row.stop_loss, row.tp1]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, Math.abs(max) * 0.002, 1e-8);
  const x = (index: number) => left + index * ((width - left - right) / Math.max(1, points.length - 1));
  const y = (value: number) => top + (max - value) / range * (height - top - bottom);
  const line = points.map((point, index) => `${x(index).toFixed(1)},${y(point.close).toFixed(1)}`).join(" ");
  const levels = [
    { label: "ENTRY", value: row.actual_entry, color: "#f4f7f5" },
    { label: "SL", value: row.stop_loss, color: "#ff6b7d" },
    { label: "TP1", value: row.tp1, color: "#39f2a6" },
  ];
  const levelSvg = levels.map((level) => `<line x1="${left}" y1="${y(level.value)}" x2="${width - right}" y2="${y(level.value)}" stroke="${level.color}" stroke-width="2" stroke-dasharray="10 8" opacity="0.8"/><text x="${width - right - 6}" y="${y(level.value) - 8}" text-anchor="end" fill="${level.color}" font-size="18" font-family="monospace">${level.label} ${level.value}</text>`).join("");
  const candles = points.map((point, index) => {
    const bullish = point.close >= point.open;
    const color = bullish ? "#39f2a6" : "#ff6b7d";
    return `<line x1="${x(index)}" y1="${y(point.high)}" x2="${x(index)}" y2="${y(point.low)}" stroke="${color}" stroke-width="2" opacity="0.5"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#07100e"/><text x="${left}" y="48" fill="#f4f7f5" font-size="28" font-family="monospace" font-weight="700">PAPER/SHADOW · ${svgText(row.symbol)} · ${row.direction} · CLOSED 15M</text><text x="${left}" y="74" fill="#789489" font-size="16" font-family="monospace">Snapshot audit · bukan order atau rekomendasi transaksi</text><rect x="${left}" y="${top}" width="${width - left - right}" height="${height - top - bottom}" fill="#0b1d18" stroke="#1f3a31"/>${candles}<polyline points="${line}" fill="none" stroke="#f7c96b" stroke-width="3"/>${levelSvg}<text x="${left}" y="${height - 22}" fill="#789489" font-size="16" font-family="monospace">48 candle tertutup · generated ${new Date().toISOString()}</text></svg>`;
}

function monitorKeyboard(row: MonitorRow) {
  if (row.decision === "TRACKING") {
    return { inline_keyboard: [[{ text: "📊 OPEN CHART", url: telegramChartUrl(row.symbol) }]] };
  }
  const controls = [{ text: "✅ BE SET", callback_data: `be:${row.id}` }, { text: "⏹ CLOSED", callback_data: `closed:${row.id}` }];
  return { inline_keyboard: row.decision === "EXECUTED"
    ? [controls, [{ text: "📊 PNL REPORT", callback_data: `pnl:${row.id}` }]]
    : [controls] };
}

async function telegramSnapshot(row: MonitorRow, text: string, series: ChartPoint[]): Promise<void> {
  if (!row.chat_id) return;
  const svg = renderTelegramSnapshot(row, series);
  const env = await runtimeEnv();
  const images = (env as unknown as {
    IMAGES?: { input: (stream: ReadableStream) => { transform: (options: Record<string, unknown>) => { output: (options: { format: string; quality: number }) => Promise<{ response: () => Response }> } } };
  }).IMAGES;
  const form = new FormData();
  form.set("chat_id", row.chat_id);
  form.set("caption", text);
  form.set("parse_mode", "HTML");
  form.set("reply_markup", JSON.stringify(monitorKeyboard(row)));
  if (images) {
    const output = await images.input(new Blob([svg], { type: "image/svg+xml" }).stream()).transform({ width: 1200 }).output({ format: "image/png", quality: 90 });
    form.set("photo", await output.response().blob(), `${row.symbol}-15m.png`);
    await telegramMultipart("sendPhoto", form);
    return;
  }
  form.set("document", new Blob([svg], { type: "image/svg+xml" }), `${row.symbol}-15m.svg`);
  await telegramMultipart("sendDocument", form);
}

export async function runTelegramMonitor() {
  const database = await db();
  const expired = await expireStaleTelegramOffers(database);
  const rows = await database.prepare("SELECT * FROM telegram_trade_monitors WHERE decision IN ('EXECUTED','TRACKING') AND actual_entry IS NOT NULL ORDER BY decided_at ASC LIMIT 20").all<MonitorRow>();
  let checked = 0;
  let alerted = 0;
  for (const row of rows.results ?? []) {
    try {
      const series = await loadChartSeries(row.symbol, "15m");
      const snapshot = snapshotFromSeries(row, series);
      if (!snapshot) continue;
      const advice = evaluateMonitorSnapshot(snapshot);
      const alertHash = await sha256(`${row.id}|${advice.state}`);
      const now = new Date().toISOString();
      checked += 1;
      const terminal = advice.state === "TP" || advice.state === "SL";
      const outcomeR = advice.state === "TP" ? 2 : advice.state === "SL" ? -1 : advice.r;
      const shouldNotify = advice.state !== "HOLD";
      if (row.last_alert_hash !== alertHash && shouldNotify) {
        const learningResult = row.decision === "TRACKING" && terminal
          ? `${advice.state === "TP" ? "🟢" : "🔴"} LEARNING RESULT · ${advice.state === "TP" ? "WIN" : "LOSE"}`
          : `${statusColor(advice.state)} POSITION UPDATE · ${advice.state}`;
        const text = [
          `<b>${learningResult.split(" · ")[0]}:</b> <code>${learningResult.split(" · ")[1]}</code>`,
          `${row.direction === "LONG" ? "🟢" : "🔴"} <b>${escapeHtml(row.symbol)}</b> · <b>BIAS:</b> <code>${row.direction}</code>`,
          TELEGRAM_DIVIDER,
          `<b>🔵 MARKET CHECK</b>`,
          `🕯 <b>CLOSED 15M:</b> <code>${tradePrice(snapshot.close)}</code>`,
          `📊 <b>RESULT:</b> <code>${outcomeR.toFixed(2)}R</code>`,
          `• <b>RSI:</b> <code>${snapshot.rsi.toFixed(1)}</code> · <b>VOLUME:</b> <code>${snapshot.relativeVolume.toFixed(2)}×</code>`,
          "",
          `<b>🎯 NEXT ACTION</b>`,
          `<i>${escapeHtml(advice.reason)}</i>`,
        ].join("\n");
        if (row.chat_id) {
          try {
            await telegramSnapshot(row, text, series);
          } catch {
            await telegram("sendMessage", { chat_id: row.chat_id, text, parse_mode: "HTML", reply_markup: monitorKeyboard(row) });
          }
        }
        await recordEvent(row.id, row.decision === "TRACKING" && terminal ? `LEARNING_${advice.state === "TP" ? "WIN" : "LOSE"}` : advice.state, { ...advice, r: outcomeR, snapshot }, row.chat_id ? "SENT" : "NOT_REQUIRED");
        alerted += 1;
      }
      let evidence: Record<string, unknown> = {};
      try { evidence = JSON.parse(row.evidence_json) as Record<string, unknown>; } catch { evidence = {}; }
      const evidenceJson = JSON.stringify({ ...evidence, latestAdvice: { ...advice, r: outcomeR, outcome: terminal ? (advice.state === "TP" ? "WIN" : "LOSE") : null, close: snapshot.close, rsi: snapshot.rsi, relativeVolume: snapshot.relativeVolume, checkedAt: now } });
      await database.prepare("UPDATE telegram_trade_monitors SET monitor_state = ?, decision = ?, last_checked_at = ?, last_alert_hash = ?, evidence_json = ? WHERE id = ?")
        .bind(advice.state, terminal ? "CLOSED" : row.decision, now, alertHash, evidenceJson, row.id).run();
    } catch (error) {
      await recordEvent(row.id, "MONITOR_ERROR", { error: error instanceof Error ? error.message : "unknown" }, "FAILED");
    }
  }
  return { state: "OK", checked, alerted, expired };
}

function manualMonitor(row: MonitorRow): ManualExecutionMonitor {
  let latestAdvice: ManualExecutionMonitor["latestAdvice"] = null;
  try {
    const evidence = JSON.parse(row.evidence_json) as { latestAdvice?: ManualExecutionMonitor["latestAdvice"] };
    latestAdvice = evidence.latestAdvice ?? null;
  } catch {
    latestAdvice = null;
  }
  return {
    id: row.id,
    paperTradeId: row.signal_key.replace(/^terminal-manual-v1:/, ""),
    symbol: row.symbol,
    direction: row.direction,
    setupType: row.setup_type,
    decision: row.decision,
    state: row.monitor_state,
    actualEntry: finite(row.actual_entry),
    stopLoss: row.stop_loss,
    tp1: row.tp1,
    lastCheckedAt: row.last_checked_at,
    latestAdvice,
  };
}

export async function getManualExecutionStatus(): Promise<ManualExecutionStatus> {
  const database = await db();
  const result = await database.prepare("SELECT * FROM telegram_trade_monitors WHERE signal_key LIKE 'terminal-manual-v1:%' ORDER BY offered_at DESC LIMIT 100").all<MonitorRow>();
  const monitors = (result.results ?? []).map(manualMonitor);
  return {
    schemaVersion: "manual-execution-terminal-v1",
    state: "READY",
    active: monitors.filter((item) => item.decision === "EXECUTED").length,
    passed: monitors.filter((item) => item.decision === "PASSED").length,
    closed: monitors.filter((item) => item.decision === "CLOSED").length,
    monitors,
  };
}

export async function decideManualExecution(input: { tradeId: string; action: "EXECUTE" | "PASS" | "CLOSE"; actualEntry?: number }): Promise<ManualExecutionStatus> {
  if (!/^[a-f0-9-]{16,64}$/i.test(input.tradeId)) throw new Error("Paper trade ID tidak valid.");
  const database = await db();
  const signalKey = `terminal-manual-v1:${input.tradeId}`;
  if (input.action === "CLOSE") {
    await database.prepare("UPDATE telegram_trade_monitors SET decision = 'CLOSED', monitor_state = 'CLOSED_MANUAL', decided_at = ? WHERE signal_key = ?")
      .bind(new Date().toISOString(), signalKey).run();
    return getManualExecutionStatus();
  }
  const trade = await database.prepare("SELECT * FROM paper_trades WHERE id = ? AND status = 'OPEN' LIMIT 1").bind(input.tradeId).first<Record<string, unknown>>();
  if (!trade) throw new Error("Paper trade sudah tidak aktif atau tidak ditemukan.");
  const plannedEntry = finite(trade.entry_price);
  if (!plannedEntry) throw new Error("Entry paper tidak valid.");
  const actualEntry = input.action === "EXECUTE" ? finite(input.actualEntry) : null;
  if (input.action === "EXECUTE" && (!actualEntry || Math.abs(actualEntry - plannedEntry) / plannedEntry > 0.15)) {
    throw new Error("Entry aktual wajib diisi dan maksimal berbeda 15% dari entry rencana.");
  }
  const now = new Date().toISOString();
  const id = (await sha256(signalKey)).slice(0, 16);
  const decision = input.action === "EXECUTE" ? "EXECUTED" : "PASSED";
  const monitorState = input.action === "EXECUTE" ? "MONITORING" : "PASSED";
  const evidenceJson = JSON.stringify({ schemaVersion: "manual-execution-terminal-v1", paperTradeId: input.tradeId, sourceModelVersion: String(trade.model_version ?? "UNKNOWN") });
  await database.prepare(
    `INSERT INTO telegram_trade_monitors (
      id, signal_key, chat_id, symbol, base_asset, direction, setup_type, decision, monitor_state,
      ranking_score, planned_entry, actual_entry, stop_loss, tp1, tp2, tp3, source_closed_at,
      offered_at, decided_at, evidence_json
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(signal_key) DO UPDATE SET decision = excluded.decision, monitor_state = excluded.monitor_state,
      actual_entry = excluded.actual_entry, decided_at = excluded.decided_at, last_alert_hash = NULL,
      evidence_json = excluded.evidence_json`,
  ).bind(
    id, signalKey, String(trade.symbol), String(trade.base_asset), String(trade.direction), String(trade.setup_type),
    decision, monitorState, Number(trade.ranking_score), plannedEntry, actualEntry, Number(trade.stop_loss),
    Number(trade.take_profit), Number(trade.take_profit_2), Number(trade.take_profit_3), Number(trade.source_closed_at),
    now, now, evidenceJson,
  ).run();
  await recordEvent(id, decision, { actualEntry, source: "TERMINAL" }, "NOT_REQUIRED");
  if (input.action === "EXECUTE") await runTelegramMonitor();
  return getManualExecutionStatus();
}

type TelegramUpdate = {
  update_id?: number;
  message?: { chat?: { id?: number; username?: string }; from?: { id?: number; username?: string }; text?: string };
  callback_query?: { id?: string; from?: { id?: number }; data?: string; message?: { chat?: { id?: number }; message_id?: number } };
};

function earlyOfferIsActionable(row: { setup_type?: string; evidence_json?: string; ranking_score?: number }): boolean {
  if (Number(row.ranking_score) < TELEGRAM_EXECUTION_MIN_SCORE) return false;
  try {
    const evidence = JSON.parse(row.evidence_json ?? "{}") as {
      signal?: { status?: string };
      breakout?: { confirmed?: boolean };
      qualityGate?: { passed?: boolean; passedCount?: number; total?: number };
    };
    const qualityPassed = evidence.qualityGate?.passed === true
      && Number(evidence.qualityGate.passedCount) >= TELEGRAM_QUALITY_MIN_CATEGORIES
      && Number(evidence.qualityGate.total) === 5;
    if (row.setup_type === "Early learning") return evidence.signal?.status === "ARMED" && qualityPassed;
    if (row.setup_type === "Momentum breakout") {
      return Number(row.ranking_score) >= TELEGRAM_HOT_VOLUME_MIN_SCORE && evidence.breakout?.confirmed === true && qualityPassed;
    }
    return true;
  } catch {
    return false;
  }
}

function learningOutcome(row: Pick<MonitorRow, "decision" | "monitor_state" | "evidence_json">): "WIN" | "LOSE" | null {
  if (row.decision !== "CLOSED") return null;
  try {
    const evidence = JSON.parse(row.evidence_json) as { latestAdvice?: { outcome?: "WIN" | "LOSE" } };
    return evidence.latestAdvice?.outcome ?? (row.monitor_state === "TP" ? "WIN" : row.monitor_state === "SL" ? "LOSE" : null);
  } catch {
    return row.monitor_state === "TP" ? "WIN" : row.monitor_state === "SL" ? "LOSE" : null;
  }
}

export async function configureTelegramBot(tokenInput: string): Promise<TelegramSetupResult> {
  const token = tokenInput.trim();
  if (!/^\d{6,15}:[A-Za-z0-9_-]{30,100}$/.test(token)) throw new Error("Format token BotFather tidak valid.");
  const env = await runtimeEnv();
  if (!env.TELEGRAM_CONFIG_KEY || !env.TELEGRAM_PAIRING_CODE) throw new Error("Secure Telegram setup belum siap di server.");
  const bot = await telegramWithToken<{ id?: number; is_bot?: boolean; username?: string }>(token, "getMe", {});
  const username = String(bot.username ?? "");
  if (!bot.is_bot || !username) throw new Error("Token tidak terhubung ke akun bot Telegram.");
  const expected = (env.TELEGRAM_EXPECTED_BOT_USERNAME ?? "FikoFuturesMonitorBot").replace(/^@/, "");
  if (username.toLowerCase() !== expected.toLowerCase()) throw new Error(`Token harus milik @${expected}.`);
  await telegramWithToken(token, "deleteWebhook", { drop_pending_updates: false });
  await Promise.all([
    writeSetting("bot_token", await encryptBotToken(token)),
    writeSetting("bot_username", username),
    writeSetting("update_offset", "0"),
  ]);
  return {
    schemaVersion: "telegram-secure-setup-v1",
    state: "CONNECTED",
    botUsername: username,
    pairingCommand: `/start ${env.TELEGRAM_PAIRING_CODE}`,
  };
}

export async function getTelegramPairingCommand(): Promise<string | null> {
  const env = await runtimeEnv();
  return (await telegramBotToken()) && env.TELEGRAM_PAIRING_CODE ? `/start ${env.TELEGRAM_PAIRING_CODE}` : null;
}

export async function pollTelegramUpdates(): Promise<{ state: "DISABLED" | "READY" | "DEGRADED"; received: number; handled: number; failed: number }> {
  const token = await telegramBotToken();
  if (!token) return { state: "DISABLED", received: 0, handled: 0, failed: 0 };
  const storedOffset = Number(await readSetting("update_offset"));
  let offset = Number.isSafeInteger(storedOffset) && storedOffset >= 0 ? storedOffset : 0;
  const updates = await telegramWithToken<TelegramUpdate[]>(token, "getUpdates", {
    offset,
    limit: 100,
    timeout: 0,
    allowed_updates: ["message", "callback_query"],
  });
  let handled = 0;
  let failed = 0;
  for (const update of updates) {
    try {
      const result = await handleTelegramUpdate(update);
      handled += 1;
      await recordEvent("telegram:update", "UPDATE_HANDLED", {
        updateId: update.update_id ?? null,
        kind: update.callback_query ? "CALLBACK" : update.message ? "MESSAGE" : "UNKNOWN",
        action: update.callback_query?.data?.split(":", 1)[0] ?? null,
        state: result.state,
      }, "NOT_REQUIRED").catch(() => null);
    } catch (error) {
      failed += 1;
      const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
      if (chatId) {
        await telegram("sendMessage", { chat_id: String(chatId), text: "⚠️ Perintah belum dapat diproses. Silakan kirim ulang; pesan lain tetap dilanjutkan." }).catch(() => null);
      }
      await recordEvent("telegram:update", "UPDATE_FAILED", {
        updateId: update.update_id ?? null,
        error: error instanceof Error ? error.message : "unknown",
      }, "FAILED").catch(() => null);
    } finally {
      if (Number.isSafeInteger(update.update_id)) offset = Math.max(offset, Number(update.update_id) + 1);
      await writeSetting("update_offset", String(offset));
    }
  }
  return { state: failed > 0 ? "DEGRADED" : "READY", received: updates.length, handled, failed };
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  const database = await db();
  const message = update.message;
  const callback = update.callback_query;
  if (message?.chat?.id && message.text) {
    const chatId = String(message.chat.id);
    const start = message.text.trim().match(/^\/start\s+(.+)$/i);
    if (start) {
      const env = await runtimeEnv();
      if (!env.TELEGRAM_PAIRING_CODE || start[1] !== env.TELEGRAM_PAIRING_CODE) {
        await telegram("sendMessage", { chat_id: chatId, text: "Pairing code tidak valid." });
        return { state: "PAIRING_REJECTED" };
      }
      const now = new Date().toISOString();
      await database.prepare("INSERT INTO telegram_subscriptions (chat_id, user_id, username, state, paired_at, last_seen_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?) ON CONFLICT(chat_id) DO UPDATE SET user_id = excluded.user_id, username = excluded.username, state = 'ACTIVE', last_seen_at = excluded.last_seen_at")
        .bind(chatId, String(message.from?.id ?? message.chat.id), message.from?.username ?? message.chat.username ?? null, now, now).run();
      await telegram("sendMessage", { chat_id: chatId, text: "✅ Fiko Futures Monitor terpasang. Mode READ ONLY; setup actionable otomatis masuk AUTO PAPER. Tidak ada order exchange." });
      return { state: "PAIRED" };
    }
    if (/^\/status(?:@\w+)?$/i.test(message.text.trim())) {
      const result = await database.prepare("SELECT * FROM telegram_trade_monitors WHERE chat_id = ? AND decision IN ('EXECUTED','TRACKING','PASSED','CLOSED') ORDER BY COALESCE(last_checked_at, decided_at, offered_at) DESC LIMIT 100").bind(chatId).all<MonitorRow>();
      const rows = result.results ?? [];
      const executionRows = rows.filter((row) => Boolean(parsedMonitorEvidence(row.evidence_json).execution));
      const autoExecutionRows = executionRows.filter((row) => executionModeLabel(parsedMonitorEvidence(row.evidence_json).execution) === "AUTO PAPER");
      const manualExecutionRows = executionRows.filter((row) => executionModeLabel(parsedMonitorEvidence(row.evidence_json).execution) !== "AUTO PAPER");
      const learningRows = rows.filter((row) => !parsedMonitorEvidence(row.evidence_json).execution && row.decision !== "PASSED");
      const executionActive = executionRows.filter((row) => row.decision === "EXECUTED");
      const learningActive = learningRows.filter((row) => row.decision === "TRACKING" || row.decision === "EXECUTED");
      const executionOutcomes = executionRows.filter((row) => learningOutcome(row));
      const learningOutcomes = learningRows.filter((row) => learningOutcome(row));
      const passed = rows.filter((row) => row.decision === "PASSED");
      const outcomeCount = (items: MonitorRow[], outcome: "WIN" | "LOSE") => items.filter((row) => learningOutcome(row) === outcome).length;
      const activeLine = (row: MonitorRow, icon: string) => {
        const execution = parsedMonitorEvidence(row.evidence_json).execution;
        return `${icon} <b>${escapeHtml(row.symbol)}</b> · <code>${row.direction}</code> · <code>${escapeHtml(row.monitor_state)}</code>${execution ? ` · <code>${executionModeLabel(execution)}</code>` : ""}\n⚡ <b>ENTRY:</b> <code>${tradePrice(row.actual_entry)}</code>`;
      };
      const outcomeLine = (row: MonitorRow) => {
        const outcome = learningOutcome(row);
        return `${outcome === "WIN" ? "🟢" : "🔴"} <b>${escapeHtml(row.symbol)}</b> · <code>${row.direction}</code> · <code>${outcome}</code>`;
      };
      const lines = [
        "<b>📚 EXECUTION & LEARNING STATUS</b>",
        `⚡ <b>EXECUTION:</b> aktif <code>${executionActive.length}</code> · hasil 🟢 <code>${outcomeCount(executionOutcomes, "WIN")}</code> / 🔴 <code>${outcomeCount(executionOutcomes, "LOSE")}</code>`,
        `🤖 <b>AUTO PAPER:</b> <code>${autoExecutionRows.length}</code> · 👤 <b>MANUAL/CUSTOM:</b> <code>${manualExecutionRows.length}</code>`,
        `🧪 <b>MONITOR:</b> aktif <code>${learningActive.length}</code> · hasil 🟢 <code>${outcomeCount(learningOutcomes, "WIN")}</code> / 🔴 <code>${outcomeCount(learningOutcomes, "LOSE")}</code>`,
        `⏭ <b>PASS:</b> <code>${passed.length}</code>`,
        TELEGRAM_DIVIDER,
        "<b>⚡ EXECUTION AKTIF</b>",
        ...executionActive.slice(0, 4).map((row) => activeLine(row, "🟡")),
        ...(executionActive.length ? [] : ["Belum ada execution aktif."]),
        TELEGRAM_ITEM_DIVIDER,
        "<b>🧪 LEARNING MONITOR AKTIF</b>",
        ...learningActive.slice(0, 4).map((row) => activeLine(row, "🧪")),
        ...(learningActive.length ? [] : ["Belum ada learning monitor aktif."]),
        ...(executionOutcomes.length ? [TELEGRAM_ITEM_DIVIDER, "<b>🏁 HASIL EXECUTION</b>", ...executionOutcomes.slice(0, 4).map(outcomeLine)] : []),
        ...(learningOutcomes.length ? [TELEGRAM_ITEM_DIVIDER, "<b>📖 HASIL LEARNING</b>", ...learningOutcomes.slice(0, 4).map(outcomeLine)] : []),
        ...(passed.length ? [TELEGRAM_ITEM_DIVIDER, "<b>⏭ PASS TERBARU</b>", ...passed.slice(0, 4).map((row) => `⚪ <b>${escapeHtml(row.symbol)}</b> · <code>${row.direction}</code> · <code>${escapeHtml(row.setup_type)}</code>`)] : []),
        TELEGRAM_DIVIDER,
        "<i>/pnl hanya menghitung EXECUTION. Hasil MONITOR dipisahkan sebagai bahan belajar.</i>",
      ];
      await telegram("sendMessage", { chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML" });
      return { state: "STATUS_SENT" };
    }
    if (/^\/pnl(?:@\w+)?$/i.test(message.text.trim())) {
      await telegram("sendMessage", { chat_id: chatId, text: await executionPnlReport(database, chatId), parse_mode: "HTML" });
      return { state: "PNL_SENT" };
    }
    const entry = message.text.trim().match(/^\/entry\s+([a-f0-9]{16})\s+([0-9]+(?:\.[0-9]+)?)(?:\s+([0-9]+(?:\.[0-9]+)?))?(?:\s+([0-9]+(?:\.[0-9]+)?))?$/i);
    if (entry) {
      const price = finite(entry[2]);
      const marginUsd = entry[3] ? finite(entry[3]) : PAPER_MARGIN_PER_TRADE_USD;
      const leverage = entry[4] ? finite(entry[4]) : PAPER_DEFAULT_LEVERAGE;
      if (!price || !marginUsd || marginUsd > 1_000 || !leverage || leverage > PAPER_DEFAULT_LEVERAGE) {
        await telegram("sendMessage", { chat_id: chatId, text: `Format ditolak. Gunakan /entry ID HARGA [MARGIN] [LEVERAGE]. Margin maksimum $1,000 dan leverage maksimum ${PAPER_DEFAULT_LEVERAGE}×.` });
        return { state: "INVALID_ENTRY" };
      }
      const activated = await activateExecutionMonitor({
        database,
        chatId,
        id: entry[1],
        price,
        marginUsd,
        leverage,
        priceSource: "USER_ACTUAL_ENTRY",
      });
      if (!activated) {
        await telegram("sendMessage", { chat_id: chatId, text: "Entry ditolak: ID tidak aktif atau harga lebih dari 15% dari rencana." });
        return { state: "INVALID_ENTRY" };
      }
      return { state: "MONITORING" };
    }
    if (/^\/entry(?:@\w+)?\b/i.test(message.text.trim())) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: "Format entry:\n/entry ID HARGA [MARGIN] [LEVERAGE]\n\nContoh: /entry abcdef1234567890 1.2345 10 20\nID hanya diberikan setelah tombol EXECUTION ditekan.",
      });
      return { state: "ENTRY_HELP" };
    }
  }
  if (callback?.id && callback.data && callback.message?.chat?.id) {
    const chatId = String(callback.message.chat.id);
    const match = callback.data.match(/^(exec|liveentry|track|pass|pnl|be|closed|noop):([a-f0-9]{16})$/);
    if (!match) return { state: "IGNORED" };
    const subscription = await database.prepare("SELECT chat_id FROM telegram_subscriptions WHERE chat_id = ? AND state = 'ACTIVE'").bind(chatId).first<{ chat_id: string }>();
    if (!subscription) return { state: "UNAUTHORIZED_CHAT" };
    const [, action, id] = match;
    // GitHub's scheduled runner can receive a callback after Telegram's short
    // acknowledgement window has expired. A stale UI acknowledgement must
    // never prevent the durable decision from being stored.
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Diproses…" }).catch(() => null);
    if (action === "noop") return { state: "DECISION_ALREADY_RECORDED" };
    if (action === "liveentry") {
      const row = await database.prepare("SELECT symbol, setup_type, evidence_json, ranking_score FROM telegram_trade_monitors WHERE id = ? AND chat_id = ? AND decision = 'OFFERED'")
        .bind(id, chatId).first<{ symbol: string; setup_type: string; evidence_json: string; ranking_score: number }>();
      if (!row || !earlyOfferIsActionable(row)) {
        await telegram("sendMessage", { chat_id: chatId, text: "Entry cepat tidak tersedia: setup sudah berubah, kedaluwarsa, atau belum actionable." });
        return { state: "LIVE_ENTRY_UNAVAILABLE" };
      }
      const livePrice = await loadLivePrice(row.symbol).catch(() => 0);
      if (!(livePrice > 0)) {
        await telegram("sendMessage", { chat_id: chatId, text: "Harga Binance live belum tersedia. Gunakan CUSTOM ENTRY atau coba kembali pada siklus berikutnya." });
        return { state: "LIVE_PRICE_UNAVAILABLE" };
      }
      const activated = await activateExecutionMonitor({
        database,
        chatId,
        id,
        price: livePrice,
        marginUsd: PAPER_MARGIN_PER_TRADE_USD,
        leverage: PAPER_DEFAULT_LEVERAGE,
        priceSource: "BINANCE_LIVE_BUTTON",
      });
      if (!activated) {
        await telegram("sendMessage", { chat_id: chatId, text: "Entry cepat ditolak: harga sudah lebih dari 15% dari rencana atau setup tidak lagi aktif." });
        return { state: "LIVE_ENTRY_REJECTED" };
      }
      return { state: "MONITORING" };
    }
    if (action === "exec") {
      const row = await database.prepare("SELECT setup_type, evidence_json, ranking_score FROM telegram_trade_monitors WHERE id = ? AND chat_id = ? AND decision = 'OFFERED'").bind(id, chatId).first<{ setup_type: string; evidence_json: string; ranking_score: number }>();
      if (!row || !earlyOfferIsActionable(row)) {
        await telegram("sendMessage", { chat_id: chatId, text: "Execution belum tersedia: Early setup belum ARMED. Gunakan MONITOR untuk loop belajar atau PASS." });
        return { state: "EXECUTION_BLOCKED" };
      }
      await telegram("sendMessage", { chat_id: chatId, text: `Kirim data entry aktual:\n/entry ${id} HARGA [MARGIN] [LEVERAGE]\n\nContoh lengkap: /entry ${id} 1.2345 10 20\nJika margin/leverage dikosongkan, default $10 × ${PAPER_DEFAULT_LEVERAGE}.` });
      return { state: "AWAITING_ENTRY" };
    }
    if (action === "track") {
      const row = await database.prepare("SELECT planned_entry, message_id, symbol FROM telegram_trade_monitors WHERE id = ? AND chat_id = ? AND decision = 'OFFERED'").bind(id, chatId).first<{ planned_entry: number; message_id: string | null; symbol: string }>();
      if (!row) return { state: "TRACKING_UNAVAILABLE" };
      const now = new Date().toISOString();
      await database.prepare("UPDATE telegram_trade_monitors SET decision = 'TRACKING', monitor_state = 'LEARNING', actual_entry = planned_entry, decided_at = ? WHERE id = ? AND chat_id = ? AND decision = 'OFFERED'").bind(now, id, chatId).run();
      await recordEvent(id, "TRACKING_STARTED", { referenceEntry: row.planned_entry }, "NOT_REQUIRED");
      await telegram("sendMessage", { chat_id: chatId, text: [`🧪 <b>LEARNING MONITOR AKTIF</b>`, TELEGRAM_DIVIDER, `<b>🟦 REFERENCE PLAN</b>`, `⚡ <b>REFERENCE ENTRY:</b> <code>${tradePrice(row.planned_entry)}</code>`, `🕯 <b>MULAI:</b> <code>CLOSED 15M BERIKUTNYA</code>`, `🏁 <b>AKHIR:</b> <code>WIN / LOSE</code>`, "", "<i>Gunakan /status untuk melihat posisi.</i>"].join("\n"), parse_mode: "HTML" });
      await markOfferDecision({ chatId, messageId: row.message_id, id, symbol: row.symbol, state: "TRACKING" });
      return { state: "TRACKING" };
    }
    if (action === "pass") {
      const row = await database.prepare("SELECT symbol, direction, setup_type, message_id FROM telegram_trade_monitors WHERE id = ? AND chat_id = ? AND decision = 'OFFERED'").bind(id, chatId).first<Pick<MonitorRow, "symbol" | "direction" | "setup_type"> & { message_id: string | null }>();
      if (!row) return { state: "PASS_UNAVAILABLE" };
      await database.prepare("UPDATE telegram_trade_monitors SET decision = 'PASSED', monitor_state = 'PASSED', decided_at = ? WHERE id = ? AND chat_id = ? AND decision = 'OFFERED'").bind(new Date().toISOString(), id, chatId).run();
      await recordEvent(id, "PASSED", { symbol: row.symbol, direction: row.direction }, "NOT_REQUIRED");
      await telegram("sendMessage", { chat_id: chatId, text: [`⏭ <b>PASS TERCATAT</b>`, `${row.direction === "LONG" ? "🟢" : "🔴"} <b>${escapeHtml(row.symbol)}</b> · <b>BIAS:</b> <code>${row.direction}</code>`, TELEGRAM_DIVIDER, `<b>SETUP:</b> <code>${escapeHtml(row.setup_type)}</code>`, "<i>Tidak masuk monitor PNL, tetapi tetap tersimpan dalam riwayat keputusan.</i>", "", "<i>Lihat melalui /status.</i>"].join("\n"), parse_mode: "HTML" });
      await markOfferDecision({ chatId, messageId: row.message_id, id, symbol: row.symbol, state: "PASSED" });
      return { state: "PASSED" };
    }
    if (action === "pnl") {
      await telegram("sendMessage", { chat_id: chatId, text: await executionPnlReport(database, chatId, id), parse_mode: "HTML" });
      return { state: "PNL_SENT" };
    }
    if (action === "be") {
      await database.prepare("UPDATE telegram_trade_monitors SET monitor_state = 'BE_SET' WHERE id = ? AND chat_id = ? AND decision IN ('EXECUTED','TRACKING')").bind(id, chatId).run();
      await recordEvent(id, "BE_CONFIRMED", {}, "NOT_REQUIRED");
      return { state: "BE_SET" };
    }
    const closing = await database.prepare("SELECT * FROM telegram_trade_monitors WHERE id = ? AND chat_id = ? AND decision IN ('EXECUTED','TRACKING')").bind(id, chatId).first<MonitorRow>();
    if (!closing) return { state: "CLOSE_UNAVAILABLE" };
    const closedAt = new Date().toISOString();
    const closePrice = await loadLivePrice(closing.symbol).catch(() => 0);
    const evidence = parsedMonitorEvidence(closing.evidence_json);
    if (evidence.execution?.paperTradeId) {
      await manualClosePaperTrade(evidence.execution.paperTradeId);
    }
    const evidenceJson = closePrice > 0 ? JSON.stringify({ ...evidence, executionExit: { price: closePrice, closedAt, source: "BINANCE_LIVE" } }) : closing.evidence_json;
    await database.prepare("UPDATE telegram_trade_monitors SET decision = 'CLOSED', monitor_state = 'CLOSED', decided_at = ?, evidence_json = ? WHERE id = ? AND chat_id = ?").bind(closedAt, evidenceJson, id, chatId).run();
    await recordEvent(id, "CLOSED_CONFIRMED", { closePrice: closePrice || null }, "NOT_REQUIRED");
    await telegram("sendMessage", { chat_id: chatId, text: closePrice > 0 ? [`⏹ <b>MANUAL CLOSE TERCATAT</b>`, TELEGRAM_DIVIDER, `💰 <b>CLOSE PRICE:</b> <code>${tradePrice(closePrice)}</code>`, "", "<i>Ketik /pnl untuk hasil akhirnya.</i>"].join("\n") : [`⏹ <b>MANUAL CLOSE TERCATAT</b>`, TELEGRAM_DIVIDER, "<i>Harga Binance belum tersedia; laporan memakai snapshot terakhir.</i>"].join("\n"), parse_mode: "HTML" });
    return { state: "CLOSED" };
  }
  return { state: "IGNORED" };
}

export async function verifyWebhookSecret(value: string | null): Promise<boolean> {
  const env = await runtimeEnv();
  return Boolean(env.TELEGRAM_WEBHOOK_SECRET && value && value === env.TELEGRAM_WEBHOOK_SECRET);
}

export async function verifyMonitorToken(value: string | null): Promise<boolean> {
  const env = await runtimeEnv();
  return Boolean(env.TELEGRAM_MONITOR_TOKEN && value === `Bearer ${env.TELEGRAM_MONITOR_TOKEN}`);
}
