import { fetchJson } from "@/lib/market";

export type ProviderState = "healthy" | "degraded" | "disabled";
export type UsdBias = "GOOD USD" | "BAD USD" | "NEUTRAL";
export type DirectionalBias = "BULLISH" | "BEARISH" | "NEUTRAL";
export type MarketImpact = "POSITIVE CRYPTO/USDT" | "NEGATIVE CRYPTO/USDT" | "NEUTRAL";
export type FreshnessState = "FRESH" | "AGING" | "STALE";
export type SourceTier = "OFFICIAL" | "ESTABLISHED" | "AGGREGATOR" | "UNKNOWN";

export type IntelQualitySummary = {
  schemaVersion: "intel-v2";
  totalObserved: number;
  accepted: number;
  duplicatesRemoved: number;
  fresh: number;
  aging: number;
  stale: number;
  reliable: number;
};

export type ContextInput = { symbol: string; direction: "LONG" | "SHORT" };
export type ContextItem = {
  adjustment: number;
  newsAdjustment: number;
  catalysts: string[];
};

export type NewsContextItem = {
  headline: string;
  publisher: string;
  publishedAt: string;
  url: string;
  relatedAssets: string[];
  riskKeywords: string[];
  usdBias: UsdBias;
  usdScore: number;
  cryptoBias: DirectionalBias;
  marketImpact: MarketImpact;
  impactReason: string;
  impactConfidence: "HIGH" | "MEDIUM" | "LOW";
  freshness: FreshnessState;
  ageMinutes: number;
  sourceTier: SourceTier;
  sourceReliability: number;
  sourceDomain: string;
  sourceDomains: string[];
  corroborationCount: number;
  independentSourceCount: number;
  normalizedKey: string;
  evidenceHash: string;
  classificationVersion: "intel-v2-rules";
};

export type PredictionMarketItem = {
  question: string;
  probability: number;
  outcome: string;
  volume24h: number;
  liquidity: number;
  endDate: string | null;
  sourceUrl: string;
  relatedAssets: string[];
  category: "CRYPTO" | "MACRO";
  change24h: number | null;
};

export type FearGreedContext = {
  state: ProviderState;
  value: number | null;
  classification: string;
  previousValue: number | null;
  updatedAt: string | null;
  sourceUrl: string;
};

export type MacroMetric = {
  id: string;
  label: string;
  value: number;
  change: number | null;
  unit: string;
  observedAt: string;
};

export type MacroContext = {
  state: ProviderState;
  regime: "RISK-ON" | "RISK-OFF" | "MIXED" | "UNAVAILABLE";
  metrics: MacroMetric[];
  reasons: string[];
  sourceUrl: string;
  sourceMode: "api" | "public_csv" | null;
};

export type EconomicEvent = {
  name: string;
  eventDate: string;
  scheduledAt: string | null;
  impact: "HIGH";
  source: string;
};

export type ArkhamFlowItem = {
  asset: string;
  inflowUsd: number;
  outflowUsd: number;
  netFlowUsd: number;
  bias: "ACCUMULATION" | "DISTRIBUTION" | "NEUTRAL";
  sourceUrl: string;
};

export type IntelligenceContext = {
  context: Record<string, ContextItem>;
  news: {
    state: ProviderState;
    items: NewsContextItem[];
    updatedAt: string | null;
    reason: string | null;
    quality: IntelQualitySummary;
  };
  fearGreed: FearGreedContext;
  macro: MacroContext;
  events: {
    state: ProviderState;
    items: EconomicEvent[];
    blackout: { active: boolean; event: string | null; until: string | null };
    lastVerifiedAt: string;
    reason: string | null;
  };
  arkham: {
    state: ProviderState;
    items: ArkhamFlowItem[];
    updatedAt: string | null;
    reason: string | null;
    sourceUrl: string;
  };
  predictionMarkets: {
    state: ProviderState;
    items: PredictionMarketItem[];
    updatedAt: string | null;
    reason: string | null;
    sourceUrl: string;
  };
  generatedAt: string;
};

const POSITIVE_CRYPTO = [
  "approval",
  "approved",
  "inflow",
  "adoption",
  "upgrade",
  "partnership",
  "surge",
  "rally",
  "breakout",
  "accumulation",
];
const NEGATIVE_CRYPTO = [
  "hack",
  "exploit",
  "outflow",
  "crackdown",
  "ban",
  "lawsuit",
  "liquidation",
  "breach",
  "delisting",
  "outage",
];
const RISK_KEYWORDS = [
  "SEC",
  "ETF",
  "REGULATION",
  "LAWSUIT",
  "HACK",
  "EXPLOIT",
  "BANKRUPTCY",
  "DELISTING",
  "OUTAGE",
  "FOMC",
  "CPI",
];
const NEWS_JSON = "https://cryptocurrency.cv/api/news";
const NEWS_RSS = [
  "https://www.coindesk.com/arc/outboundfeeds/rss/",
  "https://cointelegraph.com/rss",
] as const;
const FNG_URL = "https://api.alternative.me/fng/?limit=2&format=json";
const BLS_CALENDAR_URL = "https://www.bls.gov/schedule/news_release/bls.ics";
const POLYMARKET_EVENTS_URL = "https://gamma-api.polymarket.com/events?active=true&closed=false&order=volume_24hr&ascending=false&limit=100";
const POLYMARKET_SOURCE_URL = "https://polymarket.com/";
const ARKHAM_API_URL = "https://api.arkm.com/token/top";
const ARKHAM_SOURCE_URL = "https://arkm.com/";
const cache = new Map<string, { expiresAt: number; value: unknown }>();

const EMPTY_INTEL_QUALITY: IntelQualitySummary = {
  schemaVersion: "intel-v2",
  totalObserved: 0,
  accepted: 0,
  duplicatesRemoved: 0,
  fresh: 0,
  aging: 0,
  stale: 0,
  reliable: 0,
};

async function memo<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const stored = cache.get(key);
  if (stored && stored.expiresAt > Date.now()) return stored.value as T;
  const value = await loader();
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim();
}

function safeUrl(value: unknown): string | null {
  try {
    const parsed = new URL(String(value));
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_|source$|campaign$|fbclid$|gclid$)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return null;
  }
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "unknown";
  }
}

function freshnessAt(publishedAt: string, now = Date.now()): { state: FreshnessState; ageMinutes: number } {
  const ageMinutes = Math.max(0, Math.round((now - Date.parse(publishedAt)) / 60_000));
  return {
    state: ageMinutes <= 180 ? "FRESH" : ageMinutes <= 720 ? "AGING" : "STALE",
    ageMinutes,
  };
}

function normalizedEvidenceKey(value: string): string {
  const stopWords = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "is", "of", "on", "the", "to", "with"]);
  return decodeEntities(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9$]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token))
    .join(" ")
    .trim();
}

function tokenSimilarity(left: string, right: string): number {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

function newsSourceQuality(url: string, publisher: string): { tier: SourceTier; score: number } {
  const domain = sourceDomain(url);
  const publisherKey = publisher.toLowerCase();
  const officialDomains = [
    "sec.gov", "federalreserve.gov", "bls.gov", "bea.gov", "treasury.gov",
    "binance.com", "coinbase.com", "kraken.com", "ethereum.org", "solana.com",
  ];
  const establishedDomains = [
    "reuters.com", "bloomberg.com", "coindesk.com", "cointelegraph.com", "theblock.co", "decrypt.co",
  ];
  if (officialDomains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`))) {
    return { tier: "OFFICIAL", score: 95 };
  }
  if (establishedDomains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`)) ||
      /\b(reuters|bloomberg|coindesk|cointelegraph|the block|decrypt)\b/.test(publisherKey)) {
    return { tier: "ESTABLISHED", score: 78 };
  }
  if (domain === "cryptocurrency.cv" || /aggregator/i.test(publisherKey)) {
    return { tier: "AGGREGATOR", score: 52 };
  }
  return { tier: "UNKNOWN", score: 35 };
}

async function evidenceHash(payload: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
    return `sha256:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  let hash = 0x811c9dc5;
  for (const value of encoded) hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  return `fnv1a:${hash.toString(16).padStart(8, "0")}`;
}

function safeDate(value: unknown): string | null {
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function countWords(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  return words.filter((word) => lower.includes(word)).length;
}

function cryptoBias(text: string): DirectionalBias {
  const score = countWords(text, POSITIVE_CRYPTO) - countWords(text, NEGATIVE_CRYPTO);
  return score > 0 ? "BULLISH" : score < 0 ? "BEARISH" : "NEUTRAL";
}

const GOOD_USD_RULES: Array<[RegExp, number]> = [
  [/\b(hawkish|higher for longer)\b/i, 35],
  [/\b(rate hike|raises? (?:interest )?rates?)\b/i, 40],
  [/\b(hot(?:ter)? inflation|inflation (?:accelerates|rises)|cpi (?:beats|above))\b/i, 35],
  [/\b(strong(?:er)? jobs|payrolls? (?:beat|surge)|unemployment (?:falls|drops))\b/i, 30],
  [/\b(gdp (?:beats|surges)|retail sales (?:beat|rise)|economy (?:strong|accelerates))\b/i, 25],
  [/\b(treasury yields?|bond yields?) (?:rise|jump|surge|climb)\b/i, 20],
  [/\b(dollar|dxy) (?:rises?|jumps?|surges?|strengthens?)\b/i, 25],
];
const BAD_USD_RULES: Array<[RegExp, number]> = [
  [/\b(dovish|policy easing)\b/i, -35],
  [/\b(rate cut|cuts? (?:interest )?rates?)\b/i, -40],
  [/\b(cool(?:er|ing)? inflation|inflation (?:slows|eases)|cpi (?:misses|below))\b/i, -35],
  [/\b(weak(?:er)? jobs|payrolls? (?:miss|fall)|unemployment (?:rises|jumps))\b/i, -30],
  [/\b(gdp (?:misses|contracts)|retail sales (?:miss|fall)|recession)\b/i, -25],
  [/\b(treasury yields?|bond yields?) (?:fall|drop|slide|decline)\b/i, -20],
  [/\b(dollar|dxy) (?:falls?|drops?|slides?|weakens?)\b/i, -25],
];

function usdBias(text: string): { bias: UsdBias; score: number } {
  const score = Math.max(
    -100,
    Math.min(
      100,
      [...GOOD_USD_RULES, ...BAD_USD_RULES].reduce(
        (sum, [pattern, points]) => sum + (pattern.test(text) ? points : 0),
        0,
      ),
    ),
  );
  return { bias: score >= 20 ? "GOOD USD" : score <= -20 ? "BAD USD" : "NEUTRAL", score };
}

function marketImpact(
  directBias: DirectionalBias,
  macroBias: UsdBias,
): Pick<NewsContextItem, "marketImpact" | "impactReason" | "impactConfidence"> {
  if (directBias === "BULLISH") {
    return {
      marketImpact: "POSITIVE CRYPTO/USDT",
      impactReason: "Headline memuat katalis positif crypto.",
      impactConfidence: "HIGH",
    };
  }
  if (directBias === "BEARISH") {
    return {
      marketImpact: "NEGATIVE CRYPTO/USDT",
      impactReason: "Headline memuat risiko negatif crypto.",
      impactConfidence: "HIGH",
    };
  }
  if (macroBias === "GOOD USD") {
    return {
      marketImpact: "NEGATIVE CRYPTO/USDT",
      impactReason: "Estimasi: USD menguat dapat menekan aset berisiko.",
      impactConfidence: "MEDIUM",
    };
  }
  if (macroBias === "BAD USD") {
    return {
      marketImpact: "POSITIVE CRYPTO/USDT",
      impactReason: "Estimasi: USD melemah dapat mendukung aset berisiko.",
      impactConfidence: "MEDIUM",
    };
  }
  return {
    marketImpact: "NEUTRAL",
    impactReason: "Headline belum memberi arah Crypto/USDT yang cukup jelas.",
    impactConfidence: "LOW",
  };
}

function extractAssets(text: string, symbols: string[]): string[] {
  const eligible = new Set(symbols.map((symbol) => symbol.replace(/USDT$/, "").toUpperCase()));
  const upper = text.toUpperCase();
  const result: string[] = [];
  const cashtags = [...upper.matchAll(/\$([A-Z0-9]{1,20})\b/g)].map((match) => match[1]);
  for (const asset of eligible) {
    const aliases =
      asset === "BTC" ? ["BTC", "BITCOIN"] :
        asset === "ETH" ? ["ETH", "ETHEREUM"] :
          asset === "SOL" ? ["SOL", "SOLANA"] : [asset];
    const explicit = cashtags.includes(asset) || aliases.some((alias) =>
      new RegExp(`(^|[^A-Z0-9])(?:\\$|#)?${alias}([^A-Z0-9]|$)`).test(upper),
    );
    if (explicit) result.push(asset);
  }
  return result.slice(0, 6);
}

type RawNewsContextItem = Omit<NewsContextItem, "evidenceHash">;

function newsModel(
  headlineValue: unknown,
  urlValue: unknown,
  publishedValue: unknown,
  publisherValue: unknown,
  symbols: string[],
): RawNewsContextItem | null {
  const headline = decodeEntities(String(headlineValue ?? "")).slice(0, 240);
  const url = safeUrl(urlValue);
  const publishedAt = safeDate(publishedValue);
  if (!headline || !url || !publishedAt) return null;
  const macro = usdBias(headline);
  const directBias = cryptoBias(headline);
  const upper = headline.toUpperCase();
  const domain = sourceDomain(url);
  const publisher = decodeEntities(String(publisherValue ?? "Unknown")).slice(0, 80) || "Unknown";
  const sourceQuality = newsSourceQuality(url, publisher);
  const freshness = freshnessAt(publishedAt);
  return {
    headline,
    publisher,
    publishedAt,
    url,
    relatedAssets: extractAssets(headline, symbols),
    riskKeywords: RISK_KEYWORDS.filter((keyword) => upper.includes(keyword)).slice(0, 4),
    usdBias: macro.bias,
    usdScore: macro.score,
    cryptoBias: directBias,
    ...marketImpact(directBias, macro.bias),
    freshness: freshness.state,
    ageMinutes: freshness.ageMinutes,
    sourceTier: sourceQuality.tier,
    sourceReliability: sourceQuality.score,
    sourceDomain: domain,
    sourceDomains: [domain],
    corroborationCount: 1,
    independentSourceCount: 1,
    normalizedKey: normalizedEvidenceKey(headline),
    classificationVersion: "intel-v2-rules",
  };
}

function parseNewsJson(payload: unknown, symbols: string[]): RawNewsContextItem[] {
  const root = payload as { data?: unknown; articles?: unknown; news?: unknown };
  const records = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.articles)
        ? root.articles
        : Array.isArray(root?.news)
          ? root.news
          : [];
  return records.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const source = item.source;
    const publisher =
      source && typeof source === "object" ? (source as Record<string, unknown>).name : source;
    const model = newsModel(
      item.title ?? item.headline,
      item.url ?? item.link,
      item.published_at ?? item.publishedAt ?? item.date ?? item.pubDate,
      publisher ?? item.publisher,
      symbols,
    );
    return model ? [model] : [];
  });
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/rss+xml, application/xml, text/xml, text/calendar, text/plain" },
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Provider returned ${response.status}`);
    }
    const payload = await response.text();
    if (payload.length > 2_000_000) throw new Error("Provider payload too large");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return decodeEntities(match?.[1] ?? "");
}

function parseRss(payload: string, symbols: string[]): RawNewsContextItem[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(payload)) throw new Error("Unsafe RSS document");
  const publisher = tag(payload, "title") || "RSS";
  return [...payload.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap((match) => {
    const block = match[1];
    const model = newsModel(
      tag(block, "title"),
      tag(block, "link") || tag(block, "guid"),
      tag(block, "pubDate") || tag(block, "dc:date"),
      publisher,
      symbols,
    );
    return model ? [model] : [];
  });
}

function dedupeNews(items: RawNewsContextItem[]): RawNewsContextItem[] {
  const result: RawNewsContextItem[] = [];
  for (const item of items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))) {
    const duplicate = result.find((candidate) =>
      candidate.url === item.url ||
      candidate.normalizedKey === item.normalizedKey ||
      tokenSimilarity(candidate.normalizedKey, item.normalizedKey) >= 0.72,
    );
    if (!duplicate) {
      result.push(item);
      continue;
    }
    duplicate.corroborationCount += 1;
    duplicate.sourceDomains = [...new Set([...duplicate.sourceDomains, item.sourceDomain])];
    duplicate.independentSourceCount = duplicate.sourceDomains.length;
    duplicate.relatedAssets = [...new Set([...duplicate.relatedAssets, ...item.relatedAssets])].slice(0, 6);
    duplicate.riskKeywords = [...new Set([...duplicate.riskKeywords, ...item.riskKeywords])].slice(0, 4);
    const previousReliability = duplicate.sourceReliability;
    const corroborationBonus = Math.min(10, Math.max(0, duplicate.independentSourceCount - 1) * 5);
    const bestReliability = Math.max(previousReliability, item.sourceReliability);
    duplicate.sourceReliability = Math.min(100, bestReliability + corroborationBonus);
    if (item.sourceReliability > previousReliability || (item.sourceReliability === previousReliability && item.ageMinutes < duplicate.ageMinutes)) {
      duplicate.headline = item.headline;
      duplicate.publisher = item.publisher;
      duplicate.publishedAt = item.publishedAt;
      duplicate.url = item.url;
      duplicate.sourceTier = item.sourceTier;
      duplicate.sourceDomain = item.sourceDomain;
      duplicate.freshness = item.freshness;
      duplicate.ageMinutes = item.ageMinutes;
    }
  }
  return result.slice(0, 12);
}

async function finalizeNews(items: RawNewsContextItem[], totalObserved: number): Promise<{
  items: NewsContextItem[];
  quality: IntelQualitySummary;
}> {
  const finalized = await Promise.all(items.map(async (item) => ({
    ...item,
    evidenceHash: await evidenceHash({
      schema: "intel-v2",
      kind: "NEWS",
      headline: item.headline,
      url: item.url,
      publishedAt: item.publishedAt,
      sourceDomains: item.sourceDomains,
      classificationVersion: item.classificationVersion,
    }),
  })));
  return {
    items: finalized,
    quality: {
      schemaVersion: "intel-v2",
      totalObserved,
      accepted: finalized.length,
      duplicatesRemoved: Math.max(0, totalObserved - finalized.length),
      fresh: finalized.filter((item) => item.freshness === "FRESH").length,
      aging: finalized.filter((item) => item.freshness === "AGING").length,
      stale: finalized.filter((item) => item.freshness === "STALE").length,
      reliable: finalized.filter((item) => item.sourceReliability >= 60).length,
    },
  };
}

async function loadNews(symbols: string[]): Promise<IntelligenceContext["news"]> {
  return memo(`news:${symbols.join(",")}`, 10 * 60_000, async () => {
    const providers = await Promise.allSettled([
      fetchJson<unknown>(NEWS_JSON).then((payload) => parseNewsJson(payload, symbols)),
      ...NEWS_RSS.map((url) => fetchText(url).then((payload) => parseRss(payload, symbols))),
    ]);
    const observed = providers.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const errors = providers.filter((result) => result.status === "rejected").length;
    if (observed.length) {
      const finalized = await finalizeNews(dedupeNews(observed), observed.length);
      const actionable = finalized.items.filter((item) => item.freshness !== "STALE" && item.sourceReliability >= 60);
      const independentSources = new Set(actionable.flatMap((item) => item.sourceDomains));
      const officialEvidence = actionable.some((item) => item.sourceTier === "OFFICIAL");
      const healthy = actionable.length > 0 && (independentSources.size >= 2 || officialEvidence);
      return {
        state: healthy ? "healthy" : "degraded",
        ...finalized,
        updatedAt: new Date().toISOString(),
        reason: healthy
          ? errors ? `${errors} provider gagal; evidence lain tetap tervalidasi.` : null
          : "Feed tersedia, tetapi coverage fresh/reliable belum cukup untuk ranking.",
      };
    }
    return {
      state: "degraded",
      items: [],
      updatedAt: null,
      reason: `Semua feed news gagal (${errors} provider).`,
      quality: EMPTY_INTEL_QUALITY,
    };
  });
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function finiteNumber(...values: unknown[]): number {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function predictionCategory(text: string): PredictionMarketItem["category"] | null {
  if (/\b(bitcoin|btc|ethereum|eth|solana|crypto|cryptocurrency|stablecoin|xrp|binance|coinbase|spot etf)\b/i.test(text)) {
    return "CRYPTO";
  }
  if (/\b(federal reserve|fed|fomc|interest rate|rate cuts?|rate hikes?|inflation|cpi|recession|gdp|unemployment|payrolls?|treasury|dollar|dxy)\b/i.test(text)) {
    return "MACRO";
  }
  return null;
}

function polymarketUrl(slug: unknown): string | null {
  const safeSlug = String(slug ?? "").trim();
  if (!/^[a-z0-9-]{1,180}$/.test(safeSlug)) return null;
  return `https://polymarket.com/event/${safeSlug}`;
}

function parsePredictionMarkets(payload: unknown, symbols: string[]): PredictionMarketItem[] {
  if (!Array.isArray(payload)) throw new Error("Schema Polymarket berubah");
  const parsed = payload.flatMap((rawEvent) => {
    if (!rawEvent || typeof rawEvent !== "object") return [];
    const event = rawEvent as Record<string, unknown>;
    if (event.active === false || event.closed === true || !Array.isArray(event.markets)) return [];
    const sourceUrl = polymarketUrl(event.slug);
    if (!sourceUrl) return [];
    return event.markets.flatMap((rawMarket) => {
      if (!rawMarket || typeof rawMarket !== "object") return [];
      const market = rawMarket as Record<string, unknown>;
      if (market.active === false || market.closed === true || market.acceptingOrders === false) return [];
      const question = decodeEntities(String(market.question ?? event.title ?? "")).slice(0, 240);
      const category = predictionCategory(`${event.title ?? ""} ${question}`);
      if (!question || !category) return [];
      const outcomes = stringArray(market.outcomes);
      const prices = stringArray(market.outcomePrices).map(Number);
      if (!outcomes.length || outcomes.length !== prices.length || prices.some((price) => !Number.isFinite(price))) return [];
      const yesIndex = outcomes.findIndex((outcome) => /^yes$/i.test(outcome));
      const selectedIndex = yesIndex >= 0
        ? yesIndex
        : prices.reduce((best, price, index) => price > prices[best] ? index : best, 0);
      const probability = prices[selectedIndex] * 100;
      if (!Number.isFinite(probability) || probability < 0 || probability > 100) return [];
      const rawChange = Number(market.oneDayPriceChange);
      return [{
        question,
        probability: Math.round(probability * 10) / 10,
        outcome: outcomes[selectedIndex].slice(0, 80),
        volume24h: Math.max(0, finiteNumber(market.volume24hr, event.volume24hr)),
        liquidity: Math.max(0, finiteNumber(market.liquidityNum, market.liquidity, event.liquidity)),
        endDate: safeDate(market.endDate ?? event.endDate),
        sourceUrl,
        relatedAssets: extractAssets(`${event.title ?? ""} ${question}`, symbols),
        category,
        change24h: Number.isFinite(rawChange) ? Math.round(rawChange * 1000) / 10 : null,
      } satisfies PredictionMarketItem];
    });
  });
  const seen = new Set<string>();
  return parsed
    .sort((a, b) => b.volume24h - a.volume24h)
    .filter((item) => {
      const key = item.question.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

async function loadPredictionMarkets(symbols: string[]): Promise<IntelligenceContext["predictionMarkets"]> {
  return memo(`prediction-markets:${symbols.join(",")}`, 15 * 60_000, async () => {
    try {
      const items = parsePredictionMarkets(await fetchJson<unknown>(POLYMARKET_EVENTS_URL), symbols);
      return {
        state: "healthy",
        items,
        updatedAt: new Date().toISOString(),
        reason: items.length ? null : "Belum ada market crypto/makro aktif yang relevan.",
        sourceUrl: POLYMARKET_SOURCE_URL,
      };
    } catch {
      return {
        state: "degraded",
        items: [],
        updatedAt: null,
        reason: "Market odds live tidak dapat dijangkau; tidak memakai data lama.",
        sourceUrl: POLYMARKET_SOURCE_URL,
      };
    }
  });
}

async function loadFearGreed(): Promise<FearGreedContext> {
  return memo("fear-greed", 60 * 60_000, async () => {
    try {
      const payload = await fetchJson<{
        data?: Array<{ value?: string; value_classification?: string; timestamp?: string }>;
      }>(FNG_URL);
      const latest = payload.data?.at(0);
      const previous = payload.data?.at(1);
      const value = Number(latest?.value);
      if (!Number.isFinite(value)) throw new Error("Schema Fear & Greed berubah");
      return {
        state: "healthy",
        value,
        classification: String(latest?.value_classification ?? "Unknown"),
        previousValue: Number.isFinite(Number(previous?.value)) ? Number(previous?.value) : null,
        updatedAt: latest?.timestamp
          ? new Date(Number(latest.timestamp) * 1000).toISOString()
          : new Date().toISOString(),
        sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
      };
    } catch {
      return {
        state: "degraded",
        value: null,
        classification: "Unavailable",
        previousValue: null,
        updatedAt: null,
        sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
      };
    }
  });
}

async function fredSeries(
  id: string,
  key: string,
  limit: number,
): Promise<Array<{ date: string; value: number }>> {
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", id);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));
  const payload = await fetchJson<{ observations?: Array<{ date?: string; value?: string }> }>(url.toString());
  return (payload.observations ?? []).flatMap((item) => {
    const value = Number(item.value);
    return item.date && Number.isFinite(value) ? [{ date: item.date, value }] : [];
  });
}

async function fredCsvSeries(
  id: string,
  limit: number,
): Promise<Array<{ date: string; value: number }>> {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", id);
  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - 2);
  url.searchParams.set("cosd", start.toISOString().slice(0, 10));
  const payload = await fetchText(url.toString());
  const lines = payload.replace(/\r\n/g, "\n").trim().split("\n");
  const header = lines.shift()?.split(",").map((item) => item.trim()) ?? [];
  const valueIndex = header.indexOf(id);
  if (valueIndex < 1) throw new Error(`Kolom FRED ${id} tidak tersedia`);
  return lines
    .flatMap((line) => {
      const fields = line.split(",");
      const date = fields[0]?.trim();
      const value = Number(fields[valueIndex]);
      return date && Number.isFinite(value) ? [{ date, value }] : [];
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

async function loadMacro(): Promise<MacroContext> {
  const key = process.env.FRED_API_KEY?.trim();
  return memo(`macro-fred:${key ? "api" : "public-csv"}`, 3 * 60 * 60_000, async () => {
    try {
      let sourceMode: MacroContext["sourceMode"] = "public_csv";
      let series: Array<Array<{ date: string; value: number }>> | null = null;
      if (key) {
        try {
          series = await Promise.all([
            fredSeries("DGS10", key, 6),
            fredSeries("VIXCLS", key, 6),
            fredSeries("DTWEXBGS", key, 6),
            fredSeries("DFF", key, 3),
            fredSeries("CPIAUCSL", key, 14),
          ]);
          if (series[0]?.[0] && series[1]?.[0] && series[2]?.[0] && series[3]?.[0] && series[4]?.[12]) {
            sourceMode = "api";
          } else {
            series = null;
          }
        } catch {
          series = null;
        }
      }
      series ??= await Promise.all([
        fredCsvSeries("DGS10", 6),
        fredCsvSeries("VIXCLS", 6),
        fredCsvSeries("DTWEXBGS", 6),
        fredCsvSeries("DFF", 3),
        fredCsvSeries("CPIAUCSL", 14),
      ]);
      const [yield10y, vix, dollar, fedFunds, cpi] = series;
      if (!yield10y[0] || !vix[0] || !dollar[0] || !fedFunds[0] || !cpi[12]) {
        throw new Error("Observasi FRED belum lengkap");
      }
      const yieldChange = yield10y[0].value - (yield10y[1]?.value ?? yield10y[0].value);
      const vixChange = vix[0].value - (vix[1]?.value ?? vix[0].value);
      const dollarChange =
        dollar[1]?.value ? ((dollar[0].value - dollar[1].value) / dollar[1].value) * 100 : 0;
      const cpiYoy = ((cpi[0].value - cpi[12].value) / cpi[12].value) * 100;
      let riskScore = 0;
      const reasons: string[] = [];
      if (yieldChange >= 0.05) { riskScore += 1; reasons.push("Yield 10Y naik"); }
      if (yieldChange <= -0.05) { riskScore -= 1; reasons.push("Yield 10Y turun"); }
      if (dollarChange >= 0.15) { riskScore += 1; reasons.push("Broad USD menguat"); }
      if (dollarChange <= -0.15) { riskScore -= 1; reasons.push("Broad USD melemah"); }
      if (vix[0].value >= 20) { riskScore += 1; reasons.push("VIX di atas 20"); }
      if (vix[0].value <= 16) { riskScore -= 1; reasons.push("VIX rendah"); }
      return {
        state: "healthy",
        regime: riskScore >= 2 ? "RISK-OFF" : riskScore <= -2 ? "RISK-ON" : "MIXED",
        metrics: [
          { id: "DGS10", label: "US 10Y", value: yield10y[0].value, change: yieldChange, unit: "%", observedAt: yield10y[0].date },
          { id: "VIXCLS", label: "VIX", value: vix[0].value, change: vixChange, unit: "", observedAt: vix[0].date },
          { id: "DTWEXBGS", label: "Broad USD", value: dollar[0].value, change: dollarChange, unit: "idx", observedAt: dollar[0].date },
          { id: "DFF", label: "Fed Funds", value: fedFunds[0].value, change: null, unit: "%", observedAt: fedFunds[0].date },
          { id: "CPIAUCSL", label: "CPI YoY", value: cpiYoy, change: null, unit: "%", observedAt: cpi[0].date },
        ],
        reasons: reasons.length ? reasons : ["Makro silang; tidak ada bias dominan."],
        sourceUrl: "https://fred.stlouisfed.org/",
        sourceMode,
      } satisfies MacroContext;
    } catch {
      return {
        state: "degraded",
        regime: "UNAVAILABLE",
        metrics: [],
        reasons: ["FRED API dan CSV resmi tidak dapat dijangkau; terminal tetap netral."],
        sourceUrl: "https://fred.stlouisfed.org/",
        sourceMode: null,
      } satisfies MacroContext;
    }
  });
}

const CALENDAR: EconomicEvent[] = [
  { name: "FOMC Minutes — rapat Juli", eventDate: "2026-08-19", scheduledAt: "2026-08-19T18:00:00Z", impact: "HIGH", source: "https://www.federalreserve.gov/newsevents/calendar.htm" },
  { name: "U.S. GDP + Personal Income & Outlays", eventDate: "2026-08-26", scheduledAt: "2026-08-26T12:30:00Z", impact: "HIGH", source: "https://www.bea.gov/news/schedule" },
  { name: "U.S. Employment Situation", eventDate: "2026-09-04", scheduledAt: "2026-09-04T12:30:00Z", impact: "HIGH", source: "https://www.bls.gov/schedule/2026/home.htm" },
  { name: "U.S. CPI — Agustus", eventDate: "2026-09-11", scheduledAt: "2026-09-11T12:30:00Z", impact: "HIGH", source: "https://www.bls.gov/schedule/news_release/cpi.htm" },
  { name: "FOMC Decision — September", eventDate: "2026-09-16", scheduledAt: null, impact: "HIGH", source: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  { name: "U.S. CPI — September", eventDate: "2026-10-14", scheduledAt: "2026-10-14T12:30:00Z", impact: "HIGH", source: "https://www.bls.gov/schedule/news_release/cpi.htm" },
  { name: "FOMC Decision — Oktober", eventDate: "2026-10-28", scheduledAt: null, impact: "HIGH", source: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  { name: "U.S. CPI — Oktober", eventDate: "2026-11-10", scheduledAt: "2026-11-10T13:30:00Z", impact: "HIGH", source: "https://www.bls.gov/schedule/news_release/cpi.htm" },
  { name: "FOMC Decision — Desember", eventDate: "2026-12-09", scheduledAt: null, impact: "HIGH", source: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  { name: "U.S. CPI — November", eventDate: "2026-12-10", scheduledAt: "2026-12-10T13:30:00Z", impact: "HIGH", source: "https://www.bls.gov/schedule/news_release/cpi.htm" },
];

function easternLocalToIso(value: string): string | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const desired = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  let guess = desired;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess += desired - represented;
  }
  const parsed = new Date(guess);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function parseBlsCalendar(payload: string): EconomicEvent[] {
  if (!payload.includes("BEGIN:VCALENDAR")) throw new Error("Format kalender BLS berubah");
  const unfolded = payload.replace(/\r?\n[ \t]/g, "");
  return [...unfolded.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)].flatMap((match) => {
    const block = match[1];
    const summaryLine = block.match(/(?:^|\r?\n)SUMMARY(?:;[^:]*)?:(.*)/i)?.[1]?.trim() ?? "";
    const summary = summaryLine
      .replaceAll("\\,", ",")
      .replaceAll("\\n", " ")
      .replaceAll("\\;", ";")
      .trim();
    if (!/(Consumer Price Index|Employment Situation|Producer Price Index)/i.test(summary)) return [];
    const startLine = block.match(/(?:^|\r?\n)(DTSTART(?:;[^:]*)?):([^\r\n]+)/i);
    if (!startLine) return [];
    const metadata = startLine[1];
    const raw = startLine[2].trim();
    const eventDate = raw.length >= 8
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
      : "";
    if (!eventDate) return [];
    let scheduledAt: string | null = null;
    if (/^\d{8}T\d{6}Z$/.test(raw)) {
      scheduledAt = safeDate(
        `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`,
      );
    } else if (/^\d{8}T\d{6}$/.test(raw) && !/VALUE=DATE/i.test(metadata)) {
      scheduledAt = easternLocalToIso(raw);
    }
    return [{
      name: `U.S. ${summary}`,
      eventDate,
      scheduledAt,
      impact: "HIGH",
      source: "https://www.bls.gov/schedule/",
    } satisfies EconomicEvent];
  });
}

function eventKey(event: EconomicEvent): string {
  const category = /Consumer Price Index|\bCPI\b/i.test(event.name)
    ? "CPI"
    : /Employment Situation/i.test(event.name)
      ? "JOBS"
      : /Producer Price Index|\bPPI\b/i.test(event.name)
        ? "PPI"
        : event.name.toUpperCase();
  return `${event.eventDate}:${category}`;
}

async function loadBlsEvents(): Promise<{
  state: ProviderState;
  items: EconomicEvent[];
  reason: string | null;
  verifiedAt: string;
}> {
  return memo("calendar-bls", 6 * 60 * 60_000, async () => {
    try {
      const items = parseBlsCalendar(await fetchText(BLS_CALENDAR_URL));
      if (!items.length) throw new Error("Tidak ada event high-impact");
      return { state: "healthy", items, reason: null, verifiedAt: new Date().toISOString() };
    } catch {
      return {
        state: "degraded",
        items: [],
        reason: "BLS live calendar tidak tersedia; memakai jadwal resmi terverifikasi terakhir.",
        verifiedAt: "2026-08-17T00:00:00Z",
      };
    }
  });
}

async function loadEvents(now = new Date()): Promise<IntelligenceContext["events"]> {
  const bls = await loadBlsEvents();
  const wibDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const startOfToday = new Date(`${wibDate}T00:00:00+07:00`);
  const seen = new Set<string>();
  const items = [...bls.items, ...CALENDAR]
    .sort((a, b) => {
      const aTime = Date.parse(a.scheduledAt ?? `${a.eventDate}T23:59:59Z`);
      const bTime = Date.parse(b.scheduledAt ?? `${b.eventDate}T23:59:59Z`);
      return aTime - bTime;
    })
    .filter((event) => {
      const comparable = event.scheduledAt ?? `${event.eventDate}T23:59:59Z`;
      if (Date.parse(comparable) < startOfToday.getTime()) return false;
      const key = eventKey(event);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
  const active = items.find((event) => {
    if (!event.scheduledAt) return false;
    const deltaMinutes = (Date.parse(event.scheduledAt) - now.getTime()) / 60_000;
    return deltaMinutes >= -30 && deltaMinutes <= 60;
  });
  return {
    state: bls.state,
    items,
    blackout: {
      active: Boolean(active),
      event: active?.name ?? null,
      until: active?.scheduledAt
        ? new Date(Date.parse(active.scheduledAt) + 30 * 60_000).toISOString()
        : null,
    },
    lastVerifiedAt: bls.verifiedAt,
    reason: bls.reason,
  };
}

function recordAt(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function firstFinite(value: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const parsed = Number(recordAt(value, path));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseArkhamFlows(payload: unknown, symbols: string[]): ArkhamFlowItem[] {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const records = Array.isArray(payload)
    ? payload
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(root.results)
        ? root.results
        : Array.isArray(root.tokens)
          ? root.tokens
          : [];
  const eligible = new Set(symbols.map((symbol) => symbol.replace(/USDT$/, "")));
  return records.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const rawSymbol = String(
      item.symbol ?? recordAt(item, ["token", "symbol"]) ?? recordAt(item, ["asset", "symbol"]) ?? "",
    ).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const asset = rawSymbol.replace(/USDT$/, "");
    if (!asset || !eligible.has(asset)) return [];
    const inflowUsd = firstFinite(item, [
      ["inflowUsd"], ["inflow_usd"], ["inflow"], ["flows", "inflowUsd"], ["flows", "inflow"],
    ]);
    const outflowUsd = firstFinite(item, [
      ["outflowUsd"], ["outflow_usd"], ["outflow"], ["flows", "outflowUsd"], ["flows", "outflow"],
    ]);
    if (inflowUsd === null || outflowUsd === null) return [];
    const normalizedInflow = Math.abs(inflowUsd);
    const normalizedOutflow = Math.abs(outflowUsd);
    const netFlowUsd = normalizedInflow - normalizedOutflow;
    const total = normalizedInflow + normalizedOutflow;
    const meaningful = total > 0 && Math.abs(netFlowUsd) / total >= 0.08;
    return [{
      asset,
      inflowUsd: normalizedInflow,
      outflowUsd: normalizedOutflow,
      netFlowUsd,
      bias: !meaningful
        ? "NEUTRAL"
        : netFlowUsd < 0
          ? "ACCUMULATION"
          : "DISTRIBUTION",
      sourceUrl: ARKHAM_SOURCE_URL,
    } satisfies ArkhamFlowItem];
  }).sort((a, b) => Math.abs(b.netFlowUsd) - Math.abs(a.netFlowUsd)).slice(0, 10);
}

async function loadArkham(symbols: string[]): Promise<IntelligenceContext["arkham"]> {
  const apiKey = process.env.ARKHAM_API_KEY?.trim();
  if (!apiKey) {
    return {
      state: "disabled",
      items: [],
      updatedAt: null,
      reason: "ARKHAM_API_KEY belum dipasang; tidak ada data wallet/flow yang dibuat-buat.",
      sourceUrl: ARKHAM_SOURCE_URL,
    };
  }
  if (!symbols.length) {
    return {
      state: "healthy",
      items: [],
      updatedAt: new Date().toISOString(),
      reason: "Menunggu Binance universe untuk mencocokkan token Arkham.",
      sourceUrl: ARKHAM_SOURCE_URL,
    };
  }
  return memo(`arkham:${symbols.join(",")}`, 15 * 60_000, async () => {
    try {
      const items = parseArkhamFlows(
        await fetchJson<unknown>(ARKHAM_API_URL, { "API-Key": apiKey }),
        symbols,
      );
      return {
        state: "healthy",
        items,
        updatedAt: new Date().toISOString(),
        reason: items.length
          ? null
          : "Arkham tersambung, tetapi schema/data flow saat ini belum memberi pasangan Binance yang dapat diverifikasi.",
        sourceUrl: ARKHAM_SOURCE_URL,
      };
    } catch {
      return {
        state: "degraded",
        items: [],
        updatedAt: null,
        reason: "Arkham API tidak dapat dijangkau; konfirmasi on-chain dinonaktifkan.",
        sourceUrl: ARKHAM_SOURCE_URL,
      };
    }
  });
}

function rankCandidates(
  inputs: ContextInput[],
  news: IntelligenceContext["news"],
): Record<string, ContextItem> {
  return Object.fromEntries(inputs.map((input) => {
    const asset = input.symbol.replace(/USDT$/, "");
    const catalysts: string[] = [];
    let newsAdjustment = 0;
    const relevantNews = news.items.filter((item) =>
      item.relatedAssets.includes(asset) &&
      item.freshness !== "STALE" &&
      item.sourceReliability >= 60,
    ).slice(0, 6);
    const independentNewsSources = new Set(relevantNews.flatMap((item) => item.sourceDomains));
    const newsNet = relevantNews.reduce(
      (sum, item) => sum + (item.cryptoBias === "BULLISH" ? 1 : item.cryptoBias === "BEARISH" ? -1 : 0),
      0,
    );
    if (independentNewsSources.size >= 2 && newsNet !== 0) {
      const bullish = newsNet > 0;
      const aligned = (input.direction === "LONG" && bullish) || (input.direction === "SHORT" && !bullish);
      newsAdjustment = aligned ? 3 : -3;
      catalysts.push(`News ${bullish ? "support" : "pressure"} · ${independentNewsSources.size} sumber independen · fresh/reliable · ranking saja`);
    }
    return [input.symbol, {
      adjustment: newsAdjustment,
      newsAdjustment,
      catalysts,
    }];
  }));
}

export async function loadIntelligence(
  symbols: string[],
  inputs: ContextInput[],
): Promise<IntelligenceContext> {
  const uniqueSymbols = [...new Set(symbols.filter((symbol) => /^[A-Z0-9]{1,20}USDT$/.test(symbol)))].slice(0, 24);
  const [news, fearGreed, macro, arkham, events, predictionMarkets] = await Promise.all([
    loadNews(uniqueSymbols),
    loadFearGreed(),
    loadMacro(),
    loadArkham(uniqueSymbols),
    loadEvents(),
    loadPredictionMarkets(uniqueSymbols),
  ]);
  return {
    context: rankCandidates(inputs, news),
    news,
    fearGreed,
    macro,
    events,
    arkham,
    predictionMarkets,
    generatedAt: new Date().toISOString(),
  };
}
