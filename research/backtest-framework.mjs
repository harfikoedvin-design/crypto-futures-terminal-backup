import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const API = "https://www.binance.com";
const INTERVAL_MS = 15 * 60_000;
const DEFAULT_DAYS = 150;
const DEFAULT_PAIRS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "SUIUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "TRUMPUSDT",
  "PUMPUSDT",
];

const args = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, value = "true"] = argument.replace(/^--/, "").split("=");
    return [key, value];
  }),
);
const days = Number(args.get("days") ?? DEFAULT_DAYS);
const pairs = (args.get("pairs") ?? DEFAULT_PAIRS.join(","))
  .split(",")
  .map((item) => item.trim().toUpperCase())
  .filter((item) => /^[A-Z0-9]{2,20}USDT$/.test(item));
const tag = (args.get("tag") ?? "framework-backtest").replace(/[^a-z0-9_-]/gi, "-");
const config = {
  rewardRisk: finite(args.get("rr"), 3),
  horizon: finite(args.get("horizon"), 96),
  breakoutVolume: finite(args.get("breakout-volume"), 1.3),
  breakoutAdx: finite(args.get("breakout-adx"), 18),
  breakoutMaximumPenetration: finite(args.get("breakout-max-penetration"), 0.8),
  breakoutStrictTrend: args.get("breakout-strict-trend") === "true",
  retestHolds: finite(args.get("retest-holds"), 2),
  retestVolumeCap: finite(args.get("retest-volume-cap"), 1.5),
  sweepVolume: finite(args.get("sweep-volume"), 1.1),
  sweepStrictTrend: args.get("sweep-strict-trend") === "true",
  sweepMomentum: args.get("sweep-momentum") === "true",
  benchmarkAlignment: args.get("benchmark-alignment") === "true",
  breakevenAtR: finite(args.get("breakeven-at"), 0),
  activeUtcStart: args.has("active-utc-start") ? finite(args.get("active-utc-start"), 0) : null,
  activeUtcEnd: args.has("active-utc-end") ? finite(args.get("active-utc-end"), 24) : null,
};
const outputDirectory = join(process.cwd(), "research", "results");
const cacheDirectory = join("/tmp", "crypto-futures-framework-backtest");

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values, quantile) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * quantile)));
  return sorted[index];
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function format(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "framework-backtest/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

async function loadKlines(symbol, startTime, endTime) {
  await mkdir(cacheDirectory, { recursive: true });
  const cachePath = join(cacheDirectory, `${symbol}-${startTime}-${endTime}.json`);
  if (existsSync(cachePath)) return JSON.parse(await readFile(cachePath, "utf8"));

  const output = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const url = new URL("/fapi/v1/klines", API);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "15m");
    url.searchParams.set("limit", "1500");
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endTime));
    const rows = await fetchJson(url);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 7) continue;
      output.push({
        openTime: finite(row[0]),
        open: finite(row[1]),
        high: finite(row[2]),
        low: finite(row[3]),
        close: finite(row[4]),
        volume: finite(row[5]),
        closeTime: finite(row[6]),
        quoteVolume: finite(row[7]),
      });
    }
    const nextCursor = finite(rows.at(-1)?.[6]) + 1;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
    if (rows.length < 1500) break;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  const deduped = [...new Map(output.map((item) => [item.openTime, item])).values()]
    .filter((item) => item.closeTime <= endTime && item.close > 0)
    .sort((a, b) => a.openTime - b.openTime);
  await writeFile(cachePath, JSON.stringify(deduped));
  return deduped;
}

function aggregate(candles, bucketMs) {
  const buckets = new Map();
  const expected = bucketMs / INTERVAL_MS;
  for (const candle of candles) {
    const key = Math.floor(candle.openTime / bucketMs) * bucketMs;
    const group = buckets.get(key) ?? [];
    group.push(candle);
    buckets.set(key, group);
  }
  return [...buckets.entries()]
    .filter(([, group]) => group.length === expected)
    .sort(([a], [b]) => a - b)
    .map(([openTime, group]) => ({
      openTime,
      open: group[0].open,
      high: Math.max(...group.map((item) => item.high)),
      low: Math.min(...group.map((item) => item.low)),
      close: group.at(-1).close,
      volume: group.reduce((sum, item) => sum + item.volume, 0),
      quoteVolume: group.reduce((sum, item) => sum + item.quoteVolume, 0),
      closeTime: group.at(-1).closeTime,
    }));
}

function ema(values, period) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  const output = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    output.push(values[index] * multiplier + output[index - 1] * (1 - multiplier));
  }
  return output;
}

function wilder(values, period) {
  const output = new Array(values.length).fill(Number.NaN);
  if (values.length < period) return output;
  let seed = 0;
  for (let index = 0; index < period; index += 1) seed += values[index];
  output[period - 1] = seed / period;
  for (let index = period; index < values.length; index += 1) {
    output[index] = (output[index - 1] * (period - 1) + values[index]) / period;
  }
  return output;
}

function indicatorSeries(candles) {
  const closes = candles.map((item) => item.close);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macdLine = closes.map((_, index) => fast[index] - slow[index]);
  const macdSignal = ema(macdLine, 9);
  const macd = macdLine.map((value, index) => value - macdSignal[index]);

  const gains = [0];
  const losses = [0];
  const trueRanges = [];
  const plusDm = [0];
  const minusDm = [0];
  for (let index = 0; index < candles.length; index += 1) {
    if (index === 0) {
      trueRanges.push(candles[index].high - candles[index].low);
      continue;
    }
    const change = closes[index] - closes[index - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
    trueRanges.push(
      Math.max(
        candles[index].high - candles[index].low,
        Math.abs(candles[index].high - candles[index - 1].close),
        Math.abs(candles[index].low - candles[index - 1].close),
      ),
    );
    const up = candles[index].high - candles[index - 1].high;
    const down = candles[index - 1].low - candles[index].low;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }
  const averageGain = wilder(gains, 14);
  const averageLoss = wilder(losses, 14);
  const rsi = closes.map((_, index) => {
    if (!Number.isFinite(averageGain[index]) || !Number.isFinite(averageLoss[index])) return Number.NaN;
    if (averageLoss[index] === 0) return averageGain[index] > 0 ? 100 : 50;
    return 100 - 100 / (1 + averageGain[index] / averageLoss[index]);
  });
  const atr = wilder(trueRanges, 14);
  const smoothPlus = wilder(plusDm, 14);
  const smoothMinus = wilder(minusDm, 14);
  const dx = closes.map((_, index) => {
    if (!Number.isFinite(atr[index]) || atr[index] <= 0) return Number.NaN;
    const plus = (100 * smoothPlus[index]) / atr[index];
    const minus = (100 * smoothMinus[index]) / atr[index];
    return plus + minus === 0 ? 0 : (100 * Math.abs(plus - minus)) / (plus + minus);
  });
  const adx = wilder(dx.map((value) => (Number.isFinite(value) ? value : 0)), 14);
  const relativeVolume = candles.map((item, index) => {
    if (index < 20) return Number.NaN;
    const average = mean(candles.slice(index - 20, index).map((entry) => entry.volume));
    return average > 0 ? item.volume / average : 0;
  });

  let day = "";
  let cumulativeVolume = 0;
  let cumulativeValue = 0;
  const vwap = candles.map((item) => {
    const key = new Date(item.openTime).toISOString().slice(0, 10);
    if (key !== day) {
      day = key;
      cumulativeVolume = 0;
      cumulativeValue = 0;
    }
    const typical = (item.high + item.low + item.close) / 3;
    cumulativeVolume += item.volume;
    cumulativeValue += typical * item.volume;
    return cumulativeVolume > 0 ? cumulativeValue / cumulativeVolume : item.close;
  });

  return candles.map((item, index) => ({
    ...item,
    ema9: ema9[index],
    ema21: ema21[index],
    ema50: ema50[index],
    ema200: ema200[index],
    macd: macd[index],
    rsi: rsi[index],
    atr: atr[index],
    adx: adx[index],
    relativeVolume: relativeVolume[index],
    vwap: vwap[index],
  }));
}

function strictTrend(item) {
  if (!item) return "MIXED";
  if (item.ema9 > item.ema21 && item.ema21 > item.ema50 && item.ema50 > item.ema200) return "BULLISH";
  if (item.ema9 < item.ema21 && item.ema21 < item.ema50 && item.ema50 < item.ema200) return "BEARISH";
  return "MIXED";
}

function minimumTrend(item) {
  if (!item) return "MIXED";
  if (item.ema21 > item.ema50 && item.ema50 > item.ema200) return "BULLISH";
  if (item.ema21 < item.ema50 && item.ema50 < item.ema200) return "BEARISH";
  return "MIXED";
}

function latestIndexAt(series, time, pointer) {
  let index = pointer;
  while (index + 1 < series.length && series[index + 1].closeTime <= time) index += 1;
  return index;
}

function confirmedSwings(candles, lows) {
  const points = [];
  const window = 3;
  for (let index = window; index < candles.length - window; index += 1) {
    const segment = candles.slice(index - window, index + window + 1);
    const value = lows ? candles[index].low : candles[index].high;
    const boundary = lows
      ? Math.min(...segment.map((item) => item.low))
      : Math.max(...segment.map((item) => item.high));
    if (value === boundary) points.push({ index, value });
  }
  return points;
}

function marketStructure(series, index) {
  const reference = series.slice(Math.max(0, index - 98), Math.max(0, index - 2));
  if (reference.length < 30) return null;
  const lows = confirmedSwings(reference, true).slice(-3);
  const highs = confirmedSwings(reference, false).slice(-3);
  const support = lows.at(-1)?.value ?? Math.min(...reference.slice(-48).map((item) => item.low));
  const resistance = highs.at(-1)?.value ?? Math.max(...reference.slice(-48).map((item) => item.high));
  const last = series[index].close;
  const breakout = last > resistance ? "UP" : last < support ? "DOWN" : "NONE";
  const trend =
    lows.length >= 2 && highs.length >= 2
      ? lows.at(-1).value > lows.at(-2).value && highs.at(-1).value > highs.at(-2).value
        ? "BULLISH"
        : lows.at(-1).value < lows.at(-2).value && highs.at(-1).value < highs.at(-2).value
          ? "BEARISH"
          : "RANGE"
      : "RANGE";
  return { support, resistance, breakout, trend };
}

function rollingBoundary(series, index, window, high) {
  const slice = series.slice(Math.max(0, index - window), index);
  if (!slice.length) return Number.NaN;
  return high
    ? Math.max(...slice.map((item) => item.high))
    : Math.min(...slice.map((item) => item.low));
}

function previousDayLevels(base, index) {
  const currentDay = new Date(base[index].openTime).toISOString().slice(0, 10);
  let cursor = index - 1;
  const previous = [];
  let previousDay = null;
  while (cursor >= 0) {
    const day = new Date(base[cursor].openTime).toISOString().slice(0, 10);
    if (day === currentDay) {
      cursor -= 1;
      continue;
    }
    previousDay ??= day;
    if (day !== previousDay) break;
    previous.push(base[cursor]);
    cursor -= 1;
  }
  if (!previous.length) return null;
  return {
    high: Math.max(...previous.map((item) => item.high)),
    low: Math.min(...previous.map((item) => item.low)),
  };
}

function currentCoreSignal(context) {
  const { higher, primary, confirmation, structure, primarySeries, primaryIndex } = context;
  const higherTrend = strictTrend(higher);
  const primaryTrend = strictTrend(primary);
  const conflict =
    (higherTrend === "BULLISH" && primaryTrend === "BEARISH") ||
    (higherTrend === "BEARISH" && primaryTrend === "BULLISH");
  let direction = null;
  if (!conflict && higherTrend === "BULLISH" && primary.close >= primary.ema21 && primary.macd > 0 && primary.rsi >= 48) {
    direction = "LONG";
  } else if (!conflict && higherTrend === "BEARISH" && primary.close <= primary.ema21 && primary.macd < 0 && primary.rsi <= 52) {
    direction = "SHORT";
  }
  if (!direction) return null;
  const long = direction === "LONG";
  const confirmationAligned = long
    ? confirmation.macd > 0 && confirmation.close >= confirmation.ema21 && confirmation.rsi >= 48
    : confirmation.macd < 0 && confirmation.close <= confirmation.ema21 && confirmation.rsi <= 52;
  if (!confirmationAligned || primary.adx < 20 || primary.relativeVolume < 0.9) return null;

  let score = 0;
  score += 25;
  score += 8;
  if ((long && primary.rsi >= 50 && primary.rsi < 70) || (!long && primary.rsi > 30 && primary.rsi <= 50)) score += 6;
  score += 6;
  if ((long && structure.trend === "BULLISH") || (!long && structure.trend === "BEARISH")) score += 12;
  else if (structure.trend === "RANGE") score += 5;
  score += structure.breakout === (long ? "UP" : "DOWN") ? 8 : 4;
  score += 9;
  const atrMedian = median(primarySeries.slice(Math.max(0, primaryIndex - 19), primaryIndex + 1).map((item) => item.atr));
  score += primary.atr > atrMedian ? 6 : 3;
  // Mirrors the common neutral live state: taker fallback +1, non-negative OI +4,
  // neutral funding +4, and the current unconditional +5.
  score += 1 + 4 + 4 + 5;
  if (score < 75) return null;

  const atr = primary.atr;
  const price = confirmation.close;
  const structuralDistance = long ? (price - structure.support) / atr : (structure.resistance - price) / atr;
  const emaDistance = long ? (price - primary.ema21) / atr : (primary.ema21 - price) / atr;
  const vwapDistance = long ? (price - primary.vwap) / atr : (primary.vwap - price) / atr;
  const actionable =
    (structuralDistance >= 0 && structuralDistance <= 1.25) ||
    (emaDistance >= 0 && emaDistance <= 1.25) ||
    (vwapDistance >= 0 && vwapDistance <= 1.25) ||
    structure.breakout === (long ? "UP" : "DOWN");
  const extension = Math.abs(price - primary.ema21) / atr;
  if (!actionable || extension > 2.5) return null;

  const stopReference = long ? structure.support - atr * 0.25 : structure.resistance + atr * 0.25;
  return {
    strategy: "CURRENT_CORE",
    direction,
    score,
    stopReference,
    reason: structure.breakout === (long ? "UP" : "DOWN") ? "generic breakout label" : "generic trend pullback",
  };
}

function breakoutSignal(context) {
  const { higher, primary, confirmation, primarySeries, primaryIndex } = context;
  const higherTrend = config.breakoutStrictTrend ? strictTrend(higher) : minimumTrend(higher);
  const primaryTrend = minimumTrend(primary);
  const high = rollingBoundary(primarySeries, primaryIndex, 20, true);
  const low = rollingBoundary(primarySeries, primaryIndex, 20, false);
  if (!Number.isFinite(high) || !Number.isFinite(low) || primary.atr <= 0) return null;
  let direction = null;
  let level = null;
  if (higherTrend === "BULLISH" && primaryTrend === "BULLISH" && primary.close > high) {
    direction = "LONG";
    level = high;
  } else if (higherTrend === "BEARISH" && primaryTrend === "BEARISH" && primary.close < low) {
    direction = "SHORT";
    level = low;
  }
  if (!direction) return null;
  if (config.benchmarkAlignment && !context.benchmarkAligned?.[direction]) return null;
  const long = direction === "LONG";
  const penetration = Math.abs(primary.close - level) / primary.atr;
  const candleRange = (primary.high - primary.low) / primary.atr;
  const confirmationAligned = long
    ? confirmation.macd > 0 && confirmation.close >= confirmation.ema21 && confirmation.rsi >= 50
    : confirmation.macd < 0 && confirmation.close <= confirmation.ema21 && confirmation.rsi <= 50;
  if (
    penetration < 0.05 ||
    penetration > config.breakoutMaximumPenetration ||
    candleRange > 2 ||
    primary.relativeVolume < config.breakoutVolume ||
    primary.adx < config.breakoutAdx ||
    !confirmationAligned
  ) return null;

  const score =
    25 +
    (strictTrend(higher) === higherTrend ? 15 : 10) +
    (primary.relativeVolume >= 1.8 ? 15 : 10) +
    15 +
    (penetration <= 0.5 ? 10 : 6) +
    5;
  return {
    strategy: "BREAKOUT_CONTINUATION",
    direction,
    score,
    level,
    stopReference: long ? level - primary.atr * 0.35 : level + primary.atr * 0.35,
    reason: `1H close beyond 20-bar level; volume ${format(primary.relativeVolume)}x`,
  };
}

function sweepEvent(context) {
  const { base, baseIndex, confirmation, higher } = context;
  const levels = previousDayLevels(base, baseIndex);
  if (!levels || !Number.isFinite(confirmation.atr) || confirmation.atr <= 0) return null;
  const body = Math.max(Math.abs(confirmation.close - confirmation.open), confirmation.atr * 0.03);
  const lowerWick = Math.min(confirmation.open, confirmation.close) - confirmation.low;
  const upperWick = confirmation.high - Math.max(confirmation.open, confirmation.close);
  const range = Math.max(confirmation.high - confirmation.low, confirmation.atr * 0.05);
  const higherTrend = strictTrend(higher);
  if (
    confirmation.low < levels.low - confirmation.atr * 0.05 &&
    confirmation.close > levels.low &&
    lowerWick >= body * 1.2 &&
    (confirmation.close - confirmation.low) / range >= 0.6 &&
    confirmation.relativeVolume >= config.sweepVolume &&
    (config.sweepStrictTrend ? higherTrend === "BULLISH" : higherTrend !== "BEARISH")
  ) {
    if (config.benchmarkAlignment && !context.benchmarkAligned?.LONG) return null;
    return {
      direction: "LONG",
      level: levels.low,
      extreme: confirmation.low,
      trigger: confirmation.high,
      expiresAt: baseIndex + 4,
      volume: confirmation.relativeVolume,
    };
  }
  if (
    confirmation.high > levels.high + confirmation.atr * 0.05 &&
    confirmation.close < levels.high &&
    upperWick >= body * 1.2 &&
    (confirmation.high - confirmation.close) / range >= 0.6 &&
    confirmation.relativeVolume >= config.sweepVolume &&
    (config.sweepStrictTrend ? higherTrend === "BEARISH" : higherTrend !== "BULLISH")
  ) {
    if (config.benchmarkAlignment && !context.benchmarkAligned?.SHORT) return null;
    return {
      direction: "SHORT",
      level: levels.high,
      extreme: confirmation.high,
      trigger: confirmation.low,
      expiresAt: baseIndex + 4,
      volume: confirmation.relativeVolume,
    };
  }
  return null;
}

function evaluateTrade(base, signalIndex, signal) {
  const entryIndex = signalIndex + 1;
  if (entryIndex >= base.length) return null;
  const entry = base[entryIndex].open;
  const atr = base[signalIndex].atr;
  if (!Number.isFinite(atr) || atr <= 0) return null;
  const long = signal.direction === "LONG";
  let stop = signal.stopReference;
  if (!Number.isFinite(stop)) stop = long ? entry - atr : entry + atr;
  if (long && stop >= entry) stop = entry - atr;
  if (!long && stop <= entry) stop = entry + atr;
  let risk = Math.abs(entry - stop);
  if (risk < atr * 0.65) {
    stop = long ? entry - atr * 0.65 : entry + atr * 0.65;
    risk = atr * 0.65;
  }
  if (risk > atr * 2.5) return null;
  const target = long ? entry + risk * config.rewardRisk : entry - risk * config.rewardRisk;
  const feeR = (entry * 0.001) / risk;
  let mfe = 0;
  let mae = 0;
  let exitIndex = Math.min(base.length - 1, entryIndex + config.horizon);
  let outcome = "TIMEOUT";
  let grossR = 0;
  let breakevenArmed = false;
  for (let index = entryIndex; index <= exitIndex; index += 1) {
    const candle = base[index];
    const favorable = long ? candle.high - entry : entry - candle.low;
    const adverse = long ? entry - candle.low : candle.high - entry;
    mfe = Math.max(mfe, favorable / risk);
    mae = Math.max(mae, adverse / risk);
    const activeStop = breakevenArmed ? entry : stop;
    const stopHit = long ? candle.low <= activeStop : candle.high >= activeStop;
    const targetHit = long ? candle.high >= target : candle.low <= target;
    // Conservative ordering when both levels print inside the same candle.
    if (stopHit) {
      outcome = "LOSS";
      grossR = breakevenArmed ? 0 : -1;
      exitIndex = index;
      break;
    }
    if (targetHit) {
      outcome = "WIN";
      grossR = config.rewardRisk;
      exitIndex = index;
      break;
    }
    if (config.breakevenAtR > 0 && favorable / risk >= config.breakevenAtR) breakevenArmed = true;
  }
  if (outcome === "TIMEOUT") {
    const last = base[exitIndex].close;
    grossR = clamp((long ? last - entry : entry - last) / risk, -1, config.rewardRisk);
  }
  return {
    entryIndex,
    exitIndex,
    entry,
    stop,
    target,
    risk,
    outcome,
    grossR,
    netR: grossR - feeR,
    feeR,
    mfe,
    mae,
  };
}

function registerSignal(trades, blocked, symbol, base, index, signal, evaluationStart) {
  if (!signal || base[index].closeTime < evaluationStart) return;
  if (signal.strategy !== "CURRENT_CORE" && config.activeUtcStart !== null && config.activeUtcEnd !== null) {
    const hour = new Date(base[index].closeTime).getUTCHours();
    const active = config.activeUtcStart <= config.activeUtcEnd
      ? hour >= config.activeUtcStart && hour < config.activeUtcEnd
      : hour >= config.activeUtcStart || hour < config.activeUtcEnd;
    if (!active) return;
  }
  const key = signal.strategy;
  if ((blocked.get(key) ?? -1) >= index) return;
  const trade = evaluateTrade(base, index, signal);
  if (!trade) return;
  blocked.set(key, trade.exitIndex + 4);
  trades.push({
    symbol,
    strategy: signal.strategy,
    direction: signal.direction,
    score: signal.score,
    signalAt: new Date(base[index].closeTime).toISOString(),
    reason: signal.reason,
    ...trade,
  });
}

function runSymbol(symbol, rawBase, evaluationStart, benchmarkRawBase) {
  const base = indicatorSeries(rawBase);
  const primarySeries = indicatorSeries(aggregate(rawBase, 60 * 60_000));
  const higherSeries = indicatorSeries(aggregate(rawBase, 4 * 60 * 60_000));
  const benchmarkPrimarySeries = config.benchmarkAlignment
    ? indicatorSeries(aggregate(benchmarkRawBase, 60 * 60_000))
    : [];
  const benchmarkHigherSeries = config.benchmarkAlignment
    ? indicatorSeries(aggregate(benchmarkRawBase, 4 * 60 * 60_000))
    : [];
  const trades = [];
  const blocked = new Map();
  let primaryPointer = -1;
  let higherPointer = -1;
  let benchmarkPrimaryPointer = -1;
  let benchmarkHigherPointer = -1;
  let lastBreakoutPrimaryIndex = -1;
  let retest = null;
  let sweep = null;

  for (let baseIndex = 0; baseIndex < base.length - 2; baseIndex += 1) {
    const time = base[baseIndex].closeTime;
    primaryPointer = latestIndexAt(primarySeries, time, primaryPointer);
    higherPointer = latestIndexAt(higherSeries, time, higherPointer);
    if (config.benchmarkAlignment) {
      benchmarkPrimaryPointer = latestIndexAt(benchmarkPrimarySeries, time, benchmarkPrimaryPointer);
      benchmarkHigherPointer = latestIndexAt(benchmarkHigherSeries, time, benchmarkHigherPointer);
    }
    if (primaryPointer < 205 || higherPointer < 205 || baseIndex < 205) continue;
    const primary = primarySeries[primaryPointer];
    const higher = higherSeries[higherPointer];
    const confirmation = base[baseIndex];
    const structure = marketStructure(primarySeries, primaryPointer);
    if (!structure) continue;
    const benchmarkPrimary = config.benchmarkAlignment ? benchmarkPrimarySeries[benchmarkPrimaryPointer] : null;
    const benchmarkHigher = config.benchmarkAlignment ? benchmarkHigherSeries[benchmarkHigherPointer] : null;
    const benchmarkHigherTrend = minimumTrend(benchmarkHigher);
    const benchmarkAligned = {
      LONG: !config.benchmarkAlignment || (
        benchmarkHigherTrend === "BULLISH" && benchmarkPrimary?.close >= benchmarkPrimary?.ema21
      ),
      SHORT: !config.benchmarkAlignment || (
        benchmarkHigherTrend === "BEARISH" && benchmarkPrimary?.close <= benchmarkPrimary?.ema21
      ),
    };
    const context = {
      base,
      baseIndex,
      higher,
      higherIndex: higherPointer,
      primary,
      primaryIndex: primaryPointer,
      confirmation,
      primarySeries,
      structure,
      benchmarkAligned,
    };

    registerSignal(trades, blocked, symbol, base, baseIndex, currentCoreSignal(context), evaluationStart);

    if (primaryPointer !== lastBreakoutPrimaryIndex) {
      lastBreakoutPrimaryIndex = primaryPointer;
      const breakout = breakoutSignal(context);
      registerSignal(trades, blocked, symbol, base, baseIndex, breakout, evaluationStart);
      if (breakout) {
        retest = {
          ...breakout,
          strategy: "RETEST_CONTINUATION",
          breakoutAt: baseIndex,
          expiresAt: baseIndex + 32,
          touched: false,
          holds: 0,
          breakoutVolume: primary.relativeVolume,
        };
      }
    }

    if (retest) {
      if (baseIndex > retest.expiresAt) {
        retest = null;
      } else if (baseIndex > retest.breakoutAt) {
        const long = retest.direction === "LONG";
        const atr = primary.atr;
        const touches = long
          ? confirmation.low <= retest.level + atr * 0.25
          : confirmation.high >= retest.level - atr * 0.25;
        const invalid = long
          ? confirmation.close < retest.level - atr * 0.35
          : confirmation.close > retest.level + atr * 0.35;
        if (invalid) {
          retest = null;
        } else {
          if (touches) retest.touched = true;
          const holds = long ? confirmation.close >= retest.level : confirmation.close <= retest.level;
          retest.holds = retest.touched && holds ? retest.holds + 1 : 0;
          const body = Math.max(Math.abs(confirmation.close - confirmation.open), atr * 0.02);
          const rejection = long
            ? confirmation.close > confirmation.open && Math.min(confirmation.open, confirmation.close) - confirmation.low >= body * 0.5
            : confirmation.close < confirmation.open && confirmation.high - Math.max(confirmation.open, confirmation.close) >= body * 0.5;
          const momentum = long
            ? confirmation.macd > 0 && confirmation.rsi >= 48
            : confirmation.macd < 0 && confirmation.rsi <= 52;
          if (retest.holds >= config.retestHolds && rejection && momentum && confirmation.relativeVolume <= config.retestVolumeCap) {
            const score =
              25 +
              (strictTrend(higher) === (long ? "BULLISH" : "BEARISH") ? 15 : 10) +
              15 +
              15 +
              (confirmation.relativeVolume < retest.breakoutVolume ? 10 : 6) +
              5;
            registerSignal(
              trades,
              blocked,
              symbol,
              base,
              baseIndex,
              {
                strategy: "RETEST_CONTINUATION",
                direction: retest.direction,
                score,
                stopReference: long
                  ? Math.min(confirmation.low - atr * 0.1, retest.level - atr * 0.35)
                  : Math.max(confirmation.high + atr * 0.1, retest.level + atr * 0.35),
                reason: "stored breakout; retest touch; two closes hold; rejection confirmed",
              },
              evaluationStart,
            );
            retest = null;
          }
        }
      }
    }

    const foundSweep = sweepEvent(context);
    if (foundSweep) sweep = { ...foundSweep, createdAt: baseIndex };
    if (sweep) {
      if (baseIndex > sweep.expiresAt) {
        sweep = null;
      } else if (baseIndex > sweep.createdAt) {
        const confirmed = sweep.direction === "LONG"
          ? confirmation.close > sweep.trigger
          : confirmation.close < sweep.trigger;
        const momentum = sweep.direction === "LONG"
          ? confirmation.macd > 0 && confirmation.rsi >= 50 && confirmation.close >= confirmation.ema21
          : confirmation.macd < 0 && confirmation.rsi <= 50 && confirmation.close <= confirmation.ema21;
        if (confirmed && (!config.sweepMomentum || momentum)) {
          const long = sweep.direction === "LONG";
          registerSignal(
            trades,
            blocked,
            symbol,
            base,
            baseIndex,
            {
              strategy: "LIQUIDITY_SWEEP_REVERSAL",
              direction: sweep.direction,
              score: 25 + 15 + 15 + (sweep.volume >= 1.5 ? 15 : 10) + 10 + 5,
              stopReference: long
                ? sweep.extreme - confirmation.atr * 0.15
                : sweep.extreme + confirmation.atr * 0.15,
              reason: "previous-day liquidity sweep; reclaim; micro confirmation",
            },
            evaluationStart,
          );
          sweep = null;
        }
      }
    }
  }
  return trades;
}

function maxDrawdown(trades) {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const trade of [...trades].sort((a, b) => a.signalAt.localeCompare(b.signalAt))) {
    equity += trade.netR;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

function summarize(trades) {
  if (!trades.length) {
    return { trades: 0, wins: 0, losses: 0, timeouts: 0, winRate: 0, expectancyR: 0, profitFactor: 0, netR: 0, maxDrawdownR: 0, medianMfeR: 0, medianMaeR: 0 };
  }
  const wins = trades.filter((item) => item.outcome === "WIN");
  const losses = trades.filter((item) => item.outcome === "LOSS");
  const timeouts = trades.filter((item) => item.outcome === "TIMEOUT");
  const positive = trades.filter((item) => item.netR > 0).reduce((sum, item) => sum + item.netR, 0);
  const negative = Math.abs(trades.filter((item) => item.netR < 0).reduce((sum, item) => sum + item.netR, 0));
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    timeouts: timeouts.length,
    winRate: (wins.length / Math.max(1, wins.length + losses.length)) * 100,
    expectancyR: mean(trades.map((item) => item.netR)),
    profitFactor: negative > 0 ? positive / negative : positive > 0 ? 99 : 0,
    netR: trades.reduce((sum, item) => sum + item.netR, 0),
    maxDrawdownR: maxDrawdown(trades),
    medianMfeR: median(trades.map((item) => item.mfe)),
    medianMaeR: median(trades.map((item) => item.mae)),
    p25MfeR: percentile(trades.map((item) => item.mfe), 0.25),
    p75MaeR: percentile(trades.map((item) => item.mae), 0.75),
  };
}

function integrityAudit() {
  return {
    maximumCurrentScore: 97,
    defaultPoints: 13,
    defaultPointSources: [
      "no breakout fallback +4",
      "ATR not above median fallback +3",
      "taker not aligned fallback +1",
      "unconditional +5",
    ],
    minimumTypicalLongScoreExample: {
      score: 76,
      components: "4H trend 25 + MACD 8 + ADX 6 + RelVol 9 + OI 4 + RANGE 5 + RSI 6 + defaults 13",
    },
    tautologicalRrGate: "TP1 is generated at 3.2R and then checked against a >=3R gate after costs.",
    labelIssue: "Any directional structure breakout is labelled Breakout / retest without proving a retest.",
    probabilityWarning: "rankingScore is a heuristic rank, not an estimated win probability.",
  };
}

function markdownReport(meta, summaries, bySymbol, audit) {
  const rows = Object.entries(summaries)
    .map(([strategy, item]) => `| ${strategy} | ${item.trades} | ${format(item.winRate, 1)}% | ${format(item.expectancyR)}R | ${format(item.profitFactor)} | ${format(item.netR)}R | ${format(item.maxDrawdownR)}R | ${format(item.medianMfeR)}R |`)
    .join("\n");
  const symbolRows = Object.entries(bySymbol)
    .flatMap(([symbol, strategies]) => Object.entries(strategies).map(([strategy, item]) => ({ symbol, strategy, ...item })))
    .filter((item) => item.trades > 0)
    .sort((a, b) => b.expectancyR - a.expectancyR)
    .slice(0, 30)
    .map((item) => `| ${item.symbol} | ${item.strategy} | ${item.trades} | ${format(item.winRate, 1)}% | ${format(item.expectancyR)}R | ${format(item.netR)}R |`)
    .join("\n");
  return `# Framework Backtest — Research Only

Generated: ${meta.generatedAt}

Period: ${meta.startAt} to ${meta.endAt}  
Evaluation begins after warm-up: ${meta.evaluationStart}  
Pairs requested: ${meta.requestedPairs.join(", ")}  
Pairs tested: ${meta.testedPairs.join(", ")}

## Scope and limitations

- This is a price/volume market-structure backtest using closed 15m candles aggregated to 1H and 4H.
- Entry is the next 15m candle open. Stop/target collisions inside one candle are scored conservatively as stop first.
- Outcome horizon is ${format(meta.config.horizon / 4, 1)} hours, target is measured at ${format(meta.config.rewardRisk, 1)}R, and a 0.10% round-trip cost is included.
- Historical OI, taker ratio, funding, spread, news, and X context are intentionally excluded instead of being fabricated.
- Current-core results therefore test the technical heart of the live rules, not a claim of complete production performance.
- Current-pair selection creates survivorship bias; results are research evidence, not a guarantee.

## Integrity audit of current scoring

- Default/fallback points: **${audit.defaultPoints}** (${audit.defaultPointSources.join("; ")}).
- A typical trend-aligned candidate can reach **${audit.minimumTypicalLongScoreExample.score}**: ${audit.minimumTypicalLongScoreExample.components}.
- RR issue: ${audit.tautologicalRrGate}
- Label issue: ${audit.labelIssue}
- Interpretation: ${audit.probabilityWarning}

## Aggregate results

| Strategy | Trades | Win rate* | Expectancy | Profit factor | Net R | Max DD | Median MFE |
|---|---:|---:|---:|---:|---:|---:|---:|
${rows}

\*Win rate counts resolved ${format(meta.config.rewardRisk, 1)}R wins versus 1R stops; timeouts are reported separately in JSON and contribute their marked-to-market R to expectancy.

## Best pair/strategy slices (descriptive, not selection advice)

| Pair | Strategy | Trades | Win rate | Expectancy | Net R |
|---|---|---:|---:|---:|---:|
${symbolRows || "| — | — | 0 | 0% | 0R | 0R |"}

## Decision rule

No rule is approved for production merely because this in-sample report is positive. A candidate rule must next pass walk-forward segmentation and a live shadow log with derivative/context fields before it can replace the live framework.
`;
}

async function main() {
  if (!Number.isFinite(days) || days < 60 || days > 365) throw new Error("--days must be between 60 and 365");
  const now = Math.floor((Date.now() - INTERVAL_MS) / INTERVAL_MS) * INTERVAL_MS - 1;
  const start = now - days * 24 * 60 * 60_000;
  const warmupDays = Math.min(60, Math.floor(days * 0.45));
  const evaluationStart = start + warmupDays * 24 * 60 * 60_000;
  const allTrades = [];
  const testedPairs = [];
  const failures = [];
  const candleMap = new Map();

  for (const symbol of pairs) {
    process.stdout.write(`Loading ${symbol}... `);
    try {
      const candles = await loadKlines(symbol, start, now);
      if (candles.length < 4_000) throw new Error(`only ${candles.length} candles`);
      candleMap.set(symbol, candles);
      testedPairs.push(symbol);
      process.stdout.write(`${candles.length} candles\n`);
    } catch (error) {
      failures.push({ symbol, reason: error instanceof Error ? error.message : String(error) });
      process.stdout.write(`skipped (${failures.at(-1).reason})\n`);
    }
  }
  const benchmarkRawBase = candleMap.get("BTCUSDT") ?? candleMap.values().next().value;
  for (const symbol of testedPairs) {
    const trades = runSymbol(symbol, candleMap.get(symbol), evaluationStart, benchmarkRawBase);
    allTrades.push(...trades);
    process.stdout.write(`Tested ${symbol}: ${trades.length} trades\n`);
  }

  const strategies = ["CURRENT_CORE", "BREAKOUT_CONTINUATION", "RETEST_CONTINUATION", "LIQUIDITY_SWEEP_REVERSAL"];
  const summaries = Object.fromEntries(
    strategies.map((strategy) => [strategy, summarize(allTrades.filter((item) => item.strategy === strategy))]),
  );
  const bySymbol = Object.fromEntries(
    testedPairs.map((symbol) => [
      symbol,
      Object.fromEntries(
        strategies.map((strategy) => [strategy, summarize(allTrades.filter((item) => item.symbol === symbol && item.strategy === strategy))]),
      ),
    ]),
  );
  const meta = {
    generatedAt: new Date().toISOString(),
    startAt: new Date(start).toISOString(),
    endAt: new Date(now).toISOString(),
    evaluationStart: new Date(evaluationStart).toISOString(),
    days,
    requestedPairs: pairs,
    testedPairs,
    failures,
    config,
  };
  const audit = integrityAudit();
  const result = { meta, audit, summaries, bySymbol, trades: allTrades };

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, `${tag}.json`), JSON.stringify(result, null, 2));
  await writeFile(join(outputDirectory, `${tag}.md`), markdownReport(meta, summaries, bySymbol, audit));
  process.stdout.write(`\n${markdownReport(meta, summaries, bySymbol, audit).split("## Best pair")[0]}\n`);
}

await main();
