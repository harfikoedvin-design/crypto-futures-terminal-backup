import type { HotVolumeCandidate, HotVolumeReport } from "@/lib/hot-volume";
import { loadChartSeries, type ChartPoint } from "@/lib/market";

export const HOT_VOLUME_EVALUATION_VERSION = "hot-volume-evidence-v2" as const;
export const HOT_VOLUME_EVALUATION_TARGET_PAIRED = 30;
const HOT_VOLUME_HORIZON_MS = 24 * 60 * 60 * 1000;

type HotVolumeVariant = "RAW" | "HARDENED";
type D1Row = Record<string, unknown>;
type HotVolumeStatement = {
  bind: (...values: unknown[]) => HotVolumeStatement;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};
type HotVolumeDatabase = { prepare: (query: string) => HotVolumeStatement };

declare global {
  var __HOT_VOLUME_D1_TEST_BINDING__: HotVolumeDatabase | undefined;
}

export type HotVolumeEvaluationSlice = {
  label: string;
  total: number;
  open: number;
  resolved: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  expectancyR: number;
  netR: number;
  profitFactor: number | null;
  maxDrawdownR: number;
};

export type HotVolumeEvaluationReport = {
  schemaVersion: typeof HOT_VOLUME_EVALUATION_VERSION;
  mode: "SHADOW_READ_ONLY";
  verdict: "INSUFFICIENT DATA" | "OBSERVE" | "KEEP" | "REVERT";
  verdictReason: string;
  targetPairedResolved: typeof HOT_VOLUME_EVALUATION_TARGET_PAIRED;
  pairedResolved: number;
  raw: HotVolumeEvaluationSlice;
  hardened: HotVolumeEvaluationSlice;
  pairedRaw: HotVolumeEvaluationSlice;
  pairedHardened: HotVolumeEvaluationSlice;
  byDirection: HotVolumeEvaluationSlice[];
  methodology: {
    horizonHours: 24;
    targetR: 2;
    stopR: 1;
    settlement: "CLOSED_15M_HIGH_LOW_STOP_FIRST";
    entry: "SIGNAL_CLOSED_15M";
    comparison: "FORWARD_RAW_VS_EXECUTION_ELIGIBLE_COHORTS";
    promotion: "KEEP_REQUIRED_FOR_AUTO_PAPER";
  };
  generatedAt: string;
};

async function database(): Promise<HotVolumeDatabase> {
  if (globalThis.__HOT_VOLUME_D1_TEST_BINDING__) return globalThis.__HOT_VOLUME_D1_TEST_BINDING__;
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Hot Volume evidence database is unavailable");
  return env.DB as HotVolumeDatabase;
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function slice(label: string, rows: D1Row[]): HotVolumeEvaluationSlice {
  const resolved = rows.filter((row) => String(row.status) !== "OPEN");
  const outcomes = resolved.map((row) => numeric(row.outcome_r));
  const wins = resolved.filter((row) => String(row.status) === "TP").length;
  const losses = resolved.filter((row) => String(row.status) === "SL").length;
  const expired = resolved.filter((row) => String(row.status) === "EXPIRED").length;
  const netR = outcomes.reduce((sum, value) => sum + value, 0);
  const grossProfit = outcomes.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(outcomes.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const row of [...resolved].sort((left, right) => String(left.closed_at).localeCompare(String(right.closed_at)))) {
    equity += numeric(row.outcome_r);
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }
  return {
    label,
    total: rows.length,
    open: rows.length - resolved.length,
    resolved: resolved.length,
    wins,
    losses,
    expired,
    winRate: wins + losses ? (wins / (wins + losses)) * 100 : 0,
    expectancyR: resolved.length ? netR / resolved.length : 0,
    netR,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    maxDrawdownR,
  };
}

function byDirection(rows: D1Row[]): HotVolumeEvaluationSlice[] {
  return ["LONG", "SHORT"].map((direction) => slice(direction, rows.filter((row) => String(row.direction) === direction)));
}

function relevantCandles(row: D1Row, series: ChartPoint[], checkedAt: string): ChartPoint[] {
  const openedAt = Date.parse(String(row.opened_at));
  const lastCheckedAt = Date.parse(String(row.last_checked_at));
  const upperBound = Math.min(Date.parse(checkedAt), openedAt + HOT_VOLUME_HORIZON_MS);
  return series.filter((point) => point.time > Math.max(openedAt, lastCheckedAt) && point.time <= upperBound);
}

async function settleOpen(rows: D1Row[], checkedAt: string): Promise<void> {
  const store = await database();
  const symbols = [...new Set(rows.map((row) => String(row.symbol)))];
  const loaded = await Promise.all(symbols.map(async (symbol) => {
    try {
      return [symbol, await loadChartSeries(symbol, "15m")] as const;
    } catch {
      return [symbol, []] as const;
    }
  }));
  const bySymbol = new Map(loaded);
  for (const row of rows) {
    const candles = relevantCandles(row, bySymbol.get(String(row.symbol)) ?? [], checkedAt);
    if (!candles.length) continue;
    const long = String(row.direction) === "LONG";
    const stop = numeric(row.stop_loss);
    const target = numeric(row.take_profit);
    const entry = numeric(row.entry_price);
    let status: "OPEN" | "TP" | "SL" | "EXPIRED" = "OPEN";
    let exitPrice = candles.at(-1)!.close;
    let closedAt = new Date(candles.at(-1)!.time).toISOString();
    let observedHigh = numeric(row.observed_high);
    let observedLow = numeric(row.observed_low);
    for (const candle of candles) {
      observedHigh = Math.max(observedHigh, candle.high);
      observedLow = Math.min(observedLow, candle.low);
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
    const horizonReached = Date.parse(checkedAt) - Date.parse(String(row.opened_at)) >= HOT_VOLUME_HORIZON_MS;
    if (status === "OPEN" && !horizonReached) {
      await store.prepare("UPDATE hot_volume_observations SET last_checked_at = ?, observed_high = ?, observed_low = ? WHERE id = ? AND status = 'OPEN'")
        .bind(closedAt, observedHigh, observedLow, String(row.id)).run();
      continue;
    }
    if (status === "OPEN") status = "EXPIRED";
    const risk = Math.abs(entry - stop);
    const move = (exitPrice - entry) * (long ? 1 : -1);
    const outcomeR = status === "SL" ? -1 : status === "TP" ? 2 : risk > 0 ? move / risk : 0;
    const outcomeHash = await sha256(`${row.open_evidence_hash}|${status}|${closedAt}|${exitPrice}|${outcomeR}`);
    await store.prepare("UPDATE hot_volume_observations SET status = ?, outcome_r = ?, exit_price = ?, closed_at = ?, last_checked_at = ?, observed_high = ?, observed_low = ?, outcome_evidence_hash = ? WHERE id = ? AND status = 'OPEN'")
      .bind(status, outcomeR, exitPrice, closedAt, closedAt, observedHigh, observedLow, outcomeHash, String(row.id)).run();
  }
}

function variants(candidate: HotVolumeCandidate): HotVolumeVariant[] {
  const output: HotVolumeVariant[] = [];
  if (candidate.direction !== "NEUTRAL" && candidate.volumeChange.h1 >= 20) output.push("RAW");
  if (candidate.status === "BREAKOUT_READY") output.push("HARDENED");
  return output;
}

async function insertObservation(candidate: HotVolumeCandidate, variant: HotVolumeVariant): Promise<void> {
  if (candidate.direction === "NEUTRAL" || candidate.atr15m <= 0 || candidate.closedPrice <= 0) return;
  const long = candidate.direction === "LONG";
  const entry = candidate.closedPrice;
  const stop = entry + candidate.atr15m * (long ? -1 : 1);
  const target = entry + candidate.atr15m * (long ? 2 : -2);
  const cohortKey = `${HOT_VOLUME_EVALUATION_VERSION}:${candidate.symbol}:${candidate.direction}:${candidate.closedAt}`;
  const signalKey = `${cohortKey}:${variant}`;
  const evidence = {
    schemaVersion: HOT_VOLUME_EVALUATION_VERSION,
    variant,
    cohortKey,
    symbol: candidate.symbol,
    direction: candidate.direction,
    sourceClosedAt: candidate.closedAt,
    radarStatus: candidate.status,
    score: candidate.score,
    plan: { entry, stop, target, stopR: 1, targetR: 2, horizonHours: 24 },
    snapshot: {
      priceChange1h: candidate.priceChange.h1,
      volume1hUsd: candidate.volumeUsd.h1,
      volumeChange1h: candidate.volumeChange.h1,
      oiChange1h: candidate.oiChange.h1,
      takerRatio: candidate.takerBuySellRatio,
      spreadBps: candidate.spreadBps,
      extensionAtr: candidate.extensionAtr,
      stochastic: candidate.stochastic.signal,
      ema: candidate.ema15m.alignment,
      regimeAligned: candidate.regime.aligned,
      retestConfirmed: candidate.retest.confirmed,
      retestDistanceAtr: candidate.retest.distanceAtr,
    },
  };
  const openHash = await sha256(JSON.stringify(evidence));
  await (await database()).prepare(
    `INSERT OR IGNORE INTO hot_volume_observations (
      id, signal_key, cohort_key, evaluation_version, variant, symbol, base_asset, direction,
      radar_status, radar_score, entry_price, stop_loss, take_profit, atr_15m, status,
      opened_at, last_checked_at, observed_high, observed_low, source_closed_at,
      open_evidence_hash, evidence_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), signalKey, cohortKey, HOT_VOLUME_EVALUATION_VERSION, variant, candidate.symbol,
    candidate.baseAsset, candidate.direction, candidate.status, candidate.score, entry, stop, target,
    candidate.atr15m, candidate.closedAt, candidate.closedAt, entry, entry, candidate.closedAt,
    openHash, JSON.stringify(evidence),
  ).run();
}

export async function syncHotVolumeEvaluation(report: HotVolumeReport): Promise<HotVolumeEvaluationReport> {
  const checkedAt = Number.isFinite(Date.parse(report.generatedAt)) ? new Date(report.generatedAt).toISOString() : new Date().toISOString();
  const store = await database();
  const open = await store.prepare("SELECT * FROM hot_volume_observations WHERE status = 'OPEN' AND evaluation_version = ? ORDER BY opened_at ASC")
    .bind(HOT_VOLUME_EVALUATION_VERSION).all<D1Row>();
  await settleOpen(open.results ?? [], checkedAt);
  if (report.source.state === "HEALTHY") {
    for (const candidate of report.candidates) {
      for (const variant of variants(candidate)) await insertObservation(candidate, variant);
    }
  }
  return getHotVolumeEvaluationReport();
}

export async function getHotVolumeEvaluationReport(): Promise<HotVolumeEvaluationReport> {
  const result = await (await database()).prepare("SELECT * FROM hot_volume_observations WHERE evaluation_version = ? ORDER BY opened_at DESC LIMIT 2000")
    .bind(HOT_VOLUME_EVALUATION_VERSION).all<D1Row>();
  const rows = result.results ?? [];
  const rawRows = rows.filter((row) => String(row.variant) === "RAW");
  const hardenedRows = rows.filter((row) => String(row.variant) === "HARDENED");
  const cohortVariants = new Map<string, Set<string>>();
  for (const row of rows.filter((item) => String(item.status) !== "OPEN")) {
    const key = String(row.cohort_key);
    cohortVariants.set(key, new Set([...(cohortVariants.get(key) ?? []), String(row.variant)]));
  }
  const pairedKeys = new Set([...cohortVariants.entries()].filter(([, set]) => set.has("RAW") && set.has("HARDENED")).map(([key]) => key));
  const pairedRaw = slice("PAIRED RAW", rawRows.filter((row) => pairedKeys.has(String(row.cohort_key))));
  const pairedHardened = slice("PAIRED HARDENED", hardenedRows.filter((row) => pairedKeys.has(String(row.cohort_key))));
  const rawCohort = slice("RAW", rawRows);
  const hardenedCohort = slice("HARDENED", hardenedRows);
  const pairedResolved = Math.min(rawCohort.resolved, hardenedCohort.resolved);
  let verdict: HotVolumeEvaluationReport["verdict"] = "INSUFFICIENT DATA";
  let verdictReason = `${pairedResolved}/${HOT_VOLUME_EVALUATION_TARGET_PAIRED} paired RAW/HARDENED resolved.`;
  if (pairedResolved >= HOT_VOLUME_EVALUATION_TARGET_PAIRED) {
    const delta = hardenedCohort.expectancyR - rawCohort.expectancyR;
    if (hardenedCohort.expectancyR <= 0 || delta <= 0) {
      verdict = "REVERT";
      verdictReason = `Execution-eligible belum memiliki edge positif atas RAW: delta expectancy ${delta.toFixed(2)}R.`;
    } else if (delta >= 0.15 && (hardenedCohort.profitFactor ?? 99) >= 1.2 && hardenedCohort.maxDrawdownR <= 10) {
      verdict = "KEEP";
      verdictReason = `Execution-eligible unggul ${delta.toFixed(2)}R dengan expectancy, profit factor, dan drawdown memadai.`;
    } else {
      verdict = "OBSERVE";
      verdictReason = `Execution-eligible unggul ${delta.toFixed(2)}R, tetapi evidence gate KEEP belum lengkap.`;
    }
  }
  return {
    schemaVersion: HOT_VOLUME_EVALUATION_VERSION,
    mode: "SHADOW_READ_ONLY",
    verdict,
    verdictReason,
    targetPairedResolved: HOT_VOLUME_EVALUATION_TARGET_PAIRED,
    pairedResolved,
    raw: slice("RAW", rawRows),
    hardened: slice("HARDENED", hardenedRows),
    pairedRaw,
    pairedHardened,
    byDirection: byDirection(rows),
    methodology: {
      horizonHours: 24,
      targetR: 2,
      stopR: 1,
      settlement: "CLOSED_15M_HIGH_LOW_STOP_FIRST",
      entry: "SIGNAL_CLOSED_15M",
      comparison: "FORWARD_RAW_VS_EXECUTION_ELIGIBLE_COHORTS",
      promotion: "KEEP_REQUIRED_FOR_AUTO_PAPER",
    },
    generatedAt: new Date().toISOString(),
  };
}
