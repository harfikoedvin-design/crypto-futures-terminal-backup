import { calculateRiskMetrics, type RiskMetrics } from "@/lib/risk-engine";

// Direct Binance access remains as a bounded fallback for local runtimes. In
// production, Sites uses the authenticated read-only relay configured through
// BINANCE_RELAY_URL and BINANCE_RELAY_TOKEN.
export const BINANCE_FUTURES_ENDPOINTS = [
  "https://www.binance.com",
  "https://fapi.binance.com",
] as const;

export const SCREENER_RULES = {
  topN: 5,
  prefilterLimit: 30,
  minimumQuoteVolume: 25_000_000,
  maximumSpreadBps: 6,
  minimumScore: 75,
  minimumAdx: 20,
  minimumRelativeVolume: 0.9,
  maximumAbsFunding: 0.001,
  minimumOiChangePercent: 0,
  minimumRiskReward: 3,
  maximumExtensionAtr: 2.5,
} as const;

const EXCLUDED_ASSETS = new Set([
  "USDC",
  "FDUSD",
  "TUSD",
  "USDP",
  "DAI",
  "USDE",
]);

export type Direction = "LONG" | "SHORT" | "NO TRADE";
export type Trend = "BULLISH" | "BEARISH" | "MIXED";
export type EarlySignalStatus = "BASE ZONE" | "ACCUMULATING" | "ARMED" | "WAIT" | "LATE" | "INVALID";
export type VolatilityState = "LOW" | "NORMAL" | "HIGH";
export type DivergenceKind = "REGULAR" | "HIDDEN" | "NONE";
export type AdaptiveRegime = "TRENDING UP" | "TRENDING DOWN" | "RANGING" | "MIXED";

export type AdaptiveShadowEvaluation = {
  version: "ADAPTIVE_V3_SHADOW";
  mode: "SHADOW";
  regime: AdaptiveRegime;
  direction: Direction;
  longScore: number;
  shortScore: number;
  scoreDelta: number;
  eligible: boolean;
  executionEntry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  risk: RiskMetrics | null;
  gateFailures: string[];
  reasons: string[];
};

export type UniverseItem = {
  symbol: string;
  baseAsset: string;
  price: number;
  change24h: number;
  quoteVolume24h: number;
  spreadBps: number;
  fundingRate: number | null;
};

export type TimeframeSnapshot = {
  close: number;
  trend: Trend;
  rsi: number;
  adx: number;
  relativeVolume: number;
  atr: number;
  ema21: number;
  ema50: number;
  vwap: number | null;
  macdHistogram: number;
  closedAt: number;
};

export type Candidate = {
  symbol: string;
  baseAsset: string;
  direction: Exclude<Direction, "NO TRADE">;
  setupType: string;
  technicalScore: number;
  rankingScore: number;
  price: number;
  change24h: number;
  quoteVolume24h: number;
  spreadBps: number;
  fundingRate: number;
  oiChangePercent: number;
  takerBuySellRatio: number | null;
  location: string;
  trendline: string;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  adjustedRr: number;
  risk: RiskMetrics;
  paperGateFailures?: string[];
  contextAdjustment?: number;
  newsAdjustment?: number;
  xAdjustment?: number;
  xSnapshot?: {
    sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
    momentumScore: number;
    mentionCount: number;
    influencerCount: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    latestAt: string;
    freshness: "FRESH" | "AGING" | "STALE";
    sourceReliability: number;
    evidenceHash: string;
  } | null;
  reasons: string[];
  catalysts: string[];
  snapshots: {
    higher: TimeframeSnapshot;
    primary: TimeframeSnapshot;
    confirmation: TimeframeSnapshot;
  };
};

export type CandidateDiagnostic = {
  symbol: string;
  baseAsset: string;
  direction: Direction;
  technicalScore: number;
  price: number;
  change24h: number;
  quoteVolume24h: number;
  spreadBps: number;
  fundingRate: number;
  oiChangePercent: number;
  takerBuySellRatio: number | null;
  snapshots: Candidate["snapshots"] | null;
  failedGates: string[];
  adaptiveShadow: AdaptiveShadowEvaluation | null;
};

export type EarlySignal = {
  symbol: string;
  baseAsset: string;
  direction: Exclude<Direction, "NO TRADE">;
  status: EarlySignalStatus;
  score: number;
  price: number;
  change24h: number;
  divergenceKind: DivergenceKind;
  priceSwingChangePercent: number | null;
  rsiSwingChange: number | null;
  atr: number;
  triggerPrice: number;
  invalidationPrice: number;
  nearestLevel: { label: string; price: number; distanceAtr: number };
  nextLevel: { label: string; price: number; spaceAtr: number } | null;
  volatilityState: VolatilityState;
  atrPercentile: number;
  sweepReclaim: boolean;
  volumeRatio: number;
  recentReturnPercent: number;
  rangeCompression: number;
  oiChangePercent: number;
  takerBuySellRatio: number | null;
  fundingRate: number;
  extensionAtr: number;
  nearBase: boolean;
  reclaimConfirmed: boolean;
  reasons: string[];
};

export type AnalysisResult = {
  symbol: string;
  candidate: Candidate | null;
  watchCandidate: Candidate | null;
  earlySignal: EarlySignal | null;
  diagnostic: CandidateDiagnostic;
  failedGates: string[];
  evaluatedAt: string;
};

export type ChartInterval = "4h" | "1h" | "15m";

export type MarketLevelKey = "PDH" | "PDL" | "PDM" | "DO" | "PWH" | "PWL" | "PWM" | "WO";

export type MarketLevel = {
  key: MarketLevelKey;
  price: number;
  scope: "DAILY" | "WEEKLY";
};

export type ChartPoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema21: number | null;
  ema50: number | null;
  openInterestValue: number | null;
  openInterestDelta: number | null;
  openInterestDeltaPercent: number | null;
};

export type ChartSnapshot = {
  symbol: string;
  interval: ChartInterval;
  points: ChartPoint[];
  livePrice: number;
  levels: MarketLevel[];
  flowSource: "OPEN_INTEREST" | "VOLUME_PROXY";
  generatedAt: string;
};

type Candle = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type BinanceSymbol = {
  symbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  contractType?: string;
  status?: string;
};

type BinanceTicker = {
  symbol?: string;
  lastPrice?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
};

type BinanceBook = {
  symbol?: string;
  bidPrice?: string;
  askPrice?: string;
};

type BinancePremium = {
  symbol?: string;
  lastFundingRate?: string;
};

type BinanceTakerRatio = {
  buySellRatio?: string;
};

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function fetchJson<T>(
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const controller = new AbortController();
  // The first large Binance metadata responses can take longer through a fresh
  // edge connection. Keep the request bounded without rejecting a healthy feed.
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", ...extraHeaders },
      signal: controller.signal,
    });
    if (!response.ok) {
      // Cloudflare counts an unread response body as an active subrequest. Free
      // the slot before trying a fallback provider so other scanner lanes do
      // not deadlock behind rejected 4xx/5xx responses.
      await response.body?.cancel();
      throw new Error(`Provider returned ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchBinanceJson<T>(path: string): Promise<T> {
  const relayBase = process.env.BINANCE_RELAY_URL?.trim().replace(/\/$/, "");
  const relayToken = process.env.BINANCE_RELAY_TOKEN?.trim();

  if (relayBase && relayToken) {
    const upstream = new URL(path, "https://fapi.binance.com");
    const relay = new URL("/api/relay", relayBase);
    relay.searchParams.set("path", upstream.pathname);
    upstream.searchParams.forEach((value, key) => relay.searchParams.set(key, value));
    return fetchJson<T>(relay.toString(), { "X-Relay-Token": relayToken });
  }

  let lastError: unknown;
  for (const endpoint of BINANCE_FUTURES_ENDPOINTS) {
    try {
      return await fetchJson<T>(`${endpoint}${path}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Binance provider unavailable");
}

export async function loadUniverse(): Promise<UniverseItem[]> {
  const [exchange, tickers, books, premiums] = await Promise.all([
    fetchBinanceJson<{ symbols?: BinanceSymbol[] }>("/fapi/v1/exchangeInfo"),
    fetchBinanceJson<BinanceTicker[]>("/fapi/v1/ticker/24hr"),
    fetchBinanceJson<BinanceBook[]>("/fapi/v1/ticker/bookTicker"),
    fetchBinanceJson<BinancePremium[]>("/fapi/v1/premiumIndex"),
  ]);

  const tickerBySymbol = new Map(tickers.map((item) => [item.symbol, item]));
  const bookBySymbol = new Map(books.map((item) => [item.symbol, item]));
  const premiumBySymbol = new Map(premiums.map((item) => [item.symbol, item]));

  return (exchange.symbols ?? [])
    .filter(
      (item) =>
        item.status === "TRADING" &&
        item.contractType === "PERPETUAL" &&
        item.quoteAsset === "USDT" &&
        item.symbol &&
        item.baseAsset &&
        !EXCLUDED_ASSETS.has(item.baseAsset),
    )
    .map((item) => {
      const ticker = tickerBySymbol.get(item.symbol);
      const book = bookBySymbol.get(item.symbol);
      const bid = finite(book?.bidPrice);
      const ask = finite(book?.askPrice);
      const midpoint = (bid + ask) / 2;
      return {
        symbol: item.symbol as string,
        baseAsset: item.baseAsset as string,
        price: finite(ticker?.lastPrice),
        change24h: finite(ticker?.priceChangePercent),
        quoteVolume24h: finite(ticker?.quoteVolume),
        spreadBps: midpoint > 0 ? ((ask - bid) / midpoint) * 10_000 : 99_999,
        fundingRate: premiumBySymbol.get(item.symbol)?.lastFundingRate
          ? finite(premiumBySymbol.get(item.symbol)?.lastFundingRate)
          : null,
      };
    })
    .filter(
      (item) =>
        item.price > 0 &&
        item.quoteVolume24h >= SCREENER_RULES.minimumQuoteVolume &&
        item.spreadBps <= SCREENER_RULES.maximumSpreadBps * 1.5,
    )
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
    .slice(0, SCREENER_RULES.prefilterLimit);
}

function parseKlines(rows: unknown[][]): Candle[] {
  const now = Date.now();
  return rows
    .filter((row) => row.length >= 7 && finite(row[6]) <= now)
    .map((row) => ({
      openTime: finite(row[0]),
      open: finite(row[1]),
      high: finite(row[2]),
      low: finite(row[3]),
      close: finite(row[4]),
      volume: finite(row[5]),
      closeTime: finite(row[6]),
    }))
    .filter((item) => item.close > 0 && item.high >= item.low)
    .sort((a, b) => a.openTime - b.openTime);
}

function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  const output = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    output.push(values[index] * multiplier + output[index - 1] * (1 - multiplier));
  }
  return output;
}

export async function loadChartSeries(
  symbol: string,
  interval: ChartInterval,
): Promise<ChartPoint[]> {
  const encoded = encodeURIComponent(symbol);
  const [rows, openInterestHistory] = await Promise.all([
    fetchBinanceJson<unknown[][]>(
      `/fapi/v1/klines?symbol=${encoded}&interval=${interval}&limit=220`,
    ),
    fetchBinanceJson<Array<{ sumOpenInterestValue?: string; timestamp?: number }>>(
      `/futures/data/openInterestHist?symbol=${encoded}&period=${interval}&limit=220`,
    ).catch(() => []),
  ]);
  const candles = parseKlines(rows);
  const closes = candles.map((item) => item.close);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const openInterest = openInterestHistory
    .map((item) => ({ timestamp: finite(item.timestamp), value: finite(item.sumOpenInterestValue) }))
    .filter((item) => item.timestamp > 0 && item.value > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  const openInterestOffset = Math.max(0, candles.length - openInterest.length);
  return candles.map((item, index) => ({
    candle: item,
    index,
    openInterestIndex: index - openInterestOffset,
  })).map(({ candle, index, openInterestIndex }) => {
    const openInterestValue = openInterestIndex >= 0 ? openInterest[openInterestIndex]?.value ?? null : null;
    const previousOpenInterest = openInterestIndex > 0 ? openInterest[openInterestIndex - 1]?.value ?? null : null;
    const openInterestDelta = openInterestValue !== null && previousOpenInterest !== null
      ? openInterestValue - previousOpenInterest
      : null;
    return {
      time: candle.closeTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      ema21: index >= 20 ? ema21[index] : null,
      ema50: index >= 49 ? ema50[index] : null,
      openInterestValue,
      openInterestDelta,
      openInterestDeltaPercent: openInterestDelta !== null && previousOpenInterest
        ? (openInterestDelta / previousOpenInterest) * 100
        : null,
    };
  }).slice(-120);
}

function utcDayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function utcWeekKey(time: number): string {
  const date = new Date(time);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function groupedCandles(candles: Candle[], keyOf: (time: number) => string) {
  const groups = new Map<string, Candle[]>();
  for (const candle of candles) {
    const key = keyOf(candle.openTime);
    groups.set(key, [...(groups.get(key) ?? []), candle]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function periodLevels(
  groups: Array<[string, Candle[]]>,
  currentKey: string,
  highKey: MarketLevelKey,
  lowKey: MarketLevelKey,
  midKey: MarketLevelKey,
  openKey: MarketLevelKey,
  scope: MarketLevel["scope"],
): MarketLevel[] {
  const currentIndex = groups.findIndex(([key]) => key === currentKey);
  const previous = currentIndex > 0
    ? groups[currentIndex - 1]?.[1]
    : currentIndex === -1
      ? groups.at(-1)?.[1]
      : undefined;
  const current = currentIndex >= 0 ? groups[currentIndex]?.[1] : undefined;
  if (!previous?.length) return [];
  const high = Math.max(...previous.map((candle) => candle.high));
  const low = Math.min(...previous.map((candle) => candle.low));
  const levels: MarketLevel[] = [
    { key: highKey, price: high, scope },
    { key: lowKey, price: low, scope },
    { key: midKey, price: (high + low) / 2, scope },
  ];
  if (current?.length) levels.push({ key: openKey, price: current[0].open, scope });
  return levels;
}

export async function loadMarketLevels(symbol: string): Promise<MarketLevel[]> {
  const rows = await fetchBinanceJson<unknown[][]>(
    `/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=4h&limit=220`,
  );
  const candles = parseKlines(rows);
  return marketLevelsFromCandles(candles);
}

function marketLevelsFromCandles(candles: Candle[]): MarketLevel[] {
  const now = candles.at(-1)?.openTime ?? Date.now();
  return [
    ...periodLevels(groupedCandles(candles, utcDayKey), utcDayKey(now), "PDH", "PDL", "PDM", "DO", "DAILY"),
    ...periodLevels(groupedCandles(candles, utcWeekKey), utcWeekKey(now), "PWH", "PWL", "PWM", "WO", "WEEKLY"),
  ].filter((level) => Number.isFinite(level.price) && level.price > 0);
}

export async function loadLivePrice(symbol: string): Promise<number> {
  const ticker = await fetchBinanceJson<BinanceTicker>(
    `/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(symbol)}`,
  );
  const price = finite(ticker.lastPrice);
  if (price <= 0) throw new Error("Harga live tidak tersedia");
  return price;
}

export async function loadLivePrices(symbols: string[]): Promise<Record<string, number>> {
  const requested = new Set(symbols.filter((symbol) => /^[A-Z0-9]{2,20}USDT$/.test(symbol)).slice(0, 50));
  if (!requested.size) return {};
  const tickers = await fetchBinanceJson<BinanceTicker[]>(
    "/fapi/v1/ticker/24hr",
  );
  return Object.fromEntries(
    tickers.flatMap((ticker) => {
      const symbol = ticker.symbol ?? "";
      const price = finite(ticker.lastPrice);
      return requested.has(symbol) && price > 0 ? [[symbol, price]] : [];
    }),
  );
}

function wilder(values: number[], period: number): number[] {
  if (!values.length) return [];
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

function rsi(closes: number[], period = 14): number {
  const gains: number[] = [];
  const losses: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    gains.push(Math.max(delta, 0));
    losses.push(Math.max(-delta, 0));
  }
  const averageGain = wilder(gains, period).at(-1) ?? 0;
  const averageLoss = wilder(losses, period).at(-1) ?? 0;
  if (!Number.isFinite(averageGain) || !Number.isFinite(averageLoss)) return 50;
  if (averageLoss === 0) return averageGain > 0 ? 100 : 50;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

function atrSeries(candles: Candle[], period = 14): number[] {
  const ranges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previous = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous),
      Math.abs(candle.low - previous),
    );
  });
  return wilder(ranges, period);
}

function adx(candles: Candle[], period = 14): number {
  const plusDm: number[] = [0];
  const minusDm: number[] = [0];
  for (let index = 1; index < candles.length; index += 1) {
    const up = candles[index].high - candles[index - 1].high;
    const down = candles[index - 1].low - candles[index].low;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }
  const atrValues = atrSeries(candles, period);
  const smoothPlus = wilder(plusDm, period);
  const smoothMinus = wilder(minusDm, period);
  const dx = candles.map((_, index) => {
    const range = atrValues[index];
    if (!Number.isFinite(range) || range === 0) return Number.NaN;
    const plus = (100 * smoothPlus[index]) / range;
    const minus = (100 * smoothMinus[index]) / range;
    return plus + minus === 0 ? 0 : (100 * Math.abs(plus - minus)) / (plus + minus);
  });
  const valid = dx.filter(Number.isFinite);
  return wilder(valid, period).at(-1) ?? 0;
}

function currentSessionVwap(candles: Candle[]): number | null {
  const latest = candles.at(-1);
  if (!latest) return null;
  const day = new Date(latest.openTime).toISOString().slice(0, 10);
  const session = candles.filter(
    (item) => new Date(item.openTime).toISOString().slice(0, 10) === day,
  );
  const volume = session.reduce((sum, item) => sum + item.volume, 0);
  if (volume <= 0) return null;
  return (
    session.reduce(
      (sum, item) => sum + ((item.high + item.low + item.close) / 3) * item.volume,
      0,
    ) / volume
  );
}

function snapshot(candles: Candle[], includeVwap: boolean): TimeframeSnapshot {
  if (candles.length < 205) throw new Error("Candle warm-up incomplete");
  const closes = candles.map((item) => item.close);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macdLine = closes.map((_, index) => fast[index] - slow[index]);
  const signal = ema(macdLine, 9);
  const histogram = macdLine.map((value, index) => value - signal[index]);
  const atrValues = atrSeries(candles);
  const last = candles.length - 1;
  const volumeAverage =
    candles.slice(-21, -1).reduce((sum, item) => sum + item.volume, 0) / 20;
  const trend: Trend =
    ema9[last] > ema21[last] && ema21[last] > ema50[last] && ema50[last] > ema200[last]
      ? "BULLISH"
      : ema9[last] < ema21[last] &&
          ema21[last] < ema50[last] &&
          ema50[last] < ema200[last]
        ? "BEARISH"
        : "MIXED";
  return {
    close: closes[last],
    trend,
    rsi: rsi(closes),
    adx: adx(candles),
    relativeVolume: volumeAverage > 0 ? candles[last].volume / volumeAverage : 0,
    atr: atrValues[last],
    ema21: ema21[last],
    ema50: ema50[last],
    vwap: includeVwap ? currentSessionVwap(candles) : null,
    macdHistogram: histogram[last],
    closedAt: candles[last].closeTime,
  };
}

function confirmedSwings(candles: Candle[], lows: boolean, lookback = 96) {
  const recent = candles.slice(-lookback);
  const points: Array<{ index: number; value: number }> = [];
  const window = 3;
  for (let index = window; index < recent.length - window; index += 1) {
    const segment = recent.slice(index - window, index + window + 1);
    const value = lows ? recent[index].low : recent[index].high;
    const boundary = lows
      ? Math.min(...segment.map((item) => item.low))
      : Math.max(...segment.map((item) => item.high));
    if (value === boundary) points.push({ index, value });
  }
  return points;
}

function directionalDivergence(
  candles: Candle[],
  direction: Exclude<Direction, "NO TRADE">,
): {
  kind: DivergenceKind;
  priceChangePercent: number | null;
  rsiChange: number | null;
} {
  const recent = candles.slice(-96);
  const long = direction === "LONG";
  const swings = confirmedSwings(candles, long, 96).slice(-2);
  if (swings.length < 2) {
    return { kind: "NONE", priceChangePercent: null, rsiChange: null };
  }
  const [previous, latest] = swings;
  if (previous.index < 15 || latest.index < 15 || previous.value <= 0) {
    return { kind: "NONE", priceChangePercent: null, rsiChange: null };
  }
  const previousRsi = rsi(recent.slice(0, previous.index + 1).map((item) => item.close));
  const latestRsi = rsi(recent.slice(0, latest.index + 1).map((item) => item.close));
  const priceChangePercent = ((latest.value - previous.value) / previous.value) * 100;
  const rsiChange = latestRsi - previousRsi;
  const regular = long
    ? priceChangePercent <= 0 && rsiChange >= 3
    : priceChangePercent >= 0 && rsiChange <= -3;
  const hidden = long
    ? priceChangePercent > 0 && rsiChange <= -3
    : priceChangePercent < 0 && rsiChange >= 3;
  return {
    kind: regular ? "REGULAR" : hidden ? "HIDDEN" : "NONE",
    priceChangePercent,
    rsiChange,
  };
}

function atrVolatilityState(candles: Candle[], currentAtr: number): {
  percentile: number;
  state: VolatilityState;
} {
  const values = atrSeries(candles)
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(-100);
  if (!values.length || !Number.isFinite(currentAtr) || currentAtr <= 0) {
    return { percentile: 50, state: "NORMAL" };
  }
  const percentile = (values.filter((value) => value <= currentAtr).length / values.length) * 100;
  return {
    percentile,
    state: percentile < 30 ? "LOW" : percentile > 70 ? "HIGH" : "NORMAL",
  };
}

function earlyLocationSignal(input: {
  symbol: string;
  baseAsset: string;
  direction: Exclude<Direction, "NO TRADE">;
  price: number;
  change24h: number;
  fundingRate: number;
  oiChangePercent: number;
  takerRatios: number[];
  primary: TimeframeSnapshot;
  confirmation: TimeframeSnapshot;
  higherCandles: Candle[];
  primaryCandles: Candle[];
  confirmationCandles: Candle[];
  structure: ReturnType<typeof marketStructure>;
}): EarlySignal {
  const {
    symbol,
    baseAsset,
    direction,
    price,
    change24h,
    fundingRate,
    oiChangePercent,
    takerRatios,
    primary,
    confirmation,
    higherCandles,
    primaryCandles,
    confirmationCandles,
    structure,
  } = input;
  const long = direction === "LONG";
  const divergence = directionalDivergence(primaryCandles, direction);
  const volatility = atrVolatilityState(primaryCandles, primary.atr);
  const recent = primaryCandles.slice(-4);
  const baseline = primaryCandles.slice(-24, -4);
  const average = (values: number[]) => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const recentVolume = average(recent.map((item) => item.volume));
  const baselineVolume = average(baseline.map((item) => item.volume));
  const volumeRatio = baselineVolume > 0 ? recentVolume / baselineVolume : 0;
  const recentRange = average(recent.map((item) => item.high - item.low));
  const baselineRange = average(baseline.map((item) => item.high - item.low));
  const rangeCompression = baselineRange > 0 ? recentRange / baselineRange : 99;
  const recentAnchor = primaryCandles.at(-5)?.close ?? primary.close;
  const rawRecentReturnPercent = recentAnchor > 0
    ? ((primary.close - recentAnchor) / recentAnchor) * 100
    : 0;
  const recentReturnPercent = rawRecentReturnPercent * (long ? 1 : -1);
  const atr = primary.atr;
  const extensionAtr = atr > 0
    ? (long ? price - primary.ema21 : primary.ema21 - price) / atr
    : 99;
  const periodLevelRoles: Record<MarketLevelKey, "SUPPORT" | "RESISTANCE" | "BOTH"> = {
    PDH: "RESISTANCE", PDL: "SUPPORT", PDM: "BOTH", DO: "BOTH",
    PWH: "RESISTANCE", PWL: "SUPPORT", PWM: "BOTH", WO: "BOTH",
  };
  const levels: Array<{ label: string; price: number; role: "SUPPORT" | "RESISTANCE" | "BOTH" }> = [
    ...marketLevelsFromCandles(higherCandles).map((level) => ({ label: level.key, price: level.price, role: periodLevelRoles[level.key] })),
    { label: "STRUCTURE SUPPORT", price: structure.support, role: "SUPPORT" },
    { label: "STRUCTURE RESISTANCE", price: structure.resistance, role: "RESISTANCE" },
    { label: "EMA21", price: primary.ema21, role: "BOTH" },
    { label: "EMA50", price: primary.ema50, role: "BOTH" },
    ...(primary.vwap ? [{ label: "VWAP", price: primary.vwap, role: "BOTH" as const }] : []),
  ].filter((level) => Number.isFinite(level.price) && level.price > 0);
  const baseCandidates = levels.filter((level) => {
    if (long && level.role === "RESISTANCE") return false;
    if (!long && level.role === "SUPPORT") return false;
    return long ? level.price <= price + atr * 0.15 : level.price >= price - atr * 0.15;
  });
  const nearest = (baseCandidates.length ? baseCandidates : levels)
    .map((level) => ({ ...level, distanceAtr: atr > 0 ? Math.abs(price - level.price) / atr : 99 }))
    .sort((a, b) => a.distanceAtr - b.distanceAtr)[0];
  const nearestLevel = {
    label: nearest?.label ?? "NO LEVEL",
    price: nearest?.price ?? price,
    distanceAtr: nearest?.distanceAtr ?? 99,
  };
  const targetCandidates = levels
    .filter((level) => long
      ? level.role !== "SUPPORT" && level.price > price + atr * 0.1
      : level.role !== "RESISTANCE" && level.price < price - atr * 0.1)
    .map((level) => ({ ...level, spaceAtr: atr > 0 ? Math.abs(level.price - price) / atr : 0 }))
    .sort((a, b) => a.spaceAtr - b.spaceAtr);
  const nextTarget = targetCandidates[0] ?? null;
  const nextLevel = nextTarget
    ? { label: nextTarget.label, price: nextTarget.price, spaceAtr: nextTarget.spaceAtr }
    : null;
  const nearBase = nearestLevel.distanceAtr <= 0.9;
  const recentForSweep = primaryCandles.slice(-12);
  const sweepReclaim = long
    ? recentForSweep.some((candle) => candle.low < nearestLevel.price) && primary.close > nearestLevel.price
    : recentForSweep.some((candle) => candle.high > nearestLevel.price) && primary.close < nearestLevel.price;
  const priorConfirmationHigh = Math.max(...confirmationCandles.slice(-9, -1).map((item) => item.high));
  const priorConfirmationLow = Math.min(...confirmationCandles.slice(-9, -1).map((item) => item.low));
  const triggerPrice = long ? priorConfirmationHigh : priorConfirmationLow;
  const invalidationPrice = long ? nearestLevel.price - atr * 0.4 : nearestLevel.price + atr * 0.4;
  const reclaimConfirmed = long
    ? confirmation.close > priorConfirmationHigh && confirmation.close >= confirmation.ema21 && confirmation.rsi >= 50
    : confirmation.close < priorConfirmationLow && confirmation.close <= confirmation.ema21 && confirmation.rsi <= 50;
  const takerBuySellRatio = takerRatios.length ? average(takerRatios) : null;
  const takerImproving = takerRatios.length >= 2 && (long
    ? takerRatios.at(-1)! >= takerRatios[0]
    : takerRatios.at(-1)! <= takerRatios[0]);
  const takerAligned = takerBuySellRatio !== null && (long ? takerBuySellRatio >= 1.05 : takerBuySellRatio <= 0.95);
  const absorption = volumeRatio >= 1.1 && recentReturnPercent <= 2 && rangeCompression <= 1.4;
  const coreEvidence = divergence.kind !== "NONE" || absorption || sweepReclaim;
  const crowdedFunding = Math.abs(fundingRate) > 0.001;
  const directionalChange24h = change24h * (long ? 1 : -1);
  const tooLate = nearestLevel.distanceAtr > 1.2 || extensionAtr > 1.2 || directionalChange24h > 15 || recentReturnPercent > 4;
  const invalid = long
    ? primaryCandles.slice(-2).every((candle) => candle.close < nearestLevel.price - atr * 0.4)
    : primaryCandles.slice(-2).every((candle) => candle.close > nearestLevel.price + atr * 0.4);
  const enoughSpace = nextLevel === null || nextLevel.spaceAtr >= 1;

  let score = 0;
  if (divergence.kind === "REGULAR") score += 22;
  else if (divergence.kind === "HIDDEN") score += 18;
  if (sweepReclaim) score += 12;
  if (volumeRatio >= 1.1) score += 16;
  else if (volumeRatio >= 0.9) score += 8;
  if (oiChangePercent >= 0.5) score += 14;
  else if (oiChangePercent >= 0) score += 7;
  if (takerAligned && takerImproving) score += 12;
  else if (takerBuySellRatio !== null && (long ? takerBuySellRatio >= 0.95 : takerBuySellRatio <= 1.05)) score += 6;
  if (nearBase) score += 12;
  if (rangeCompression <= 1) score += 8;
  if (!crowdedFunding) score += 6;
  if (long ? confirmation.rsi >= 45 && confirmation.rsi <= 65 : confirmation.rsi >= 35 && confirmation.rsi <= 55) score += 4;
  if (reclaimConfirmed) score += 10;
  if (enoughSpace) score += 6;
  score = Math.min(100, score);

  const status: EarlySignalStatus = invalid
    ? "INVALID"
    : tooLate
      ? "LATE"
      : coreEvidence && score >= 72 && (reclaimConfirmed || sweepReclaim) && enoughSpace
      ? "ARMED"
      : coreEvidence && score >= 58 && nearBase
        ? "ACCUMULATING"
        : nearestLevel.distanceAtr <= 0.6
          ? "BASE ZONE"
          : "WAIT";
  const divergenceLabel = divergence.kind === "NONE"
    ? `${long ? "Bullish" : "Bearish"} divergence belum terkonfirmasi`
    : `${divergence.kind === "HIDDEN" ? "Hidden" : "Regular"} ${long ? "bullish" : "bearish"} divergence · price ${divergence.priceChangePercent?.toFixed(2)}% · RSI ${divergence.rsiChange !== null && divergence.rsiChange >= 0 ? "+" : ""}${divergence.rsiChange?.toFixed(1)}`;
  const reasons = [
    `${direction} · ${nearestLevel.label} ${nearestLevel.distanceAtr.toFixed(2)} ATR`,
    divergenceLabel,
    `Volume 1H ${volumeRatio.toFixed(2)}x baseline · range ${rangeCompression.toFixed(2)}x`,
    `OI 45m ${oiChangePercent >= 0 ? "+" : ""}${oiChangePercent.toFixed(2)}% · taker ${takerBuySellRatio?.toFixed(2) ?? "—"}`,
    `${volatility.state} VOL · ATR percentile ${volatility.percentile.toFixed(0)} · ruang ${nextLevel ? `${nextLevel.spaceAtr.toFixed(2)} ATR ke ${nextLevel.label}` : "terbuka"}`,
    reclaimConfirmed || sweepReclaim ? "Trigger closed-candle/sweep-reclaim terkonfirmasi" : "Menunggu trigger closed candle",
  ];

  return {
    symbol,
    baseAsset,
    direction,
    status,
    score,
    price,
    change24h,
    divergenceKind: divergence.kind,
    priceSwingChangePercent: divergence.priceChangePercent,
    rsiSwingChange: divergence.rsiChange,
    atr,
    triggerPrice,
    invalidationPrice,
    nearestLevel,
    nextLevel,
    volatilityState: volatility.state,
    atrPercentile: volatility.percentile,
    sweepReclaim,
    volumeRatio,
    recentReturnPercent,
    rangeCompression,
    oiChangePercent,
    takerBuySellRatio,
    fundingRate,
    extensionAtr,
    nearBase,
    reclaimConfirmed,
    reasons,
  };
}

function trendline(candles: Candle[], direction: Direction, close: number, atr: number) {
  const points = confirmedSwings(candles, direction === "LONG").slice(-4);
  if (points.length < 2 || atr <= 0) {
    return { text: "Belum cukup swing terkonfirmasi", actionable: false, broken: false };
  }
  const meanX = points.reduce((sum, item) => sum + item.index, 0) / points.length;
  const meanY = points.reduce((sum, item) => sum + item.value, 0) / points.length;
  const denominator = points.reduce((sum, item) => sum + (item.index - meanX) ** 2, 0);
  if (denominator === 0) {
    return { text: "Trendline belum stabil", actionable: false, broken: false };
  }
  const slope =
    points.reduce((sum, item) => sum + (item.index - meanX) * (item.value - meanY), 0) /
    denominator;
  const projection = meanY - slope * meanX + slope * (Math.min(96, candles.length) - 1);
  const long = direction === "LONG";
  const aligned = long ? slope > 0 : slope < 0;
  const distance = long ? (close - projection) / atr : (projection - close) / atr;
  const label = long
    ? `${slope > 0 ? "Rising" : "Falling"} support`
    : `${slope < 0 ? "Falling" : "Rising"} resistance`;
  return {
    text: `${label} · ${distance >= 0 ? "+" : ""}${distance.toFixed(2)} ATR · ${points.length} sentuhan`,
    actionable: aligned && distance >= -0.4 && distance <= 1.25,
    broken: aligned && distance < -0.4,
  };
}

function marketStructure(candles: Candle[]) {
  const reference = candles.slice(-99, -3);
  const lows = confirmedSwings(reference, true).slice(-3);
  const highs = confirmedSwings(reference, false).slice(-3);
  const support = lows.at(-1)?.value ?? Math.min(...reference.slice(-48).map((item) => item.low));
  const resistance =
    highs.at(-1)?.value ?? Math.max(...reference.slice(-48).map((item) => item.high));
  const last = candles.at(-1)?.close ?? 0;
  const breakout = last > resistance ? "UP" : last < support ? "DOWN" : "NONE";
  const trend =
    lows.length >= 2 && highs.length >= 2
      ? lows.at(-1)!.value > lows.at(-2)!.value && highs.at(-1)!.value > highs.at(-2)!.value
        ? "BULLISH"
        : lows.at(-1)!.value < lows.at(-2)!.value &&
            highs.at(-1)!.value < highs.at(-2)!.value
          ? "BEARISH"
          : "RANGE"
      : "RANGE";
  return { support, resistance, breakout, trend };
}

function locationContext(
  candles: Candle[],
  primary: TimeframeSnapshot,
  direction: Exclude<Direction, "NO TRADE">,
  structure: ReturnType<typeof marketStructure>,
) {
  const close = primary.close;
  const atr = primary.atr;
  const long = direction === "LONG";
  const reasons: string[] = [];
  const locations: string[] = [];
  const line = trendline(candles, direction, close, atr);
  const structuralDistance = long
    ? (close - structure.support) / atr
    : (structure.resistance - close) / atr;
  if (structuralDistance >= 0 && structuralDistance <= 1.25) {
    locations.push(long ? "support struktural" : "resistance struktural");
    reasons.push(
      `Harga ${structuralDistance.toFixed(2)} ATR dari ${long ? "support" : "resistance"} utama`,
    );
  }
  const emaDistance = long
    ? (close - primary.ema21) / atr
    : (primary.ema21 - close) / atr;
  if (emaDistance >= 0 && emaDistance <= 1.25) {
    locations.push(long ? "EMA21 support" : "EMA21 resistance");
    reasons.push(`Pullback ${emaDistance.toFixed(2)} ATR dari EMA21`);
  }
  if (primary.vwap) {
    const vwapDistance = long
      ? (close - primary.vwap) / atr
      : (primary.vwap - close) / atr;
    if (vwapDistance >= 0 && vwapDistance <= 1.25) {
      locations.push(long ? "VWAP support" : "VWAP resistance");
      reasons.push(`Harga ${vwapDistance.toFixed(2)} ATR dari VWAP sesi`);
    }
  }
  const expectedBreakout = long ? "UP" : "DOWN";
  if (structure.breakout === expectedBreakout) {
    locations.unshift(long ? "breakout/retest" : "breakdown/retest");
    reasons.unshift(`${long ? "Breakout" : "Breakdown"} struktur terkonfirmasi`);
  }
  if (line.actionable) {
    locations.push(long ? "rising trendline" : "falling trendline");
    reasons.push("Harga berada dekat trendline yang searah tren");
  }
  return {
    label: [...new Set(locations)].slice(0, 2).join(" + ") || "Belum di level aksi",
    trendline: line.text,
    actionable: locations.length > 0,
    broken: line.broken,
    reasons: reasons.slice(0, 3),
  };
}

function executionPlan(
  direction: Exclude<Direction, "NO TRADE">,
  price: number,
  primary: TimeframeSnapshot,
  structure: ReturnType<typeof marketStructure>,
) {
  const long = direction === "LONG";
  const atr = primary.atr;
  const entryLow = long ? Math.min(price, primary.ema21 + atr * 0.08) : price - atr * 0.03;
  const entryHigh = long ? price + atr * 0.03 : Math.max(price, primary.ema21 - atr * 0.08);
  const executionEntry = (entryLow + entryHigh) / 2;
  const stopLoss = long
    ? Math.min(structure.support - atr * 0.25, executionEntry - atr)
    : Math.max(structure.resistance + atr * 0.25, executionEntry + atr);
  const structuralRisk = Math.abs(executionEntry - stopLoss);
  return {
    entryLow,
    entryHigh,
    executionEntry,
    stopLoss,
    tp1: long ? executionEntry + structuralRisk * 3.2 : executionEntry - structuralRisk * 3.2,
    tp2: long ? executionEntry + structuralRisk * 4 : executionEntry - structuralRisk * 4,
    tp3: long ? executionEntry + structuralRisk * 5 : executionEntry - structuralRisk * 5,
  };
}

function adaptiveRegime(higher: TimeframeSnapshot, primary: TimeframeSnapshot): AdaptiveRegime {
  if (higher.trend === "BULLISH" && primary.trend !== "BEARISH") return "TRENDING UP";
  if (higher.trend === "BEARISH" && primary.trend !== "BULLISH") return "TRENDING DOWN";
  if (primary.adx < 18) return "RANGING";
  return "MIXED";
}

function adaptiveDirectionScore(input: {
  direction: Exclude<Direction, "NO TRADE">;
  higher: TimeframeSnapshot;
  primary: TimeframeSnapshot;
  confirmation: TimeframeSnapshot;
  structure: ReturnType<typeof marketStructure>;
  location: ReturnType<typeof locationContext>;
  oiChangePercent: number;
  takerBuySellRatio: number | null;
  fundingRate: number;
}) {
  const { direction, higher, primary, confirmation, structure, location, oiChangePercent, takerBuySellRatio, fundingRate } = input;
  const long = direction === "LONG";
  const alignedTrend = long ? "BULLISH" : "BEARISH";
  const alignedBreakout = long ? "UP" : "DOWN";
  const closeAligned = long ? primary.close >= primary.ema21 : primary.close <= primary.ema21;
  const macdAligned = long ? primary.macdHistogram > 0 : primary.macdHistogram < 0;
  const rsiAligned = long
    ? primary.rsi >= 45 && primary.rsi < 70
    : primary.rsi > 30 && primary.rsi <= 55;
  const confirmationAligned =
    (long && confirmation.close >= confirmation.ema21 && confirmation.macdHistogram > 0 && confirmation.rsi >= 45) ||
    (!long && confirmation.close <= confirmation.ema21 && confirmation.macdHistogram < 0 && confirmation.rsi <= 55);
  const takerAligned = takerBuySellRatio !== null && (long ? takerBuySellRatio >= 1 : takerBuySellRatio <= 1);
  const fundingAligned = Math.abs(fundingRate) <= SCREENER_RULES.maximumAbsFunding &&
    (long ? fundingRate <= 0.0007 : fundingRate >= -0.0007);
  const extensionAtr = primary.atr > 0 ? Math.abs(primary.close - primary.ema21) / primary.atr : 99;
  let score = 0;
  if (higher.trend === alignedTrend) score += 22;
  if (primary.trend === alignedTrend) score += 14;
  if (closeAligned) score += 8;
  if (macdAligned) score += 8;
  if (rsiAligned) score += 6;
  if (confirmationAligned) score += 12;
  if (structure.trend === alignedTrend) score += 12;
  else if (structure.trend === "RANGE") score += 4;
  if (structure.breakout === alignedBreakout) score += 8;
  if (primary.adx >= 18) score += 6;
  if (primary.relativeVolume >= 0.75) score += 9;
  if (oiChangePercent >= 0) score += 4;
  if (takerAligned) score += 4;
  if (fundingAligned) score += 4;
  if (location.actionable) score += 8;
  if (extensionAtr <= 1.5) score += 5;
  return Math.min(100, score);
}

function adaptiveShadowEvaluation(input: {
  price: number;
  higher: TimeframeSnapshot;
  primary: TimeframeSnapshot;
  confirmation: TimeframeSnapshot;
  structure: ReturnType<typeof marketStructure>;
  primaryCandles: Candle[];
  oiChangePercent: number;
  takerBuySellRatio: number | null;
  fundingRate: number;
}): AdaptiveShadowEvaluation {
  const { price, higher, primary, confirmation, structure, primaryCandles, oiChangePercent, takerBuySellRatio, fundingRate } = input;
  const regime = adaptiveRegime(higher, primary);
  const longLocation = locationContext(primaryCandles, primary, "LONG", structure);
  const shortLocation = locationContext(primaryCandles, primary, "SHORT", structure);
  const shared = { higher, primary, confirmation, structure, oiChangePercent, takerBuySellRatio, fundingRate };
  const longScore = adaptiveDirectionScore({ ...shared, direction: "LONG", location: longLocation });
  const shortScore = adaptiveDirectionScore({ ...shared, direction: "SHORT", location: shortLocation });
  const scoreDelta = Math.abs(longScore - shortScore);
  const winningDirection: Exclude<Direction, "NO TRADE"> = longScore >= shortScore ? "LONG" : "SHORT";
  const winningScore = Math.max(longScore, shortScore);
  const direction: Direction = winningScore >= 70 && scoreDelta >= 8 ? winningDirection : "NO TRADE";
  const gateFailures: string[] = [];
  if (winningScore < 70) gateFailures.push("SHADOW_SCORE_BELOW_70");
  if (scoreDelta < 8) gateFailures.push("SHADOW_DIRECTION_EDGE_WEAK");
  if (direction === "NO TRADE") {
    return {
      version: "ADAPTIVE_V3_SHADOW",
      mode: "SHADOW",
      regime,
      direction,
      longScore,
      shortScore,
      scoreDelta,
      eligible: false,
      executionEntry: null,
      stopLoss: null,
      takeProfit: null,
      risk: null,
      gateFailures,
      reasons: [`Regime ${regime}`, `LONG ${longScore} vs SHORT ${shortScore}`],
    };
  }
  const location = direction === "LONG" ? longLocation : shortLocation;
  if (!location.actionable) gateFailures.push("SHADOW_LOCATION_NOT_ACTIONABLE");
  if (location.broken) gateFailures.push("SHADOW_TRENDLINE_BROKEN");
  const plan = executionPlan(direction, price, primary, structure);
  const risk = calculateRiskMetrics({
    entryPrice: plan.executionEntry,
    stopLoss: plan.stopLoss,
    takeProfit: plan.tp1,
    atr: primary.atr,
  });
  gateFailures.push(...risk.gateFailures.map((gate) => `SHADOW_${gate}`));
  return {
    version: "ADAPTIVE_V3_SHADOW",
    mode: "SHADOW",
    regime,
    direction,
    longScore,
    shortScore,
    scoreDelta,
    eligible: gateFailures.length === 0,
    executionEntry: plan.executionEntry,
    stopLoss: plan.stopLoss,
    takeProfit: plan.tp1,
    risk,
    gateFailures: [...new Set(gateFailures)],
    reasons: [
      `Regime ${regime}`,
      `LONG ${longScore} vs SHORT ${shortScore}`,
      location.label,
      `R:R bersih ${risk.netRiskReward.toFixed(2)} · SL ${risk.stopDistancePct.toFixed(2)}%`,
    ],
  };
}

export async function analyzeSymbol(
  symbol: string,
  marketSnapshot?: UniverseItem,
): Promise<AnalysisResult> {
  const encoded = encodeURIComponent(symbol);
  const [
    higherRaw,
    primaryRaw,
    confirmationRaw,
    ticker,
    book,
    premium,
    oiHistory,
    takerHistory,
  ] =
    await Promise.all([
      fetchBinanceJson<unknown[][]>(`/fapi/v1/klines?symbol=${encoded}&interval=4h&limit=220`),
      fetchBinanceJson<unknown[][]>(`/fapi/v1/klines?symbol=${encoded}&interval=1h&limit=220`),
      fetchBinanceJson<unknown[][]>(`/fapi/v1/klines?symbol=${encoded}&interval=15m&limit=220`),
      marketSnapshot
        ? Promise.resolve<BinanceTicker | null>(null)
        : fetchBinanceJson<BinanceTicker>(`/fapi/v1/ticker/24hr?symbol=${encoded}`),
      marketSnapshot
        ? Promise.resolve<BinanceBook | null>(null)
        : fetchBinanceJson<BinanceBook>(`/fapi/v1/ticker/bookTicker?symbol=${encoded}`),
      marketSnapshot
        ? Promise.resolve<BinancePremium | null>(null)
        : fetchBinanceJson<BinancePremium>(`/fapi/v1/premiumIndex?symbol=${encoded}`),
      fetchBinanceJson<Array<{ sumOpenInterestValue?: string }>>(
        `/futures/data/openInterestHist?symbol=${encoded}&period=15m&limit=4`,
      ),
      fetchBinanceJson<BinanceTakerRatio[]>(
        `/futures/data/takerlongshortRatio?symbol=${encoded}&period=15m&limit=4`,
      ).catch(() => []),
    ]);

  const higherCandles = parseKlines(higherRaw);
  const primaryCandles = parseKlines(primaryRaw);
  const confirmationCandles = parseKlines(confirmationRaw);
  const higher = snapshot(higherCandles, false);
  const primary = snapshot(primaryCandles, true);
  const confirmation = snapshot(confirmationCandles, true);
  const structure = marketStructure(primaryCandles);
  const bid = finite(book?.bidPrice);
  const ask = finite(book?.askPrice);
  const midpoint = (bid + ask) / 2;
  const spreadBps = marketSnapshot?.spreadBps ??
    (midpoint > 0 ? ((ask - bid) / midpoint) * 10_000 : 99_999);
  const fundingRate = marketSnapshot?.fundingRate ?? finite(premium?.lastFundingRate);
  const quoteVolume24h = marketSnapshot?.quoteVolume24h ?? finite(ticker?.quoteVolume);
  const change24h = marketSnapshot?.change24h ?? finite(ticker?.priceChangePercent);
  const previousOi = finite(oiHistory.at(0)?.sumOpenInterestValue);
  const currentOi = finite(oiHistory.at(-1)?.sumOpenInterestValue);
  const oiChangePercent = previousOi > 0 ? ((currentOi - previousOi) / previousOi) * 100 : -999;
  const validTakerRatios = takerHistory
    .map((item) => finite(item.buySellRatio, Number.NaN))
    .filter(Number.isFinite);
  const takerBuySellRatio = validTakerRatios.length
    ? validTakerRatios.reduce((sum, value) => sum + value, 0) / validTakerRatios.length
    : null;
  const price = marketSnapshot?.price ?? finite(ticker?.lastPrice, primary.close);
  const baseAsset = marketSnapshot?.baseAsset ?? symbol.replace(/USDT$/, "");
  const adaptiveShadow = adaptiveShadowEvaluation({
    price,
    higher,
    primary,
    confirmation,
    structure,
    primaryCandles,
    oiChangePercent,
    takerBuySellRatio,
    fundingRate,
  });
  const earlyDirection: Exclude<Direction, "NO TRADE"> = adaptiveShadow.direction === "NO TRADE"
    ? adaptiveShadow.longScore >= adaptiveShadow.shortScore ? "LONG" : "SHORT"
    : adaptiveShadow.direction;
  const earlySignal = earlyLocationSignal({
    symbol,
    baseAsset,
    direction: earlyDirection,
    price,
    change24h,
    fundingRate,
    oiChangePercent,
    takerRatios: validTakerRatios,
    primary,
    confirmation,
    higherCandles,
    primaryCandles,
    confirmationCandles,
    structure,
  });

  const timeframeConflict =
    (higher.trend === "BULLISH" && primary.trend === "BEARISH") ||
    (higher.trend === "BEARISH" && primary.trend === "BULLISH");

  const direction: Direction =
    !timeframeConflict &&
    higher.trend === "BULLISH" &&
    primary.close >= primary.ema21 &&
    primary.macdHistogram > 0 &&
    primary.rsi >= 48
      ? "LONG"
      : !timeframeConflict &&
          higher.trend === "BEARISH" &&
          primary.close <= primary.ema21 &&
          primary.macdHistogram < 0 &&
          primary.rsi <= 52
        ? "SHORT"
        : "NO TRADE";

  const failedGates: string[] = [];
  if (timeframeConflict) failedGates.push("TIMEFRAME_CONFLICT");
  else if (direction === "NO TRADE") failedGates.push("BASE_SIGNAL_NO_TRADE");
  const long = direction === "LONG";
  const short = direction === "SHORT";
  const confirmationAligned =
    (long &&
      confirmation.macdHistogram > 0 &&
      confirmation.close >= confirmation.ema21 &&
      confirmation.rsi >= 48) ||
    (short &&
      confirmation.macdHistogram < 0 &&
      confirmation.close <= confirmation.ema21 &&
      confirmation.rsi <= 52);

  let score = 0;
  if ((long && higher.trend === "BULLISH") || (short && higher.trend === "BEARISH")) score += 25;
  if ((long && primary.macdHistogram > 0) || (short && primary.macdHistogram < 0)) score += 8;
  if ((long && primary.rsi >= 50 && primary.rsi < 70) || (short && primary.rsi > 30 && primary.rsi <= 50)) score += 6;
  if (primary.adx >= 18) score += 6;
  if ((long && structure.trend === "BULLISH") || (short && structure.trend === "BEARISH")) score += 12;
  else if (structure.trend === "RANGE") score += 5;
  if ((long && structure.breakout === "UP") || (short && structure.breakout === "DOWN")) score += 8;
  else score += 4;
  if (primary.relativeVolume >= 0.75) score += 9;
  const recentAtr = atrSeries(primaryCandles).slice(-20);
  const atrMedian = [...recentAtr].sort((a, b) => a - b)[Math.floor(recentAtr.length / 2)];
  score += primary.atr > atrMedian ? 6 : 3;
  const takerAligned =
    takerBuySellRatio !== null &&
    ((long && takerBuySellRatio >= 1) || (short && takerBuySellRatio <= 1));
  score += takerAligned ? 4 : 1;
  if (oiChangePercent >= 0) score += 4;
  const fundingSupports =
    Math.abs(fundingRate) <= SCREENER_RULES.maximumAbsFunding &&
    ((long && fundingRate <= 0.0007) || (short && fundingRate >= -0.0007));
  if (fundingSupports) score += 4;
  score += 5;
  score = Math.min(100, score);

  const diagnosticBase = {
    symbol,
    baseAsset,
    direction,
    technicalScore: score,
    price,
    change24h,
    quoteVolume24h,
    spreadBps,
    fundingRate,
    oiChangePercent,
    takerBuySellRatio,
    snapshots: { higher, primary, confirmation },
    adaptiveShadow,
  } satisfies Omit<CandidateDiagnostic, "failedGates">;

  if (direction === "NO TRADE") {
    const uniqueGates = [...new Set(failedGates)];
    return {
      symbol,
      candidate: null,
      watchCandidate: null,
      earlySignal,
      diagnostic: { ...diagnosticBase, failedGates: uniqueGates },
      failedGates: uniqueGates,
      evaluatedAt: new Date().toISOString(),
    };
  }

  const location = locationContext(primaryCandles, primary, direction, structure);
  if (score < SCREENER_RULES.minimumScore) failedGates.push("SCORE_BELOW_75");
  if (!confirmationAligned) failedGates.push("15M_NOT_ALIGNED");
  if (primary.adx < SCREENER_RULES.minimumAdx) failedGates.push("ADX_BELOW_20");
  if (primary.relativeVolume < SCREENER_RULES.minimumRelativeVolume)
    failedGates.push("RELATIVE_VOLUME_BELOW_0_9");
  if (quoteVolume24h < SCREENER_RULES.minimumQuoteVolume) failedGates.push("LIQUIDITY_TOO_LOW");
  if (spreadBps > SCREENER_RULES.maximumSpreadBps) failedGates.push("SPREAD_ABOVE_6_BPS");
  if (Math.abs(fundingRate) > SCREENER_RULES.maximumAbsFunding)
    failedGates.push("FUNDING_EXTREME");
  if (oiChangePercent < SCREENER_RULES.minimumOiChangePercent) failedGates.push("OI_NOT_CONFIRMING");
  if (!location.actionable) failedGates.push("LOCATION_NOT_ACTIONABLE");
  if (location.broken) failedGates.push("TRENDLINE_BROKEN");

  const atr = primary.atr;
  const extensionAtr = atr > 0 ? Math.abs(price - primary.ema21) / atr : 99;
  if (extensionAtr > SCREENER_RULES.maximumExtensionAtr) failedGates.push("PRICE_OVEREXTENDED");
  const { entryLow, entryHigh, stopLoss, tp1, tp2, tp3 } = executionPlan(direction, price, primary, structure);
  const risk = calculateRiskMetrics({ entryPrice: price, stopLoss, takeProfit: tp1, atr });
  failedGates.push(...risk.gateFailures);

  const reasons = [
    `4H ${higher.trend} · 1H ${primary.trend} · 15m konfirmasi`,
    ...location.reasons,
    `RSI ${primary.rsi.toFixed(1)} · ADX ${primary.adx.toFixed(1)} · RelVol ${primary.relativeVolume.toFixed(2)}x`,
    `Volume 24j ${(quoteVolume24h / 1_000_000).toFixed(0)}M USDT · spread ${spreadBps.toFixed(2)} bps`,
    `Funding ${(fundingRate * 100).toFixed(4)}% · OI 45m ${oiChangePercent >= 0 ? "+" : ""}${oiChangePercent.toFixed(2)}%`,
  ].slice(0, 5);

  const setup = {
    symbol,
    baseAsset: symbol.replace(/USDT$/, ""),
    direction,
    setupType: structure.breakout === (long ? "UP" : "DOWN") ? "Breakout / retest" : "Trend pullback",
    technicalScore: score,
    rankingScore: score,
    price,
    change24h,
    quoteVolume24h,
    spreadBps,
    fundingRate,
    oiChangePercent,
    takerBuySellRatio,
    location: location.label,
    trendline: location.trendline,
    entryLow,
    entryHigh,
    stopLoss,
    tp1,
    tp2,
    tp3,
    adjustedRr: risk.netRiskReward,
    risk,
    reasons,
    catalysts: [],
    snapshots: { higher, primary, confirmation },
  } satisfies Candidate;

  if (failedGates.length) {
    const uniqueGates = [...new Set(failedGates)];
    return {
      symbol,
      candidate: null,
      watchCandidate: setup,
      earlySignal,
      diagnostic: { ...diagnosticBase, failedGates: uniqueGates },
      failedGates: uniqueGates,
      evaluatedAt: new Date().toISOString(),
    };
  }

  return {
    symbol,
    candidate: setup,
    watchCandidate: null,
    earlySignal,
    diagnostic: { ...diagnosticBase, failedGates: [] },
    failedGates: [],
    evaluatedAt: new Date().toISOString(),
  };
}

export async function scanMarket(): Promise<{
  universe: UniverseItem[];
  results: AnalysisResult[];
}> {
  const universe = await loadUniverse();
  const results: AnalysisResult[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, universe.length) }, async () => {
    while (cursor < universe.length) {
      const item = universe[cursor];
      cursor += 1;
      try {
        results.push(await analyzeSymbol(item.symbol, item));
      } catch {
        results.push({
          symbol: item.symbol,
          candidate: null,
          watchCandidate: null,
          earlySignal: null,
          diagnostic: {
            symbol: item.symbol,
            baseAsset: item.baseAsset,
            direction: "NO TRADE",
            technicalScore: 0,
            price: item.price,
            change24h: item.change24h,
            quoteVolume24h: item.quoteVolume24h,
            spreadBps: item.spreadBps,
            fundingRate: item.fundingRate ?? 0,
            oiChangePercent: -999,
            takerBuySellRatio: null,
            snapshots: null,
            failedGates: ["PROVIDER_UNAVAILABLE"],
            adaptiveShadow: null,
          },
          failedGates: ["PROVIDER_UNAVAILABLE"],
          evaluatedAt: new Date().toISOString(),
        });
      }
    }
  });
  await Promise.all(workers);
  results.sort(
    (a, b) =>
      universe.findIndex((item) => item.symbol === a.symbol) -
      universe.findIndex((item) => item.symbol === b.symbol),
  );
  return { universe, results };
}
