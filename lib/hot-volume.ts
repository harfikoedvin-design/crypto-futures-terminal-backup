import { fetchBinanceJson, fetchJson } from "@/lib/market";

export const HOT_VOLUME_RULES = {
  minimumVolume24hUsd: 100_000,
  minimumMarketCapUsd: 1_000_000,
  maximumMarketCapUsd: 1_000_000_000,
  minimumVolumeChange1hPct: 20,
  maximumSpreadBps: 12,
  maximumExtensionAtr: 1.2,
  prefilterLimit: 48,
  resultLimit: 24,
} as const;

export type HotVolumeDirection = "LONG" | "SHORT" | "NEUTRAL";
export type HotVolumeStatus =
  | "BREAKOUT_READY"
  | "BREAKOUT_CONFIRMED"
  | "READY"
  | "LONG_PRESSURE"
  | "SHORT_PRESSURE"
  | "HEATING"
  | "WAIT_PULLBACK"
  | "SQUEEZE"
  | "LIQUIDATION_RISK"
  | "CHASE_RISK";

export type HotVolumeCandidate = {
  symbol: string;
  baseAsset: string;
  price: number;
  marketCapUsd: number;
  fundingRate: number;
  spreadBps: number;
  priceChange: { m5: number; m15: number; h1: number; h4: number; h24: number; d7: number };
  volumeUsd: { m5: number; m15: number; h1: number; h4: number; h24: number };
  volumeChange: { h1: number; h4: number; h24: number };
  openInterestUsd: number;
  oiChange: { h1: number; h24: number };
  liquidation24hUsd: null;
  rsi: { m15: number; h1: number };
  stochastic: { k: number; d: number; signal: "BULLISH" | "BEARISH" | "WAIT" };
  ema15m: { ema9: number; ema21: number; alignment: "BULLISH" | "BEARISH" | "MIXED" };
  takerBuySellRatio: number | null;
  closedPrice: number;
  atr15m: number;
  extensionAtr: number;
  regime: {
    aligned: boolean;
    oneHourEma21: number;
    h4ChangePercent: number;
    h24ChangePercent: number;
  };
  breakout: {
    confirmed: boolean;
    kind: "RANGE_12H" | "TRENDLINE_12H" | "NONE";
    direction: HotVolumeDirection;
    level: number | null;
    distanceAtr: number;
    sourceClosedAt: string;
  };
  retest: {
    confirmed: boolean;
    touched: boolean;
    held: boolean;
    rejection: boolean;
    distanceAtr: number;
    sourceClosedAt: string;
  };
  direction: HotVolumeDirection;
  status: HotVolumeStatus;
  score: number;
  reasons: string[];
  closedAt: string;
};

export type HotVolumeReport = {
  schemaVersion: "hot-volume-radar-v1";
  mode: "SHADOW_ONLY";
  source: {
    market: "BINANCE_USDS_M";
    marketCap: "COINGECKO_KEYLESS" | "COINPAPRIKA_KEYLESS" | "COINLORE_KEYLESS" | "VERIFIED_STALE_CACHE";
    liquidation: "UNAVAILABLE";
    state: "HEALTHY" | "DEGRADED";
    reasons: string[];
  };
  rules: typeof HOT_VOLUME_RULES;
  summary: {
    scanned: number;
    returned: number;
    hot: number;
    long: number;
    short: number;
    ready: number;
    breakout: number;
    breakoutReady: number;
    chaseRisk: number;
  };
  candidates: HotVolumeCandidate[];
  generatedAt: string;
};

type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  quoteVolume: number;
  closeTime: number;
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

type BinanceBook = { symbol?: string; bidPrice?: string; askPrice?: string };
type BinancePremium = { symbol?: string; lastFundingRate?: string };
type CoinGeckoMarket = { symbol?: string; market_cap?: number | null; total_volume?: number | null };
type CoinPaprikaTicker = { symbol?: string; quotes?: { USD?: { market_cap?: number | null; volume_24h?: number | null } } };
type CoinLoreResponse = { data?: Array<{ symbol?: string; market_cap_usd?: string | number | null }> };
type OpenInterestPoint = { sumOpenInterestValue?: string; timestamp?: number };
type TakerPoint = { buySellRatio?: string; timestamp?: number };

type HotUniverseItem = {
  symbol: string;
  baseAsset: string;
  price: number;
  quoteVolume24h: number;
  marketCapUsd: number;
  fundingRate: number;
  spreadBps: number;
};

type ClassifiedInput = Omit<HotVolumeCandidate, "direction" | "status" | "score" | "reasons">;

type MarketCapSource = HotVolumeReport["source"]["marketCap"];
type MarketCapSnapshot = {
  expiresAt: number;
  staleUntil: number;
  bySymbol: Map<string, number>;
  source: MarketCapSource;
};

let marketCapCache: MarketCapSnapshot | null = null;

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number, digits = 4): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function parseKlines(rows: unknown[][]): Candle[] {
  const now = Date.now();
  return rows.flatMap((row) => {
    const candle: Candle = {
      openTime: number(row[0]),
      open: number(row[1]),
      high: number(row[2]),
      low: number(row[3]),
      close: number(row[4]),
      quoteVolume: number(row[7]),
      closeTime: number(row[6]),
    };
    return candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0 && candle.closeTime <= now
      ? [candle]
      : [];
  });
}

function percentChange(current: number, previous: number): number {
  return previous > 0 ? ((current - previous) / previous) * 100 : 0;
}

function priceChange(candles: Candle[], periods: number): number {
  const latest = candles.at(-1)?.close ?? 0;
  const previous = candles.at(-(periods + 1))?.close ?? candles.at(0)?.open ?? 0;
  return percentChange(latest, previous);
}

function sumVolume(candles: Candle[], startFromEnd: number, length: number): number {
  const end = Math.max(0, candles.length - startFromEnd);
  const start = Math.max(0, end - length);
  return candles.slice(start, end).reduce((sum, candle) => sum + candle.quoteVolume, 0);
}

function volumeWindowChange(candles: Candle[], periods: number): number {
  const current = sumVolume(candles, 0, periods);
  const previous = sumVolume(candles, periods, periods);
  return percentChange(current, previous);
}

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const multiplier = 2 / (period + 1);
  return values.slice(1).reduce((value, current) => (current - value) * multiplier + value, values[0]);
}

function rsi(candles: Candle[], period = 14): number {
  const closes = candles.map((candle) => candle.close);
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return gains > 0 ? 100 : 50;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function atr(candles: Candle[], period = 14): number {
  const sample = candles.slice(-(period + 1));
  if (sample.length < 2) return 0;
  const ranges = sample.slice(1).map((candle, index) => {
    const previousClose = sample[index].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 50;
}

function projectedRegressionLevel(values: number[]): { slope: number; projected: number } {
  if (values.length < 3) return { slope: 0, projected: values.at(-1) ?? 0 };
  const meanX = (values.length - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  const numerator = values.reduce((sum, value, index) => sum + (index - meanX) * (value - meanY), 0);
  const denominator = values.reduce((sum, _, index) => sum + (index - meanX) ** 2, 0);
  const slope = denominator > 0 ? numerator / denominator : 0;
  return { slope, projected: meanY + slope * (values.length - meanX) };
}

function stochastic(candles: Candle[]): HotVolumeCandidate["stochastic"] {
  const rawK = candles.map((candle, index) => {
    const window = candles.slice(Math.max(0, index - 4), index + 1);
    if (window.length < 5) return Number.NaN;
    const highest = Math.max(...window.map((item) => item.high));
    const lowest = Math.min(...window.map((item) => item.low));
    return highest > lowest ? ((candle.close - lowest) / (highest - lowest)) * 100 : 50;
  });
  const smoothK = rawK.map((_, index) => average(rawK.slice(Math.max(0, index - 2), index + 1).filter(Number.isFinite)));
  const smoothD = smoothK.map((_, index) => average(smoothK.slice(Math.max(0, index - 2), index + 1).filter(Number.isFinite)));
  const k = smoothK.at(-1) ?? 50;
  const d = smoothD.at(-1) ?? 50;
  const previousK = smoothK.at(-2) ?? k;
  const previousD = smoothD.at(-2) ?? d;
  const bullish = k > d && (previousK <= previousD || k <= 50);
  const bearish = k < d && (previousK >= previousD || k >= 50);
  return { k: round(k, 2), d: round(d, 2), signal: bullish ? "BULLISH" : bearish ? "BEARISH" : "WAIT" };
}

export function classifyHotVolume(input: ClassifiedInput): Pick<HotVolumeCandidate, "direction" | "status" | "score" | "reasons"> {
  const direction: HotVolumeDirection = input.breakout.direction !== "NEUTRAL"
    ? input.breakout.direction
    : input.priceChange.h1 > 0.15 ? "LONG" : input.priceChange.h1 < -0.15 ? "SHORT" : "NEUTRAL";
  const volumeHot = input.volumeChange.h1 >= HOT_VOLUME_RULES.minimumVolumeChange1hPct;
  const oiBuilding = input.oiChange.h1 > 0;
  const takerAligned = direction === "LONG"
    ? (input.takerBuySellRatio ?? 1) >= 1
    : direction === "SHORT" ? (input.takerBuySellRatio ?? 1) <= 1 : false;
  const emaAligned = input.ema15m.alignment === (direction === "LONG" ? "BULLISH" : direction === "SHORT" ? "BEARISH" : "MIXED");
  const triggerAligned = input.stochastic.signal === (direction === "LONG" ? "BULLISH" : direction === "SHORT" ? "BEARISH" : "WAIT");
  const momentumNotExhausted = direction === "LONG"
    ? input.rsi.m15 >= 45 && input.rsi.m15 <= 68 && input.rsi.h1 <= 72
    : direction === "SHORT" ? input.rsi.m15 >= 32 && input.rsi.m15 <= 55 && input.rsi.h1 >= 28 : false;
  const chase = Math.abs(input.priceChange.h1) > 4 || input.extensionAtr > HOT_VOLUME_RULES.maximumExtensionAtr;
  const spreadSafe = input.spreadBps <= HOT_VOLUME_RULES.maximumSpreadBps;
  const squeeze = volumeHot && direction === "LONG" && input.oiChange.h1 < 0;
  const liquidationRisk = volumeHot && direction === "SHORT" && input.oiChange.h1 < 0;
  const higherTimeframeAligned = direction === "LONG" ? input.priceChange.h4 > 0 : direction === "SHORT" ? input.priceChange.h4 < 0 : false;

  let score = 0;
  if (input.volumeUsd.h1 >= 1_000_000) score += 12;
  else if (input.volumeUsd.h1 >= 100_000) score += 7;
  if (input.volumeChange.h1 >= 100) score += 26;
  else if (input.volumeChange.h1 >= 50) score += 20;
  else if (volumeHot) score += 13;
  if (direction !== "NEUTRAL") score += 10;
  if (oiBuilding) score += 15;
  if (takerAligned) score += 10;
  if (emaAligned) score += 10;
  if (triggerAligned) score += 12;
  if (spreadSafe) score += 5;
  if (input.breakout.confirmed) score += 10;
  if (input.retest.confirmed) score += 12;
  if (input.regime.aligned) score += 8;
  if (momentumNotExhausted) score += 6;
  const qualityBeforeChase = score;
  if (chase) score -= 25;
  score = Math.max(0, Math.min(100, score));

  const breakoutQuality = input.breakout.confirmed
    && volumeHot
    && input.volumeUsd.h1 >= 500_000
    && direction !== "NEUTRAL"
    && oiBuilding
    && takerAligned
    && emaAligned
    && higherTimeframeAligned
    && input.regime.aligned
    && input.retest.confirmed
    && triggerAligned
    && momentumNotExhausted
    && spreadSafe
    && qualityBeforeChase >= 85;

  let status: HotVolumeStatus = "HEATING";
  if (breakoutQuality && !chase) status = "BREAKOUT_READY";
  else if (chase && volumeHot) status = "CHASE_RISK";
  else if (input.breakout.confirmed && volumeHot && direction !== "NEUTRAL") status = "BREAKOUT_CONFIRMED";
  else if (squeeze) status = "SQUEEZE";
  else if (liquidationRisk) status = "LIQUIDATION_RISK";
  else if (!volumeHot) status = "WAIT_PULLBACK";
  else if (direction === "LONG" && oiBuilding && takerAligned) status = emaAligned && triggerAligned && spreadSafe && score >= 70 ? "READY" : "LONG_PRESSURE";
  else if (direction === "SHORT" && oiBuilding && takerAligned) status = emaAligned && triggerAligned && spreadSafe && score >= 70 ? "READY" : "SHORT_PRESSURE";
  else if (direction !== "NEUTRAL") status = "WAIT_PULLBACK";

  const reasons = [
    `Volume 1H ${input.volumeChange.h1 >= 0 ? "+" : ""}${input.volumeChange.h1.toFixed(1)}% · $${Math.round(input.volumeUsd.h1).toLocaleString("en-US")}`,
    `Harga 1H ${input.priceChange.h1 >= 0 ? "+" : ""}${input.priceChange.h1.toFixed(2)}% · OI 1H ${input.oiChange.h1 >= 0 ? "+" : ""}${input.oiChange.h1.toFixed(2)}%`,
    `Taker ${input.takerBuySellRatio?.toFixed(2) ?? "—"} · EMA15 ${input.ema15m.alignment} · Stoch ${input.stochastic.signal}`,
    input.breakout.confirmed
      ? `Breakout ${input.breakout.kind.replaceAll("_", " ")} · level ${input.breakout.level?.toPrecision(6) ?? "—"} · ${input.breakout.distanceAtr.toFixed(2)} ATR`
      : "Breakout struktur 12H belum terkonfirmasi",
    input.retest.confirmed
      ? `Retest 15m hold + rejection · ${input.retest.distanceAtr.toFixed(2)} ATR dari level`
      : "Retest 15m belum hold + rejection",
    input.regime.aligned
      ? `Regime searah · 4H ${input.regime.h4ChangePercent >= 0 ? "+" : ""}${input.regime.h4ChangePercent.toFixed(2)}% · 24H ${input.regime.h24ChangePercent >= 0 ? "+" : ""}${input.regime.h24ChangePercent.toFixed(2)}%`
      : "Regime 4H/24H/EMA21 1H belum searah",
    momentumNotExhausted ? "Momentum belum exhaustion" : `Exhaustion gate gagal · RSI15 ${input.rsi.m15.toFixed(1)} · RSI1H ${input.rsi.h1.toFixed(1)}`,
    chase ? `Anti-chase aktif · extension ${input.extensionAtr.toFixed(2)} ATR` : `Lokasi terkendali · extension ${input.extensionAtr.toFixed(2)} ATR`,
  ];
  return { direction, status, score, reasons };
}

async function concurrentMap<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R | null>): Promise<R[]> {
  const output: R[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      const result = await task(item).catch(() => null);
      if (result !== null) output.push(result);
    }
  }));
  return output;
}

function marketCapMap(rows: Array<{ symbol?: string; marketCap?: number | null }>): Map<string, number> {
  const bySymbol = new Map<string, number>();
  rows.forEach((row) => {
    const symbol = String(row.symbol ?? "").toUpperCase();
    const cap = number(row.marketCap);
    if (!symbol || cap <= 0) return;
    if (cap > (bySymbol.get(symbol) ?? 0)) bySymbol.set(symbol, cap);
  });
  return bySymbol;
}

function cachedMarketCaps(bySymbol: Map<string, number>, source: MarketCapSource): MarketCapSnapshot {
  return {
    expiresAt: Date.now() + 15 * 60_000,
    staleUntil: Date.now() + 6 * 60 * 60_000,
    bySymbol,
    source,
  };
}

async function marketCaps(): Promise<MarketCapSnapshot> {
  if (marketCapCache && marketCapCache.expiresAt > Date.now()) return marketCapCache;
  const pages = await Promise.allSettled([1, 2].map((page) => fetchJson<CoinGeckoMarket[]>(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=${page}&sparkline=false`,
  )));
  const rows = pages.flatMap((page) => page.status === "fulfilled" ? page.value : []);
  const coinGeckoCaps = marketCapMap(rows.map((row) => ({ symbol: row.symbol, marketCap: row.market_cap })));
  if (coinGeckoCaps.size) {
    marketCapCache = cachedMarketCaps(coinGeckoCaps, "COINGECKO_KEYLESS");
    return marketCapCache;
  }
  try {
    const paprika = await fetchJson<CoinPaprikaTicker[]>("https://api.coinpaprika.com/v1/tickers?quotes=USD");
    const paprikaCaps = marketCapMap(paprika.map((row) => ({ symbol: row.symbol, marketCap: row.quotes?.USD?.market_cap })));
    if (paprikaCaps.size) {
      marketCapCache = cachedMarketCaps(paprikaCaps, "COINPAPRIKA_KEYLESS");
      return marketCapCache;
    }
  } catch {
    // Continue to the smaller paginated fallback before considering stale data.
  }
  try {
    const coinLoreRows: CoinLoreResponse["data"] = [];
    for (const start of [0, 100, 200, 300, 400]) {
      const page = await fetchJson<CoinLoreResponse>(`https://api.coinlore.net/api/tickers/?start=${start}&limit=100`);
      coinLoreRows.push(...(page.data ?? []));
    }
    const coinLoreCaps = marketCapMap(coinLoreRows.map((row) => ({ symbol: row.symbol, marketCap: number(row.market_cap_usd) })));
    if (coinLoreCaps.size) {
      marketCapCache = cachedMarketCaps(coinLoreCaps, "COINLORE_KEYLESS");
      return marketCapCache;
    }
  } catch {
    // A verified stale snapshot is safer than inventing a market cap or returning zero.
  }
  if (marketCapCache && marketCapCache.staleUntil > Date.now() && marketCapCache.bySymbol.size) {
    return { ...marketCapCache, source: "VERIFIED_STALE_CACHE" };
  }
  throw new Error("Market cap providers unavailable");
}

function capForAsset(bySymbol: Map<string, number>, baseAsset: string): number {
  return bySymbol.get(baseAsset) ?? (baseAsset.startsWith("1000") ? bySymbol.get(baseAsset.slice(4)) : undefined) ?? 0;
}

async function loadUniverse(): Promise<{ items: HotUniverseItem[]; marketCapSource: MarketCapSource }> {
  const [exchange, tickers, books, premiums, caps] = await Promise.all([
    fetchBinanceJson<{ symbols?: BinanceSymbol[] }>("/fapi/v1/exchangeInfo"),
    fetchBinanceJson<BinanceTicker[]>("/fapi/v1/ticker/24hr"),
    fetchBinanceJson<BinanceBook[]>("/fapi/v1/ticker/bookTicker"),
    fetchBinanceJson<BinancePremium[]>("/fapi/v1/premiumIndex"),
    marketCaps(),
  ]);
  const tickerBySymbol = new Map(tickers.map((row) => [row.symbol, row]));
  const bookBySymbol = new Map(books.map((row) => [row.symbol, row]));
  const premiumBySymbol = new Map(premiums.map((row) => [row.symbol, row]));
  const items = (exchange.symbols ?? []).flatMap((row) => {
    if (row.status !== "TRADING" || row.contractType !== "PERPETUAL" || row.quoteAsset !== "USDT" || !row.symbol || !row.baseAsset) return [];
    const ticker = tickerBySymbol.get(row.symbol);
    const book = bookBySymbol.get(row.symbol);
    const price = number(ticker?.lastPrice);
    const volume = number(ticker?.quoteVolume);
    const cap = capForAsset(caps.bySymbol, row.baseAsset);
    const bid = number(book?.bidPrice);
    const ask = number(book?.askPrice);
    const midpoint = (bid + ask) / 2;
    if (price <= 0 || volume < HOT_VOLUME_RULES.minimumVolume24hUsd || cap < HOT_VOLUME_RULES.minimumMarketCapUsd || cap > HOT_VOLUME_RULES.maximumMarketCapUsd) return [];
    return [{
      symbol: row.symbol,
      baseAsset: row.baseAsset,
      price,
      quoteVolume24h: volume,
      marketCapUsd: cap,
      fundingRate: number(premiumBySymbol.get(row.symbol)?.lastFundingRate),
      spreadBps: midpoint > 0 ? ((ask - bid) / midpoint) * 10_000 : 99_999,
    }];
  }).sort((left, right) => right.quoteVolume24h - left.quoteVolume24h).slice(0, HOT_VOLUME_RULES.prefilterLimit);
  return { items, marketCapSource: caps.source };
}

async function loadOneHour(item: HotUniverseItem): Promise<{ item: HotUniverseItem; candles: Candle[]; volumeChange1h: number } | null> {
  const rows = await fetchBinanceJson<unknown[][]>(`/fapi/v1/klines?symbol=${encodeURIComponent(item.symbol)}&interval=1h&limit=170`);
  const candles = parseKlines(rows);
  if (candles.length < 50) return null;
  return { item, candles, volumeChange1h: volumeWindowChange(candles, 1) };
}

async function analyze(item: HotUniverseItem, oneHour: Candle[]): Promise<HotVolumeCandidate | null> {
  const encoded = encodeURIComponent(item.symbol);
  const [fiveRows, fifteenRows, oiRows, takerRows] = await Promise.all([
    fetchBinanceJson<unknown[][]>(`/fapi/v1/klines?symbol=${encoded}&interval=5m&limit=12`),
    fetchBinanceJson<unknown[][]>(`/fapi/v1/klines?symbol=${encoded}&interval=15m&limit=40`),
    fetchBinanceJson<OpenInterestPoint[]>(`/futures/data/openInterestHist?symbol=${encoded}&period=1h&limit=25`),
    fetchBinanceJson<TakerPoint[]>(`/futures/data/takerlongshortRatio?symbol=${encoded}&period=1h&limit=2`),
  ]);
  const five = parseKlines(fiveRows);
  const fifteen = parseKlines(fifteenRows);
  if (five.length < 7 || fifteen.length < 25 || oneHour.length < 50) return null;
  const oi = oiRows.map((row) => number(row.sumOpenInterestValue)).filter((value) => value > 0);
  const latestOi = oi.at(-1) ?? 0;
  const priorOi = oi.at(-2) ?? latestOi;
  const dayPriorOi = oi.at(-25) ?? oi.at(0) ?? latestOi;
  const fifteenCloses = fifteen.map((candle) => candle.close);
  const ema9 = ema(fifteenCloses, 9);
  const ema21 = ema(fifteenCloses, 21);
  const latestClose = fifteen.at(-1)?.close ?? item.price;
  const currentAtr = atr(fifteen);
  const latestOneHour = oneHour.at(-1)!;
  const previousOneHour = oneHour.at(-2)!;
  const currentStructure = oneHour.slice(-13, -1);
  const previousStructure = oneHour.slice(-14, -2);
  const oneHourChange = round(priceChange(oneHour, 1));
  const previousOneHourChange = round(priceChange(oneHour.slice(0, -1), 1));
  const currentDirection: HotVolumeDirection = oneHourChange > 0.15 ? "LONG" : oneHourChange < -0.15 ? "SHORT" : "NEUTRAL";
  const previousDirection: HotVolumeDirection = previousOneHourChange > 0.15 ? "LONG" : previousOneHourChange < -0.15 ? "SHORT" : "NEUTRAL";
  const detectBreakout = (candle: Candle, structureWindow: Candle[], direction: HotVolumeDirection) => {
    const rangeHigh = Math.max(...structureWindow.map((item) => item.high));
    const rangeLow = Math.min(...structureWindow.map((item) => item.low));
    const highTrendline = projectedRegressionLevel(structureWindow.map((item) => item.high));
    const lowTrendline = projectedRegressionLevel(structureWindow.map((item) => item.low));
    const rangeBroken = direction === "LONG" ? candle.close > rangeHigh : direction === "SHORT" ? candle.close < rangeLow : false;
    const trendlineBroken = direction === "LONG"
      ? highTrendline.slope < 0 && candle.close > highTrendline.projected
      : direction === "SHORT" ? lowTrendline.slope > 0 && candle.close < lowTrendline.projected : false;
    return {
      confirmed: rangeBroken || trendlineBroken,
      kind: rangeBroken ? "RANGE_12H" as const : trendlineBroken ? "TRENDLINE_12H" as const : "NONE" as const,
      level: rangeBroken ? (direction === "LONG" ? rangeHigh : rangeLow) : trendlineBroken ? (direction === "LONG" ? highTrendline.projected : lowTrendline.projected) : null,
    };
  };
  const previousBreakout = detectBreakout(previousOneHour, previousStructure, previousDirection);
  const currentBreakout = detectBreakout(latestOneHour, currentStructure, currentDirection);
  const breakoutCandle = previousBreakout.confirmed ? previousOneHour : latestOneHour;
  const breakoutDirection = previousBreakout.confirmed ? previousDirection : currentDirection;
  const selectedBreakout = previousBreakout.confirmed ? previousBreakout : currentBreakout;
  const breakoutLevel = selectedBreakout.level;
  const breakoutDistanceAtr = breakoutLevel !== null && currentAtr > 0 ? Math.abs(latestOneHour.close - breakoutLevel) / currentAtr : 0;
  const latestFifteen = fifteen.at(-1)!;
  const retestDistanceAtr = breakoutLevel !== null && currentAtr > 0 ? Math.abs(latestFifteen.close - breakoutLevel) / currentAtr : 99;
  const body = Math.abs(latestFifteen.close - latestFifteen.open);
  const lowerWick = Math.min(latestFifteen.open, latestFifteen.close) - latestFifteen.low;
  const upperWick = latestFifteen.high - Math.max(latestFifteen.open, latestFifteen.close);
  const retestTouched = previousBreakout.confirmed && breakoutLevel !== null && currentAtr > 0 && (breakoutDirection === "LONG"
    ? latestFifteen.low <= breakoutLevel + currentAtr * 0.25 && latestFifteen.low >= breakoutLevel - currentAtr * 0.35
    : breakoutDirection === "SHORT" ? latestFifteen.high >= breakoutLevel - currentAtr * 0.25 && latestFifteen.high <= breakoutLevel + currentAtr * 0.35 : false);
  const retestHeld = breakoutLevel !== null && (breakoutDirection === "LONG" ? latestFifteen.close > breakoutLevel : breakoutDirection === "SHORT" ? latestFifteen.close < breakoutLevel : false);
  const retestRejection = breakoutDirection === "LONG"
    ? latestFifteen.close > latestFifteen.open && lowerWick >= Math.max(body * 0.25, currentAtr * 0.05)
    : breakoutDirection === "SHORT" ? latestFifteen.close < latestFifteen.open && upperWick >= Math.max(body * 0.25, currentAtr * 0.05) : false;
  const h4ChangePercent = round(priceChange(oneHour, 4));
  const h24ChangePercent = round(priceChange(oneHour, 24));
  const oneHourEma21 = ema(oneHour.map((candle) => candle.close), 21);
  const regimeAligned = breakoutDirection === "LONG"
    ? h4ChangePercent > 0 && h24ChangePercent > 0 && latestOneHour.close >= oneHourEma21
    : breakoutDirection === "SHORT" ? h4ChangePercent < 0 && h24ChangePercent < 0 && latestOneHour.close <= oneHourEma21 : false;
  const base: ClassifiedInput = {
    symbol: item.symbol,
    baseAsset: item.baseAsset,
    price: item.price,
    marketCapUsd: item.marketCapUsd,
    fundingRate: item.fundingRate,
    spreadBps: item.spreadBps,
    priceChange: {
      m5: round(priceChange(five, 1)),
      m15: round(priceChange(fifteen, 1)),
      h1: oneHourChange,
      h4: h4ChangePercent,
      h24: h24ChangePercent,
      d7: round(priceChange(oneHour, 168)),
    },
    volumeUsd: {
      m5: round(sumVolume(five, 0, 1), 2),
      m15: round(sumVolume(fifteen, 0, 1), 2),
      h1: round(sumVolume(oneHour, 0, 1), 2),
      h4: round(sumVolume(oneHour, 0, 4), 2),
      h24: round(sumVolume(oneHour, 0, 24), 2),
    },
    volumeChange: {
      h1: round(volumeWindowChange(oneHour, 1), 2),
      h4: round(volumeWindowChange(oneHour, 4), 2),
      h24: round(volumeWindowChange(oneHour, 24), 2),
    },
    openInterestUsd: round(latestOi, 2),
    oiChange: { h1: round(percentChange(latestOi, priorOi)), h24: round(percentChange(latestOi, dayPriorOi)) },
    liquidation24hUsd: null,
    rsi: { m15: round(rsi(fifteen), 2), h1: round(rsi(oneHour), 2) },
    stochastic: stochastic(fifteen),
    ema15m: { ema9: round(ema9), ema21: round(ema21), alignment: ema9 > ema21 ? "BULLISH" : ema9 < ema21 ? "BEARISH" : "MIXED" },
    takerBuySellRatio: takerRows.length ? round(number(takerRows.at(-1)?.buySellRatio), 3) : null,
    closedPrice: round(latestClose),
    atr15m: round(currentAtr),
    extensionAtr: round(currentAtr > 0 ? Math.abs(latestClose - ema21) / currentAtr : 99, 3),
    regime: {
      aligned: regimeAligned,
      oneHourEma21: round(oneHourEma21),
      h4ChangePercent,
      h24ChangePercent,
    },
    breakout: {
      confirmed: selectedBreakout.confirmed,
      kind: selectedBreakout.kind,
      direction: breakoutDirection,
      level: breakoutLevel === null ? null : round(breakoutLevel, 8),
      distanceAtr: round(breakoutDistanceAtr, 3),
      sourceClosedAt: new Date(breakoutCandle.closeTime).toISOString(),
    },
    retest: {
      confirmed: retestTouched && retestHeld && retestRejection && retestDistanceAtr <= 0.9,
      touched: retestTouched,
      held: retestHeld,
      rejection: retestRejection,
      distanceAtr: round(retestDistanceAtr, 3),
      sourceClosedAt: new Date(latestFifteen.closeTime).toISOString(),
    },
    closedAt: new Date(fifteen.at(-1)!.closeTime).toISOString(),
  };
  return { ...base, ...classifyHotVolume(base) };
}

export async function loadHotVolumeReport(): Promise<HotVolumeReport> {
  const generatedAt = new Date().toISOString();
  const reasons: string[] = [];
  let universe: HotUniverseItem[] = [];
  let marketCapSource: MarketCapSource = "COINGECKO_KEYLESS";
  try {
    const loaded = await loadUniverse();
    universe = loaded.items;
    marketCapSource = loaded.marketCapSource;
    if (marketCapSource === "VERIFIED_STALE_CACHE") reasons.push("Market cap live unavailable; memakai cache terverifikasi maksimal 6 jam.");
  } catch (error) {
    return {
      schemaVersion: "hot-volume-radar-v1",
      mode: "SHADOW_ONLY",
      source: { market: "BINANCE_USDS_M", marketCap: marketCapSource, liquidation: "UNAVAILABLE", state: "DEGRADED", reasons: [error instanceof Error ? error.message : "Provider unavailable"] },
      rules: HOT_VOLUME_RULES,
      summary: { scanned: 0, returned: 0, hot: 0, long: 0, short: 0, ready: 0, breakout: 0, breakoutReady: 0, chaseRisk: 0 },
      candidates: [],
      generatedAt,
    };
  }
  const oneHour = await concurrentMap(universe, 6, loadOneHour);
  const oneHourCoverage = universe.length ? oneHour.length / universe.length : 0;
  if (oneHour.length < universe.length) reasons.push(`${universe.length - oneHour.length} pair gagal memuat closed candle 1H; kandidat lengkap tetap diproses.`);
  const ranked = oneHour
    .sort((left, right) => right.volumeChange1h - left.volumeChange1h || right.item.quoteVolume24h - left.item.quoteVolume24h)
    .slice(0, HOT_VOLUME_RULES.resultLimit);
  const candidates = await concurrentMap(ranked, 4, (entry) => analyze(entry.item, entry.candles));
  const detailCoverage = ranked.length ? candidates.length / ranked.length : 0;
  if (candidates.length < ranked.length) reasons.push(`${ranked.length - candidates.length} pair gagal memuat konfirmasi detail; kandidat tersebut dikeluarkan.`);
  const statusPriority: Record<HotVolumeStatus, number> = { BREAKOUT_READY: 0, BREAKOUT_CONFIRMED: 1, READY: 2, LONG_PRESSURE: 3, SHORT_PRESSURE: 3, HEATING: 4, WAIT_PULLBACK: 5, SQUEEZE: 6, LIQUIDATION_RISK: 6, CHASE_RISK: 7 };
  candidates.sort((left, right) => statusPriority[left.status] - statusPriority[right.status] || right.score - left.score || right.volumeChange.h1 - left.volumeChange.h1);
  return {
    schemaVersion: "hot-volume-radar-v1",
    mode: "SHADOW_ONLY",
    source: {
      market: "BINANCE_USDS_M",
      marketCap: marketCapSource,
      liquidation: "UNAVAILABLE",
      state: marketCapSource === "VERIFIED_STALE_CACHE" || oneHourCoverage < 0.8 || detailCoverage < 0.8 || candidates.length === 0 ? "DEGRADED" : "HEALTHY",
      reasons,
    },
    rules: HOT_VOLUME_RULES,
    summary: {
      scanned: universe.length,
      returned: candidates.length,
      hot: candidates.filter((item) => item.volumeChange.h1 >= HOT_VOLUME_RULES.minimumVolumeChange1hPct).length,
      long: candidates.filter((item) => item.direction === "LONG").length,
      short: candidates.filter((item) => item.direction === "SHORT").length,
      ready: candidates.filter((item) => item.status === "READY" || item.status === "BREAKOUT_READY").length,
      breakout: candidates.filter((item) => item.breakout.confirmed).length,
      breakoutReady: candidates.filter((item) => item.status === "BREAKOUT_READY").length,
      chaseRisk: candidates.filter((item) => item.status === "CHASE_RISK" || item.status === "BREAKOUT_CONFIRMED").length,
    },
    candidates,
    generatedAt,
  };
}
