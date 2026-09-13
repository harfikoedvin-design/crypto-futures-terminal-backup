import { fetchBinanceJson, loadChartSeries, type ChartPoint } from "@/lib/market";

// HaxKai-style daily confirmation logged as a SHADOW-ONLY research cohort.
// It never opens paper trades, never changes scores, and never produces
// execution advice. Rule changes require a human-reviewed evidence gate.
export const HAXKAI_SHADOW_VERSION = "haxkai-shadow-v1" as const;
export const HAXKAI_MIN_RESOLVED = 30;
export const HAXKAI_VOLUME_MULTIPLE = 2;
export const HAXKAI_VOLUME_LOOKBACK_DAYS = 20;
export const HAXKAI_TARGET_R = 2;
export const HAXKAI_MAX_HORIZON_MS = 24 * 60 * 60 * 1000;
const MAX_SYMBOLS_PER_SYNC = 30;

export type HaxkaiDirection = "LONG" | "SHORT";

export type HaxkaiDailyCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

export type HaxkaiSignal = {
  symbol: string;
  baseAsset: string;
  direction: HaxkaiDirection;
  levelPrice: number;
  levelLabel: string;
  volumeRatio: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  targetR: number;
  sourceClosedAt: number;
  dateKey: string;
};

export type HaxkaiSlice = {
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

export type HaxkaiShadowReport = {
  schemaVersion: typeof HAXKAI_SHADOW_VERSION;
  mode: "SHADOW_ONLY";
  verdict: "INSUFFICIENT DATA" | "OBSERVE" | "KEEP" | "REVERT";
  verdictReason: string;
  minimumResolved: number;
  rules: {
    trigger: string;
    confirmation: string;
    entry: string;
    stop: string;
    target: string;
    settlement: string;
  };
  all: HaxkaiSlice;
  byDirection: HaxkaiSlice[];
  methodology: {
    settlement: "CLOSED_15M_HIGH_LOW_STOP_FIRST";
    horizonHours: 24;
    uniqueSymbols: number;
    periodStart: string | null;
    periodEnd: string | null;
  };
  generatedAt: string;
};

type HaxkaiStatement = {
  bind: (...values: unknown[]) => HaxkaiStatement;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};
type HaxkaiDatabase = { prepare: (query: string) => HaxkaiStatement };
type Row = Record<string, unknown>;

declare global {
  var __HAXKAI_D1_TEST_BINDING__: HaxkaiDatabase | undefined;
}

async function database(): Promise<HaxkaiDatabase> {
  if (globalThis.__HAXKAI_D1_TEST_BINDING__) return globalThis.__HAXKAI_D1_TEST_BINDING__;
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Haxkai shadow database is unavailable");
  return env.DB as HaxkaiDatabase;
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function utcDateKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseDailyKlines(rows: unknown): HaxkaiDailyCandle[] {
  if (!Array.isArray(rows)) return [];
  const now = Date.now();
  return rows
    .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 7)
    .map((row) => ({
      time: numeric(row[0]),
      open: numeric(row[1]),
      high: numeric(row[2]),
      low: numeric(row[3]),
      close: numeric(row[4]),
      volume: numeric(row[5]),
      closeTime: numeric(row[6]),
    }))
    // Drop the still-forming daily candle; signals use closed candles only.
    .filter((candle) => candle.closeTime > 0 && candle.closeTime <= now && candle.close > 0)
    .sort((a, b) => a.time - b.time);
}

export async function loadDailyCandles(symbol: string, limit = HAXKAI_VOLUME_LOOKBACK_DAYS + 5): Promise<HaxkaiDailyCandle[]> {
  const rows = await fetchBinanceJson<unknown[][]>(
    `/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=${Math.min(60, Math.max(10, limit))}`,
  );
  return parseDailyKlines(rows).slice(-(HAXKAI_VOLUME_LOOKBACK_DAYS + 2));
}

export function detectHaxkaiSignal(symbol: string, candles: HaxkaiDailyCandle[]): HaxkaiSignal | null {
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) return null;
  if (candles.length < HAXKAI_VOLUME_LOOKBACK_DAYS + 2) return null;
  const confirming = candles.at(-1)!;
  const reference = candles.at(-2)!;
  const baseline = candles.slice(-(HAXKAI_VOLUME_LOOKBACK_DAYS + 1), -1);
  const averageVolume = baseline.reduce((sum, candle) => sum + candle.volume, 0) / baseline.length;
  if (!(averageVolume > 0) || !(confirming.volume > 0)) return null;
  const volumeRatio = confirming.volume / averageVolume;
  if (volumeRatio < HAXKAI_VOLUME_MULTIPLE) return null;

  const long = confirming.close > reference.high;
  const short = confirming.close < reference.low;
  // A daily close cannot break the prior high and the prior low at once;
  // ambiguous closes produce no signal.
  if (long === short) return null;
  const direction: HaxkaiDirection = long ? "LONG" : "SHORT";
  const levelPrice = long ? reference.high : reference.low;
  const entryPrice = confirming.close;
  const stopLoss = long ? confirming.low : confirming.high;
  const risk = Math.abs(entryPrice - stopLoss);
  if (!(risk > 0)) return null;
  const takeProfit = long ? entryPrice + risk * HAXKAI_TARGET_R : entryPrice - risk * HAXKAI_TARGET_R;
  return {
    symbol,
    baseAsset: symbol.replace(/USDT$/, ""),
    direction,
    levelPrice,
    levelLabel: long ? "PRIOR-DAY HIGH" : "PRIOR-DAY LOW",
    volumeRatio,
    entryPrice,
    stopLoss,
    takeProfit,
    targetR: HAXKAI_TARGET_R,
    sourceClosedAt: confirming.closeTime,
    dateKey: utcDateKey(confirming.time),
  };
}

function signalKey(signal: Pick<HaxkaiSignal, "symbol" | "direction" | "dateKey">): string {
  return `${HAXKAI_SHADOW_VERSION}:${signal.symbol}:${signal.direction}:${signal.dateKey}`;
}

function slice(label: string, rows: Row[]): HaxkaiSlice {
  const resolvedRows = rows.filter((row) => String(row.status) !== "OPEN");
  const wins = resolvedRows.filter((row) => String(row.status) === "TP").length;
  const losses = resolvedRows.filter((row) => String(row.status) === "SL").length;
  const expired = resolvedRows.filter((row) => String(row.status) === "EXPIRED").length;
  const outcomes = resolvedRows.map((row) => numeric(row.outcome_r));
  const netR = outcomes.reduce((sum, value) => sum + value, 0);
  const grossProfit = outcomes.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(outcomes.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  let running = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const row of [...resolvedRows].sort((a, b) => String(a.closed_at ?? "").localeCompare(String(b.closed_at ?? "")))) {
    running += numeric(row.outcome_r);
    peak = Math.max(peak, running);
    maxDrawdownR = Math.max(maxDrawdownR, peak - running);
  }
  return {
    label,
    total: rows.length,
    open: rows.length - resolvedRows.length,
    resolved: resolvedRows.length,
    wins,
    losses,
    expired,
    winRate: wins + losses ? (wins / (wins + losses)) * 100 : 0,
    expectancyR: resolvedRows.length ? netR / resolvedRows.length : 0,
    netR,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    maxDrawdownR,
  };
}

async function settleOpen(rows: Row[], checkedAt: string): Promise<void> {
  const db = await database();
  const symbols = [...new Set(rows.map((row) => String(row.symbol)))];
  const seriesEntries = await Promise.all(symbols.map(async (symbol) => {
    try {
      return [symbol, await loadChartSeries(symbol, "15m")] as const;
    } catch {
      return [symbol, []] as const;
    }
  }));
  const seriesBySymbol = new Map<string, ChartPoint[]>(seriesEntries);
  for (const row of rows) {
    const series = seriesBySymbol.get(String(row.symbol)) ?? [];
    const openedAt = Date.parse(String(row.opened_at));
    const lastCheckedAt = Date.parse(String(row.last_checked_at));
    const horizonAt = openedAt + HAXKAI_MAX_HORIZON_MS;
    const upperBound = Math.min(Date.parse(checkedAt), horizonAt);
    const candles = series.filter((point) => point.time > Math.max(openedAt, lastCheckedAt) && point.time <= upperBound);
    if (!candles.length) continue;
    const entry = numeric(row.entry_price);
    const stop = numeric(row.stop_loss);
    const target = numeric(row.take_profit);
    const long = String(row.direction) === "LONG";
    let status: "OPEN" | "SL" | "TP" | "EXPIRED" = "OPEN";
    let exitPrice = candles.at(-1)!.close;
    let closedAt = checkedAt;
    let high = numeric(row.observed_high);
    let low = numeric(row.observed_low);
    for (const candle of candles) {
      high = Math.max(high, candle.high);
      low = Math.min(low, candle.low);
      const stopHit = long ? candle.low <= stop : candle.high >= stop;
      const targetHit = long ? candle.high >= target : candle.low <= target;
      // Conservative: the stop wins when both levels print in one closed candle.
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
    const horizonReached = Date.parse(checkedAt) - openedAt >= HAXKAI_MAX_HORIZON_MS;
    if (status === "OPEN" && !horizonReached) {
      await db.prepare("UPDATE haxkai_shadow_observations SET last_checked_at = ?, observed_high = ?, observed_low = ? WHERE id = ? AND status = 'OPEN'")
        .bind(new Date(candles.at(-1)!.time).toISOString(), high, low, String(row.id)).run();
      continue;
    }
    if (status === "OPEN") {
      status = "EXPIRED";
      closedAt = new Date(candles.at(-1)!.time).toISOString();
    }
    const risk = Math.abs(entry - stop);
    const directionalMove = (exitPrice - entry) * (long ? 1 : -1);
    const rawR = risk > 0 ? directionalMove / risk : 0;
    const outcomeR = status === "SL" ? -1 : status === "TP" ? numeric(row.target_r) || HAXKAI_TARGET_R : Math.max(-1, Math.min(numeric(row.target_r) || HAXKAI_TARGET_R, rawR));
    await db.prepare("UPDATE haxkai_shadow_observations SET status = ?, outcome_r = ?, exit_price = ?, closed_at = ?, last_checked_at = ?, observed_high = ?, observed_low = ? WHERE id = ? AND status = 'OPEN'")
      .bind(status, outcomeR, exitPrice, closedAt, closedAt, high, low, String(row.id)).run();
  }
}

function validSymbol(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{2,20}USDT$/.test(value);
}

export async function syncHaxkaiShadow(rawSymbols: unknown, generatedAt: string): Promise<HaxkaiShadowReport> {
  const symbols = (Array.isArray(rawSymbols) ? rawSymbols : []).filter(validSymbol).slice(0, MAX_SYMBOLS_PER_SYNC);
  const checkedAt = Number.isFinite(Date.parse(generatedAt)) ? new Date(generatedAt).toISOString() : new Date().toISOString();
  const db = await database();
  const open = await db.prepare("SELECT * FROM haxkai_shadow_observations WHERE status = 'OPEN' ORDER BY opened_at ASC").all<Row>();
  await settleOpen(open.results ?? [], checkedAt);

  if (symbols.length) {
    const dayStart = Date.parse(`${utcDateKey(Date.parse(checkedAt))}T00:00:00.000Z`);
    const recorded = await db.prepare("SELECT symbol FROM haxkai_shadow_observations WHERE source_closed_at >= ?").bind(dayStart).all<{ symbol: string }>();
    const recordedToday = new Set((recorded.results ?? []).map((row) => String(row.symbol)));
    for (const symbol of symbols) {
      if (recordedToday.has(symbol)) continue;
      try {
        const signal = detectHaxkaiSignal(symbol, await loadDailyCandles(symbol));
        if (!signal) continue;
        const evidence = {
          schemaVersion: HAXKAI_SHADOW_VERSION,
          symbol: signal.symbol,
          direction: signal.direction,
          dateKey: signal.dateKey,
          level: { label: signal.levelLabel, price: signal.levelPrice },
          plan: { entry: signal.entryPrice, stop: signal.stopLoss, target: signal.takeProfit, targetR: signal.targetR },
          volumeRatio: signal.volumeRatio,
          sourceClosedAt: signal.sourceClosedAt,
        };
        const evidenceHash = await sha256Hex(JSON.stringify(evidence));
        await db.prepare(
          `INSERT OR IGNORE INTO haxkai_shadow_observations (
            id, signal_key, symbol, base_asset, direction, level_price, level_label, volume_ratio,
            entry_price, stop_loss, take_profit, target_r, status,
            opened_at, last_checked_at, observed_high, observed_low, source_closed_at,
            evidence_hash, evidence_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), signalKey(signal), signal.symbol, signal.baseAsset, signal.direction,
          signal.levelPrice, signal.levelLabel, signal.volumeRatio, signal.entryPrice, signal.stopLoss,
          signal.takeProfit, signal.targetR, checkedAt, checkedAt,
          signal.entryPrice, signal.entryPrice, signal.sourceClosedAt, evidenceHash, JSON.stringify(evidence),
        ).run();
      } catch {
        // One bad symbol never blocks the cohort; the lane stays fail-closed.
      }
    }
  }
  return getHaxkaiShadowReport();
}

export async function getHaxkaiShadowReport(): Promise<HaxkaiShadowReport> {
  const db = await database();
  const result = await db.prepare("SELECT * FROM haxkai_shadow_observations ORDER BY opened_at DESC LIMIT 2000").all<Row>();
  const rows = result.results ?? [];
  const all = slice("ALL", rows);
  const byDirection = ["LONG", "SHORT"]
    .map((direction) => slice(direction, rows.filter((row) => String(row.direction) === direction)))
    .sort((a, b) => b.total - a.total);
  let verdict: HaxkaiShadowReport["verdict"] = "INSUFFICIENT DATA";
  let verdictReason = `${all.resolved}/${HAXKAI_MIN_RESOLVED} resolved. Cohort shadow-only; tidak membuka paper.`;
  if (all.resolved >= HAXKAI_MIN_RESOLVED) {
    if (all.expectancyR > 0 && (all.profitFactor ?? 99) >= 1.2) {
      verdict = "KEEP";
      verdictReason = `Expectancy ${all.expectancyR.toFixed(2)}R dengan profit factor memadai — layak review manusia, bukan aktivasi otomatis.`;
    } else if (all.expectancyR > 0) {
      verdict = "OBSERVE";
      verdictReason = `Expectancy ${all.expectancyR.toFixed(2)}R positif tetapi belum melewati gate KEEP.`;
    } else {
      verdict = "REVERT";
      verdictReason = `Expectancy ${all.expectancyR.toFixed(2)}R tidak mendukung hipotesis daily-confirmation.`;
    }
  }
  return {
    schemaVersion: HAXKAI_SHADOW_VERSION,
    mode: "SHADOW_ONLY",
    verdict,
    verdictReason,
    minimumResolved: HAXKAI_MIN_RESOLVED,
    rules: {
      trigger: "Daily close menembus prior-day high/low",
      confirmation: `Volume harian ≥${HAXKAI_VOLUME_MULTIPLE}x rata-rata ${HAXKAI_VOLUME_LOOKBACK_DAYS} hari`,
      entry: "Close candle harian pemicu (aproksimasi shadow)",
      stop: "Ekstrem candle harian pemicu (low LONG / high SHORT)",
      target: `${HAXKAI_TARGET_R}R tetap untuk riset (bukan rule paper 3.2R)`,
      settlement: "Closed 15m, stop-first konservatif, horizon 24 jam",
    },
    all,
    byDirection,
    methodology: {
      settlement: "CLOSED_15M_HIGH_LOW_STOP_FIRST",
      horizonHours: 24,
      uniqueSymbols: new Set(rows.map((row) => String(row.symbol))).size,
      periodStart: rows.length ? String(rows.reduce((minimum, row) => String(row.opened_at) < minimum ? String(row.opened_at) : minimum, String(rows[0].opened_at))) : null,
      periodEnd: rows.length ? String(rows.reduce((maximum, row) => String(row.opened_at) > maximum ? String(row.opened_at) : maximum, String(rows[0].opened_at))) : null,
    },
    generatedAt: new Date().toISOString(),
  };
}
