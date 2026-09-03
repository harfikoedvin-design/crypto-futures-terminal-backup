import { loadChartSeries, type AnalysisResult, type ChartPoint, type Direction } from "@/lib/market";
import { RISK_ENGINE_VERSION } from "@/lib/risk-engine";

export const EVALUATION_SCHEMA_VERSION = "controlled-evaluation-v2" as const;
export const EVALUATION_METHOD_VERSION = "V2_CLOSED_CANDLE" as const;
export const LEGACY_EVALUATION_VERSION = "V1_SAMPLED_MARK" as const;
export const EVALUATION_TARGET_RESOLVED = 100;
export const EVALUATION_BASELINE_MIN_RESOLVED = 30;
const MAX_HORIZON_MS = 24 * 60 * 60 * 1000;

type D1Row = Record<string, unknown>;
type EvaluationStatement = {
  bind: (...values: unknown[]) => EvaluationStatement;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};
type EvaluationDatabase = { prepare: (query: string) => EvaluationStatement };

declare global {
  var __EVALUATION_D1_TEST_BINDING__: EvaluationDatabase | undefined;
}

export type EvaluationSlice = {
  label: string;
  total: number;
  open: number;
  resolved: number;
  wins: number;
  losses: number;
  expired: number;
  decisive: number;
  winRate: number;
  expiredPositive: number;
  expiredNegative: number;
  expectancyR: number;
  netR: number;
  profitFactor: number | null;
};

export type EvaluationReport = {
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  mode: "SHADOW_READ_ONLY";
  verdict: "INSUFFICIENT DATA" | "OBSERVE" | "KEEP" | "REVERT";
  verdictReason: string;
  targetResolved: number;
  shadow: EvaluationSlice;
  eligible: EvaluationSlice;
  blocked: EvaluationSlice;
  baselinePaper: EvaluationSlice;
  legacyExcluded: EvaluationSlice;
  byDirection: EvaluationSlice[];
  byRegime: EvaluationSlice[];
  crossExchange: Array<{ status: string; count: number }>;
  methodology: {
    activeVersion: typeof EVALUATION_METHOD_VERSION;
    settlement: "CLOSED_15M_HIGH_LOW_STOP_FIRST";
    horizonHours: 24;
    legacyExcluded: number;
    uniqueSymbols: number;
    periodStart: string | null;
    periodEnd: string | null;
  };
  generatedAt: string;
};

async function database(): Promise<EvaluationDatabase> {
  if (globalThis.__EVALUATION_D1_TEST_BINDING__) return globalThis.__EVALUATION_D1_TEST_BINDING__;
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Evaluation database is unavailable");
  return env.DB as EvaluationDatabase;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function slice(label: string, rows: D1Row[]): EvaluationSlice {
  const resolvedRows = rows.filter((row) => String(row.status) !== "OPEN");
  const wins = resolvedRows.filter((row) => String(row.status) === "TP").length;
  const losses = resolvedRows.filter((row) => String(row.status) === "SL").length;
  const expired = resolvedRows.filter((row) => String(row.status) === "EXPIRED").length;
  const decisive = wins + losses;
  const outcomes = resolvedRows.map((row) => numberValue(row.outcome_r));
  const netR = outcomes.reduce((sum, value) => sum + value, 0);
  const grossProfit = outcomes.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(outcomes.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  return {
    label,
    total: rows.length,
    open: rows.length - resolvedRows.length,
    resolved: resolvedRows.length,
    wins,
    losses,
    expired,
    decisive,
    winRate: decisive ? (wins / decisive) * 100 : 0,
    expiredPositive: resolvedRows.filter((row) => String(row.status) === "EXPIRED" && numberValue(row.outcome_r) > 0).length,
    expiredNegative: resolvedRows.filter((row) => String(row.status) === "EXPIRED" && numberValue(row.outcome_r) < 0).length,
    expectancyR: resolvedRows.length ? netR / resolvedRows.length : 0,
    netR,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
  };
}

function group(rows: D1Row[], field: string): EvaluationSlice[] {
  const groups = new Map<string, D1Row[]>();
  for (const row of rows) {
    const label = String(row[field] ?? "UNKNOWN");
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  return [...groups.entries()].map(([label, values]) => slice(label, values)).sort((a, b) => b.total - a.total);
}

function relevantClosedCandles(row: D1Row, series: ChartPoint[], checkedAt: string): ChartPoint[] {
  const openedAt = Date.parse(String(row.opened_at));
  const lastCheckedAt = Date.parse(String(row.last_checked_at));
  const horizonAt = openedAt + MAX_HORIZON_MS;
  const upperBound = Math.min(Date.parse(checkedAt), horizonAt);
  return series.filter((point) => point.time > Math.max(openedAt, lastCheckedAt) && point.time <= upperBound);
}

async function settleOpen(rows: D1Row[], checkedAt: string) {
  const db = await database();
  const symbols = [...new Set(rows.map((row) => String(row.symbol)))];
  const seriesEntries = await Promise.all(symbols.map(async (symbol) => {
    try {
      return [symbol, await loadChartSeries(symbol, "15m")] as const;
    } catch {
      return [symbol, []] as const;
    }
  }));
  const seriesBySymbol = new Map(seriesEntries);
  for (const row of rows) {
    const series = seriesBySymbol.get(String(row.symbol)) ?? [];
    const candles = relevantClosedCandles(row, series, checkedAt);
    if (!candles.length) continue;
    const entry = numberValue(row.entry_price);
    const stop = numberValue(row.stop_loss);
    const target = numberValue(row.take_profit);
    const direction = String(row.direction) as Exclude<Direction, "NO TRADE">;
    const long = direction === "LONG";
    let status: "OPEN" | "SL" | "TP" | "EXPIRED" = "OPEN";
    let exitPrice = candles.at(-1)!.close;
    let closedAt = checkedAt;
    let high = numberValue(row.observed_high);
    let low = numberValue(row.observed_low);
    for (const candle of candles) {
      high = Math.max(high, candle.high);
      low = Math.min(low, candle.low);
      const stopHit = long ? candle.low <= stop : candle.high >= stop;
      const targetHit = long ? candle.high >= target : candle.low <= target;
      if (stopHit) {
        status = "SL";
        exitPrice = stop;
        closedAt = new Date(candle.time).toISOString();
        break;
      }
      if (targetHit) {
        status = "TP";
        exitPrice = target;
        closedAt = new Date(candle.time).toISOString();
        break;
      }
    }
    const horizonReached = Date.parse(checkedAt) - Date.parse(String(row.opened_at)) >= MAX_HORIZON_MS;
    if (status === "OPEN" && !horizonReached) {
      await db.prepare("UPDATE shadow_observations SET last_checked_at = ?, observed_high = ?, observed_low = ? WHERE id = ? AND status = 'OPEN'")
        .bind(new Date(candles.at(-1)!.time).toISOString(), high, low, String(row.id)).run();
      continue;
    }
    if (status === "OPEN") {
      status = "EXPIRED";
      closedAt = new Date(candles.at(-1)!.time).toISOString();
    }
    const risk = Math.abs(entry - stop);
    const directionalMove = (exitPrice - entry) * (long ? 1 : -1);
    const outcomeR = status === "SL" ? -1 : status === "TP" ? (risk > 0 ? Math.abs(target - entry) / risk : 0) : (risk > 0 ? directionalMove / risk : 0);
    await db.prepare("UPDATE shadow_observations SET status = ?, outcome_r = ?, closed_at = ?, last_checked_at = ?, observed_high = ?, observed_low = ?, outcome_source = 'CLOSED_15M_REPLAY' WHERE id = ? AND status = 'OPEN'")
      .bind(status, outcomeR, closedAt, closedAt, high, low, String(row.id)).run();
  }
}

function validResults(value: unknown): AnalysisResult[] {
  return Array.isArray(value) ? value.filter((item): item is AnalysisResult => Boolean(item) && typeof item === "object") : [];
}

export async function syncShadowEvaluation(rawResults: unknown, generatedAt: string): Promise<EvaluationReport> {
  const results = validResults(rawResults).slice(0, 40);
  const checkedAt = Number.isFinite(Date.parse(generatedAt)) ? new Date(generatedAt).toISOString() : new Date().toISOString();
  const db = await database();
  const open = await db.prepare("SELECT * FROM shadow_observations WHERE status = 'OPEN' AND evaluation_version = ? ORDER BY opened_at ASC").bind(EVALUATION_METHOD_VERSION).all<D1Row>();
  await settleOpen(open.results ?? [], checkedAt);

  for (const result of results) {
    const diagnostic = result.diagnostic;
    const shadow = diagnostic?.adaptiveShadow;
    const sourceClosedAt = diagnostic?.snapshots?.primary.closedAt;
    if (!shadow || shadow.direction === "NO TRADE" || !shadow.executionEntry || !shadow.stopLoss || !shadow.takeProfit || !sourceClosedAt) continue;
    const earlyStatus = result.earlySignal?.status ?? null;
    const signalKey = `${EVALUATION_SCHEMA_VERSION}:${result.symbol}:${shadow.direction}:${sourceClosedAt}`;
    const evidence = {
      schemaVersion: EVALUATION_SCHEMA_VERSION,
      symbol: result.symbol,
      direction: shadow.direction,
      sourceClosedAt,
      regime: shadow.regime,
      eligible: shadow.eligible,
      scores: { long: shadow.longScore, short: shadow.shortScore, delta: shadow.scoreDelta },
      plan: { entry: shadow.executionEntry, stop: shadow.stopLoss, target: shadow.takeProfit },
      earlyStatus,
    };
    const evidenceHash = await sha256Hex(JSON.stringify(evidence));
    await db.prepare(
      `INSERT OR IGNORE INTO shadow_observations (
        id, signal_key, symbol, base_asset, direction, regime, early_status, eligible,
        technical_score, long_score, short_score, score_delta, entry_price, stop_loss,
        take_profit, status, opened_at, last_checked_at, observed_high, observed_low,
        source_closed_at, evaluation_version, outcome_source, evidence_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), signalKey, result.symbol, diagnostic.baseAsset, shadow.direction, shadow.regime,
      earlyStatus, shadow.eligible ? 1 : 0, diagnostic.technicalScore, shadow.longScore, shadow.shortScore,
      shadow.scoreDelta, shadow.executionEntry, shadow.stopLoss, shadow.takeProfit, checkedAt, checkedAt,
      diagnostic.price, diagnostic.price, sourceClosedAt, EVALUATION_METHOD_VERSION, "PENDING_CLOSED_15M", evidenceHash,
    ).run();
  }
  return getEvaluationReport();
}

export async function attachCrossExchangeEvidence(symbol: string, direction: string, status: unknown, evidenceHash: unknown) {
  const allowed = new Set(["CONFIRMED", "MIXED", "OPPOSED", "INSUFFICIENT"]);
  const normalizedStatus = String(status ?? "");
  if (!allowed.has(normalizedStatus) || !/^[A-Z0-9]{1,20}USDT$/.test(symbol) || !new Set(["LONG", "SHORT"]).has(direction)) return;
  const db = await database();
  await db.prepare(
    `UPDATE shadow_observations SET cross_exchange_status = ?, cross_exchange_hash = ?
     WHERE id = (SELECT id FROM shadow_observations WHERE symbol = ? AND direction = ? ORDER BY opened_at DESC LIMIT 1)`,
  ).bind(normalizedStatus, typeof evidenceHash === "string" ? evidenceHash : null, symbol, direction).run();
}

export async function getEvaluationReport(): Promise<EvaluationReport> {
  const db = await database();
  const [shadowResult, paperResult] = await Promise.all([
    db.prepare("SELECT * FROM shadow_observations ORDER BY opened_at DESC LIMIT 2000").all<D1Row>(),
    db.prepare("SELECT status, outcome_r FROM paper_trades WHERE model_version = ? ORDER BY opened_at DESC LIMIT 1000").bind(RISK_ENGINE_VERSION).all<D1Row>(),
  ]);
  const allRows = shadowResult.results ?? [];
  const rows = allRows.filter((row) => String(row.evaluation_version) === EVALUATION_METHOD_VERSION);
  const legacyRows = allRows.filter((row) => String(row.evaluation_version) !== EVALUATION_METHOD_VERSION);
  const paperRows = paperResult.results ?? [];
  const shadow = slice("ALL SHADOW", rows);
  const eligible = slice("FULL GATE", rows.filter((row) => numberValue(row.eligible) === 1));
  const blocked = slice("BLOCKED", rows.filter((row) => numberValue(row.eligible) !== 1));
  const baselinePaper = slice("RISK V3 PAPER", paperRows);
  const legacyExcluded = slice("LEGACY SAMPLED", legacyRows);
  let verdict: EvaluationReport["verdict"] = "INSUFFICIENT DATA";
  let verdictReason = `${shadow.resolved}/${EVALUATION_TARGET_RESOLVED} shadow resolved · ${baselinePaper.resolved}/${EVALUATION_BASELINE_MIN_RESOLVED} baseline V3.`;
  if (shadow.resolved >= EVALUATION_TARGET_RESOLVED && baselinePaper.resolved >= EVALUATION_BASELINE_MIN_RESOLVED) {
    const delta = eligible.expectancyR - baselinePaper.expectancyR;
    if (eligible.expectancyR <= 0 || delta <= 0) {
      verdict = "REVERT";
      verdictReason = `Shadow tidak mengungguli baseline: delta expectancy ${delta.toFixed(2)}R.`;
    } else if (delta >= 0.15 && (eligible.profitFactor ?? 99) >= 1.2) {
      verdict = "KEEP";
      verdictReason = `Shadow unggul ${delta.toFixed(2)}R dengan profit factor memadai.`;
    } else {
      verdict = "OBSERVE";
      verdictReason = `Ada perbaikan ${delta.toFixed(2)}R, tetapi belum melewati evidence gate KEEP.`;
    }
  }
  const crossCounts = new Map<string, number>();
  for (const row of rows) {
    const status = String(row.cross_exchange_status ?? "NOT CHECKED");
    crossCounts.set(status, (crossCounts.get(status) ?? 0) + 1);
  }
  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    mode: "SHADOW_READ_ONLY",
    verdict,
    verdictReason,
    targetResolved: EVALUATION_TARGET_RESOLVED,
    shadow,
    eligible,
    blocked,
    baselinePaper,
    legacyExcluded,
    byDirection: group(rows, "direction"),
    byRegime: group(rows, "regime"),
    crossExchange: [...crossCounts.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    methodology: {
      activeVersion: EVALUATION_METHOD_VERSION,
      settlement: "CLOSED_15M_HIGH_LOW_STOP_FIRST",
      horizonHours: 24,
      legacyExcluded: legacyRows.length,
      uniqueSymbols: new Set(rows.map((row) => String(row.symbol))).size,
      periodStart: rows.length ? String(rows.reduce((minimum, row) => String(row.opened_at) < minimum ? String(row.opened_at) : minimum, String(rows[0].opened_at))) : null,
      periodEnd: rows.length ? String(rows.reduce((maximum, row) => String(row.opened_at) > maximum ? String(row.opened_at) : maximum, String(rows[0].opened_at))) : null,
    },
    generatedAt: new Date().toISOString(),
  };
}
