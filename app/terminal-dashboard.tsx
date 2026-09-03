"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { IntelligenceContext, NewsContextItem } from "@/lib/context";
import type { HotVolumeCandidate, HotVolumeReport, HotVolumeStatus } from "@/lib/hot-volume";
import type { HotVolumeEvaluationReport } from "@/lib/hot-volume-evaluation";
import type { AnalysisResult, Candidate, CandidateDiagnostic, EarlySignal, UniverseItem } from "@/lib/market";
import { calculatePaperPositionAccounting } from "@/lib/paper-account";

type ScanState = "idle" | "prefilter" | "analyzing" | "ranking" | "live" | "error";
type MenuKey = "scanner" | "early" | "intelligence" | "paper" | "evaluation" | "market";
type AdaptiveAuditFilter = "LONG" | "SHORT" | "WAIT" | "ELIGIBLE";
type MarketTab = "hot" | "liquidity";
type HotVolumeView = HotVolumeReport & { evaluation?: HotVolumeEvaluationReport };
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type DashboardProps = { displayName: string; readOnlyViewer: boolean };
type WatchItem = { diagnostic: CandidateDiagnostic; setup: Candidate | null };
const PAPER_MIN_SCORE = 70;
const PAPER_LEVERAGE = 20;
const PAPER_PAGE_SIZE = 8;
type PaperTrade = {
  id: string;
  symbol: string;
  baseAsset: string;
  direction: "LONG" | "SHORT";
  setupType: string;
  modelVersion: string;
  status: "OPEN" | "TP" | "SL" | "MANUAL";
  rankingScore: number;
  technicalScore: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  exitPrice: number | null;
  outcomeR: number | null;
  openedAt: string;
  closedAt: string | null;
  evidence: {
    schemaVersion: string;
    eventCount: number;
    latestHash: string | null;
  };
  accounting: {
    schemaVersion: "paper-account-v1";
    marginUsd: number;
    leverage: number;
    notionalUsd: number;
    roundTripCostRate: number;
    estimatedRoundTripFeesUsd: number;
    grossPnlUsd: number;
    rawNetPnlUsd: number;
    netPnlUsd: number;
    netRoiPct: number;
    marginLossCapped: boolean;
  };
  risk: {
    version: string;
    sizingMode: "FIXED_FRACTIONAL" | "LEGACY_FIXED_MARGIN";
    assumedLeverage: number;
    stopDistancePct: number;
    stopDistanceAtr: number | null;
    estimatedRoiAtStopPct: number;
    grossRiskReward: number | null;
    netRiskReward: number | null;
    riskPerTradePct: number;
    accountEquityUsd: number;
    riskBudgetUsd: number;
    estimatedLossAtStopUsd: number;
    estimatedFeesUsd: number;
    notionalUsd: number;
    marginUsd: number;
    quantity: number;
    gatePass: boolean;
  };
  context: {
    adjustment: number;
    newsAdjustment: number;
    xAdjustment: number;
    xSnapshot: {
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
  };
  excursion: { mfePct: number; maePct: number; mfeR: number; maeR: number; peakRoiAt20xPct: number };
};
type PaperJournal = {
  summary: {
    total: number; open: number; resolved: number; wins: number; losses: number; manualClosed: number; winRate: number; expectancyR: number; netR: number;
    legacy: number; legacyOpen: number; allTotal: number; allOpen: number; allResolved: number; allWins: number; allLosses: number; allManualClosed: number;
    allNetR: number; slReachedHalfR: number; slReachedOneR: number; slAverageMfeR: number;
  };
  openTrades: PaperTrade[];
  history: PaperTrade[];
  generatedAt: string;
  mode: "PAPER";
  runtimeSafety: {
    schemaVersion: "runtime-safety-v1";
    dataHealthState: "HEALTHY" | "DEGRADED" | "UNKNOWN";
    entryCircuit: "OPEN" | "BLOCKED";
    reasons: string[];
    cooldownHours: number;
    cooldownBlocked: Array<{ symbol: string; remainingMinutes: number; structuralResetRequired: boolean }>;
    lastSyncAt: string | null;
  };
  account: {
    schemaVersion: "paper-account-v1";
    currency: "USD";
    initialCapitalUsd: number;
    defaultMarginPerTradeUsd: number;
    defaultLeverage: number;
    activeRiskModel: "FIXED_FRACTIONAL";
    riskPerTradePct: number;
    maximumPortfolioRiskPct: number;
    maximumSameDirectionRiskPct: number;
    openPlannedRiskUsd: number;
    availableRiskUsd: number;
    estimatedRoundTripCostRate: number;
    realizedGrossPnlUsd: number;
    estimatedFeesUsd: number;
    realizedNetPnlUsd: number;
    balanceUsd: number;
    openMarginUsd: number;
    freeBalanceUsd: number;
    realizedReturnPct: number;
    maxDrawdownUsd: number;
    maxDrawdownPct: number;
    profitFactor: number | null;
    expectancyUsd: number;
    marginLossCaps: number;
    byModel: Array<{
      modelVersion: string; total: number; open: number; resolved: number; wins: number; losses: number;
      winRate: number; realizedNetPnlUsd: number; expectancyUsd: number; profitFactor: number | null; marginLossCaps: number;
    }>;
  };
  systemEvaluation: {
    verdict: "UNDERPERFORMING" | "OBSERVE" | "INSUFFICIENT_DATA";
    promotionDecision: "DO NOT PROMOTE" | "KEEP COLLECTING";
    headline: string;
    reasons: string[];
  };
};
type ScanDataHealth = {
  schemaVersion: "data-health-v1";
  state: "HEALTHY" | "DEGRADED";
  checkedAt: string;
  universeCount: number;
  resultCount: number;
  providerFailures: number;
  reasons: string[];
  warnings: string[];
};
type PaperPriceFeed = { prices: Record<string, number>; journal: PaperJournal; generatedAt: string };
type TelegramCompanionStatus = {
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
    hardGate: "INSUFFICIENT DATA" | "OBSERVE" | "KEEP" | "REVERT" | "UNAVAILABLE";
    early: { verdict: "INSUFFICIENT DATA" | "OBSERVE" | "KEEP" | "REVERT"; resolved: number; targetResolved: number; confidence: "LOW" | "OBSERVE" | "PROMOTED" | "REJECTED" };
    hotVolume: { verdict: "INSUFFICIENT DATA" | "OBSERVE" | "KEEP" | "REVERT" | "UNAVAILABLE"; resolved: number; targetResolved: number; confidence: "LOW" | "OBSERVE" | "PROMOTED" | "REJECTED" };
  };
  snapshotMode: "PNG" | "SVG_FALLBACK";
  activeSubscriptions: number;
  offered: number;
  monitoring: number;
  passed: number;
  safety: string[];
};
type ManualExecutionMonitor = {
  id: string;
  paperTradeId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  setupType: string;
  decision: "OFFERED" | "EXECUTED" | "PASSED" | "EXPIRED" | "CLOSED";
  state: string;
  actualEntry: number | null;
  stopLoss: number;
  tp1: number;
  lastCheckedAt: string | null;
  latestAdvice: { state: string; r: number; reason: string; close: number; rsi: number; relativeVolume: number } | null;
};
type ManualExecutionStatus = {
  schemaVersion: "manual-execution-terminal-v1";
  state: "READY";
  active: number;
  passed: number;
  closed: number;
  monitors: ManualExecutionMonitor[];
};
type ExitShadowPosition = {
  id: string; symbol: string; direction: "LONG" | "SHORT"; sourceModelVersion: string;
  sourceStatus: "OPEN" | "TP" | "SL" | "MANUAL";
  cohort: "LEGACY_BACKFILL" | "FORWARD_CARRY" | "FORWARD_NATIVE" | "RUNNER_BRIDGE";
  state: "OPEN" | "BE_ARMED" | "TP1_PARTIAL" | "TP2_PARTIAL" | "FULL_TP" | "PROTECTED_EXIT" | "SL" | "MANUAL_CLOSE";
  entryPrice: number; originalStop: number; activeStop: number; oneRPrice: number; tp1: number; tp2: number; tp3: number;
  remainingFraction: number; realizedR: number; baselineOutcomeR: number | null; openedAt: string; lastCheckedAt: string; closedAt: string | null;
  evidence: { eventCount: number; latestHash: string | null };
};
type ExitShadowReport = {
  schemaVersion: "exit-management-v2-shadow"; mode: "SHADOW_ONLY";
  rules: { oneRPartialPct: 25; tp1PartialPct: 25; tp2PartialPct: 25; tp3FinalPct: 25; stopAfterOneR: "NET_BE_NEXT_CANDLE" };
  comparison: {
    activatedAt: string; minimumPairedResolved: number; evidenceGate: "COLLECTING" | "READY_TO_REVIEW";
    forward: { total: number; active: number; resolved: number; pairedResolved: number; realizedToDateR: number; stagedNetR: number | null; baselineNetR: number | null; stagedExpectancyR: number | null; baselineExpectancyR: number | null; deltaExpectancyR: number | null };
    bridge: { total: number; active: number; resolved: number; realizedToDateR: number };
    excludedLegacy: number;
  };
  summary: { total: number; active: number; open: number; beArmed: number; tp1Partial: number; tp2Partial: number; fullTp: number; protectedExit: number; sl: number; manualClose: number; protected: number; realizedR: number; baselineResolvedR: number };
  activePositions: ExitShadowPosition[]; resolvedPositions: ExitShadowPosition[]; generatedAt: string;
};
type CrossExchangeSnapshot = {
  state: "healthy" | "disabled" | "unavailable";
  reason?: string;
  schemaVersion?: "CROSS_EXCHANGE_V1";
  mode?: "READ_ONLY_SHADOW";
  status?: "CONFIRMED" | "MIXED" | "OPPOSED" | "INSUFFICIENT";
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  summary?: { available: number; total: number; aligned: number; opposed: number; neutral: number; priceIntegrity: number };
  exchanges?: Array<{
    exchange: string;
    state: "HEALTHY" | "UNAVAILABLE";
    price: number | null;
    change15mPercent: number | null;
    alignment: "ALIGNED" | "OPPOSED" | "NEUTRAL" | "UNAVAILABLE";
    referenceDeviationBps: number | null;
    priceIntegrity: boolean;
    closedAt: string | null;
  }>;
  generatedAt?: string;
  evidenceHash?: string;
};
type EvaluationSlice = {
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
type EvaluationReport = {
  schemaVersion: "controlled-evaluation-v2";
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
    activeVersion: "V2_CLOSED_CANDLE";
    settlement: "CLOSED_15M_HIGH_LOW_STOP_FIRST";
    horizonHours: 24;
    legacyExcluded: number;
    uniqueSymbols: number;
    periodStart: string | null;
    periodEnd: string | null;
  };
  generatedAt: string;
};
type BackgroundScanStatus = {
  schemaVersion: "forward-evidence-collector-v1";
  mode: "PAPER_SHADOW_READ_ONLY";
  state: "OFF" | "WAITING" | "HEALTHY" | "PARTIAL" | "STALE" | "FAILED";
  configured: boolean;
  cadenceMinutes: 15;
  telegramEnabled: false;
  gateAudit: {
    schemaVersion: "gate-bottleneck-audit-v1";
    mode: "REPORT_ONLY_NO_RULE_CHANGE";
    state: "COLLECTING" | "STARVED" | "LOW_FLOW" | "FLOWING";
    targetCycles: 96; windowCycles: number; classifiedCycles: number;
    periodStart: string | null; periodEnd: string | null;
    strictSignals: number; opportunitySignals: number; eligibleSignals: number;
    cyclesWithStrict: number; cyclesWithOpportunity: number; cyclesWithEligible: number;
    currentZeroEligibleStreak: number;
    topBlockers: Array<{ reason: string; category: string; count: number }>;
    categoryCounts: Array<{ category: string; count: number }>;
  };
  latestRun: {
    cycleKey: string; state: "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
    startedAt: string; completedAt: string | null; ageMinutes: number; candidates: number;
    paperOpen: number; shadowResolved: number; exitActive: number; warnings: string[];
    lanes: {
      hardGate: { state: string; candidates: number; strictCandidates: number; opportunityCandidates: number; eligibleCandidates: number; alerted: number; rejections: Array<{ reason: string; count: number }>; starvation: { consecutiveCycles: number; threshold: 96; active: boolean } };
      early: { state: string; candidates: number; alerted: number };
      hotVolume: { state: string; candidates: number; alerted: number };
      positionMonitor: { state: string; polled: number; handled: number; checked: number; alerted: number };
    } | null;
  } | null;
};

function paperPositionMetrics(trade: PaperTrade, livePrice: number | undefined) {
  if (!Number.isFinite(livePrice) || !livePrice || trade.entryPrice <= 0) return null;
  const direction = trade.direction === "LONG" ? 1 : -1;
  const priceMovePct = ((livePrice - trade.entryPrice) / trade.entryPrice) * 100 * direction;
  const accounting = calculatePaperPositionAccounting({
    direction: trade.direction,
    entryPrice: trade.entryPrice,
    markPrice: livePrice,
    marginUsd: trade.accounting.marginUsd,
    leverage: trade.accounting.leverage,
    roundTripCostRate: trade.accounting.roundTripCostRate,
  });
  const grossRoiPct = priceMovePct * trade.accounting.leverage;
  const favorable = accounting.netPnlUsd >= 0;
  const levelDistance = favorable
    ? Math.abs(trade.takeProfit - trade.entryPrice)
    : Math.abs(trade.entryPrice - trade.stopLoss);
  const moveDistance = Math.abs(livePrice - trade.entryPrice);
  return {
    livePrice,
    priceMovePct,
    grossRoiPct,
    roiPct: accounting.netRoiPct,
    grossPnlUsd: accounting.grossPnlUsd,
    netPnlUsd: accounting.netPnlUsd,
    estimatedFeesUsd: accounting.estimatedRoundTripFeesUsd,
    marginLossCapped: accounting.marginLossCapped,
    progressPct: levelDistance > 0 ? Math.min(100, (moveDistance / levelDistance) * 100) : 0,
    progressLabel: favorable ? "PROGRESS MENUJU TP1" : "DRAWDOWN MENUJU SL",
  };
}

function compactPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const digits = Math.abs(value) >= 100 ? 2 : Math.abs(value) >= 1 ? 4 : 6;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

function compactVolume(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function signed(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function usd(value: number, withSign = false): string {
  const sign = withSign ? (value >= 0 ? "+" : "−") : value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function setupProgress(price: number, setup: Candidate): string {
  const long = setup.direction === "LONG";
  if ((long && price <= setup.stopLoss) || (!long && price >= setup.stopLoss)) return "INVALIDATED";
  if ((long && price >= setup.tp3) || (!long && price <= setup.tp3)) return "TP3 REACHED";
  if ((long && price >= setup.tp2) || (!long && price <= setup.tp2)) return "TP2 REACHED";
  if ((long && price >= setup.tp1) || (!long && price <= setup.tp1)) return "TP1 REACHED";
  if (price >= setup.entryLow && price <= setup.entryHigh) return "IN ENTRY ZONE";
  if ((long && price > setup.entryHigh) || (!long && price < setup.entryLow)) return "RUNNING";
  return "WAIT ENTRY";
}

function gateLabel(gate: string): string {
  const labels: Record<string, string> = {
    BASE_SIGNAL_NO_TRADE: "arah 4H/1H belum sejalan",
    TIMEFRAME_CONFLICT: "tren 4H dan 1H berlawanan",
    SCORE_BELOW_75: "score teknikal di bawah 75",
    "15M_NOT_ALIGNED": "konfirmasi 15m belum masuk",
    ADX_BELOW_20: "kekuatan tren (ADX) kurang",
    RELATIVE_VOLUME_BELOW_0_9: "relative volume kurang",
    LIQUIDITY_TOO_LOW: "likuiditas kurang",
    SPREAD_ABOVE_6_BPS: "spread terlalu lebar",
    FUNDING_EXTREME: "funding terlalu ekstrem",
    OI_NOT_CONFIRMING: "open interest 45m belum mendukung",
    LOCATION_NOT_ACTIONABLE: "harga belum di level aksi",
    TRENDLINE_BROKEN: "trendline utama telah patah",
    PRICE_OVEREXTENDED: "harga terlalu jauh dari EMA21",
    STOP_DISTANCE_INVALID: "jarak invalidasi tidak efisien",
    STOP_DISTANCE_ATR_INVALID: "jarak SL di luar rentang ATR aman",
    STOP_DISTANCE_PERCENT_TOO_WIDE: "jarak SL melebihi batas risiko 20×",
    RR_BELOW_3_AFTER_COSTS: "R:R bersih di bawah 1:3",
    EVENT_BLACKOUT: "blackout event makro aktif",
    PROVIDER_UNAVAILABLE: "data provider tidak tersedia",
  };
  return labels[gate] ?? gate.toLowerCase().replaceAll("_", " ");
}

function adaptiveGateLabel(gate: string): string {
  const labels: Record<string, string> = {
    SHADOW_SCORE_BELOW_70: "shadow score belum 70",
    SHADOW_DIRECTION_EDGE_WEAK: "selisih arah belum tegas",
    SHADOW_LOCATION_NOT_ACTIONABLE: "lokasi belum actionable",
    SHADOW_TRENDLINE_BROKEN: "struktur arah sudah patah",
  };
  if (labels[gate]) return labels[gate];
  return gateLabel(gate.replace(/^SHADOW_/, ""));
}

function hotStatusLabel(status: HotVolumeStatus): string {
  const labels: Record<HotVolumeStatus, string> = {
    BREAKOUT_READY: "BREAKOUT READY",
    BREAKOUT_CONFIRMED: "BREAKOUT · WAIT RETEST",
    READY: "READY · SHADOW",
    LONG_PRESSURE: "LONG PRESSURE",
    SHORT_PRESSURE: "SHORT PRESSURE",
    HEATING: "HEATING",
    WAIT_PULLBACK: "WAIT PULLBACK",
    SQUEEZE: "SHORT SQUEEZE",
    LIQUIDATION_RISK: "LIQUIDATION",
    CHASE_RISK: "CHASE RISK",
  };
  return labels[status];
}

function marketCapSourceLabel(source: HotVolumeReport["source"]["marketCap"]): string {
  if (source === "COINPAPRIKA_KEYLESS") return "CoinPaprika fallback";
  if (source === "COINLORE_KEYLESS") return "CoinLore fallback";
  if (source === "VERIFIED_STALE_CACHE") return "Verified cache";
  return "CoinGecko";
}

function runtimeReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    EMPTY_SCAN: "scan kosong",
    INSUFFICIENT_SCAN_COVERAGE: "coverage scan kurang dari 80%",
    PROVIDER_FAILURE_CLUSTER: "banyak provider gagal",
    MISSING_CLOSED_CANDLES_CLUSTER: "banyak closed candle hilang",
    STALE_15M_CANDLE_CLUSTER: "banyak candle 15m stale",
    SCAN_HEALTH_NOT_VERIFIED: "kesehatan scan belum terverifikasi",
    SCAN_TIMESTAMP_STALE: "timestamp scan stale",
    HEALTH_TIMESTAMP_MISMATCH: "timestamp health tidak cocok",
    EVENT_BLACKOUT: "blackout event aktif",
    INTEL_UNAVAILABLE: "intel tidak tersedia",
  };
  return labels[reason] ?? reason.toLowerCase().replaceAll("_", " ");
}

function formatWib(value: string | null, includeDate = true): string {
  if (!value) return "Waktu resmi belum diumumkan";
  return new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: includeDate ? "2-digit" : undefined,
    month: includeDate ? "short" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function relativeAge(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}j`;
  return `${Math.round(minutes / 1440)}h`;
}

async function jsonOrThrow<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request gagal (${response.status})`);
  return payload;
}

function BiasPill({ item }: { item: NewsContextItem }) {
  const className = item.marketImpact === "POSITIVE CRYPTO/USDT"
    ? "bias-support"
    : item.marketImpact === "NEGATIVE CRYPTO/USDT"
      ? "bias-pressure"
      : "bias-neutral";
  const label = item.marketImpact === "POSITIVE CRYPTO/USDT"
    ? "POSITIF CRYPTO/USDT"
    : item.marketImpact === "NEGATIVE CRYPTO/USDT"
      ? "NEGATIF CRYPTO/USDT"
      : "NETRAL";
  return <span className={className}>{label}</span>;
}

function tradingViewUrl(symbol: string): string {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`BINANCE:${symbol}.P`)}`;
}

export default function Dashboard({ displayName, readOnlyViewer }: DashboardProps) {
  const [universe, setUniverse] = useState<UniverseItem[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [earlySignals, setEarlySignals] = useState<EarlySignal[]>([]);
  const [diagnostics, setDiagnostics] = useState<CandidateDiagnostic[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 30 });
  const [failed, setFailed] = useState<Record<string, string[]>>({});
  const [intelligence, setIntelligence] = useState<IntelligenceContext | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [activeMenu, setActiveMenu] = useState<MenuKey>("scanner");
  const [marketTab, setMarketTab] = useState<MarketTab>("hot");
  const [hotVolume, setHotVolume] = useState<HotVolumeView | null>(null);
  const [hotVolumeLoading, setHotVolumeLoading] = useState(false);
  const [hotVolumeError, setHotVolumeError] = useState<string | null>(null);
  const [hotVolumePage, setHotVolumePage] = useState(0);
  const [hotVolumeSelected, setHotVolumeSelected] = useState<string | null>(null);
  const [paperJournal, setPaperJournal] = useState<PaperJournal | null>(null);
  const [paperPrices, setPaperPrices] = useState<Record<string, number>>({});
  const [paperPricesUpdatedAt, setPaperPricesUpdatedAt] = useState<string | null>(null);
  const [paperFeedState, setPaperFeedState] = useState<"loading" | "live" | "retrying">("loading");
  const [paperPage, setPaperPage] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [adaptivePage, setAdaptivePage] = useState(0);
  const [exitPage, setExitPage] = useState(0);
  const [adaptiveFilter, setAdaptiveFilter] = useState<AdaptiveAuditFilter | null>(null);
  const [crossExchange, setCrossExchange] = useState<CrossExchangeSnapshot | null>(null);
  const [crossExchangeLoading, setCrossExchangeLoading] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationReport | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramCompanionStatus | null>(null);
  const [telegramTokenDraft, setTelegramTokenDraft] = useState("");
  const [telegramSetupBusy, setTelegramSetupBusy] = useState(false);
  const [telegramSetupError, setTelegramSetupError] = useState<string | null>(null);
  const [telegramPairingCommand, setTelegramPairingCommand] = useState<string | null>(null);
  const [manualExecution, setManualExecution] = useState<ManualExecutionStatus | null>(null);
  const [manualEntryDrafts, setManualEntryDrafts] = useState<Record<string, string>>({});
  const [manualActionTradeId, setManualActionTradeId] = useState<string | null>(null);
  const [paperCloseTradeId, setPaperCloseTradeId] = useState<string | null>(null);
  const [exitManagement, setExitManagement] = useState<ExitShadowReport | null>(null);
  const [collectorStatus, setCollectorStatus] = useState<BackgroundScanStatus | null>(null);
  const [collectorRunning, setCollectorRunning] = useState(false);
  const scanningRef = useRef(false);
  const hotVolumeLoadingRef = useRef(false);
  const paperOpenPanelRef = useRef<HTMLElement>(null);

  const runScan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setError(null);
    setScanState("prefilter");
    setProgress((current) => ({ done: 0, total: current.total || 30 }));
    try {
      setScanState("analyzing");
      const scan = await jsonOrThrow<{
        universe: UniverseItem[];
        results: AnalysisResult[];
        generatedAt: string;
        dataHealth: ScanDataHealth;
      }>("/api/scan");
      setUniverse(scan.universe);
      setProgress({ done: scan.results.length, total: scan.universe.length });
      setScanState("ranking");

      const failedMap = Object.fromEntries(
        scan.results.filter((item) => !item.candidate).map((item) => [item.symbol, item.failedGates]),
      );
      let nextDiagnostics = scan.results.map((item) => item.diagnostic);
      const allSetups = scan.results.flatMap((item) => {
        const setup = item.candidate ?? item.watchCandidate;
        return setup ? [{ ...setup }] : [];
      });
      const setupBySymbol = new Map(allSetups.map((item) => [item.symbol, item]));
      const technical = scan.results
        .flatMap((item) => item.candidate ? [setupBySymbol.get(item.symbol)!] : [])
        .sort((a, b) => b.technicalScore - a.technicalScore)
        .slice(0, 5);
      const earlyPriority: Record<EarlySignal["status"], number> = {
        ARMED: 0,
        ACCUMULATING: 1,
        "BASE ZONE": 2,
        WAIT: 3,
        LATE: 4,
        INVALID: 5,
      };
      const early = scan.results
        .flatMap((item) => item.earlySignal ? [item.earlySignal] : [])
        .sort((a, b) => earlyPriority[a.status] - earlyPriority[b.status] || b.score - a.score)
        .slice(0, 5);
      let potential: WatchItem[] = scan.results
        .filter((item) => !item.candidate && !item.failedGates.includes("PROVIDER_UNAVAILABLE"))
        .map((item) => ({
          diagnostic: { ...item.diagnostic },
          setup: item.watchCandidate ? setupBySymbol.get(item.symbol) ?? null : null,
        }));

      try {
        const params = new URLSearchParams();
        params.set("symbols", JSON.stringify(scan.universe.map((item) => item.symbol)));
        const contextInputs = [...allSetups]
          .sort((a, b) => b.technicalScore - a.technicalScore)
          .filter((item, index, items) => items.findIndex((candidate) => candidate.symbol === item.symbol) === index)
          .slice(0, 10)
          .map(({ symbol, direction }) => ({ symbol, direction }));
        params.set("items", JSON.stringify(contextInputs));
        const contextPayload = await jsonOrThrow<IntelligenceContext>(`/api/context?${params.toString()}`);
        setIntelligence(contextPayload);
        for (const candidate of allSetups) {
          const context = contextPayload.context[candidate.symbol];
          if (!context) continue;
          candidate.rankingScore = Math.max(0, Math.min(100, candidate.technicalScore + context.adjustment));
          candidate.catalysts = context.catalysts;
          candidate.contextAdjustment = context.adjustment;
          candidate.newsAdjustment = context.newsAdjustment;
        }
        if (contextPayload.events.blackout.active) {
          const setupSymbols = new Set(allSetups.map((candidate) => candidate.symbol));
          for (const candidate of technical) {
            failedMap[candidate.symbol] = ["EVENT_BLACKOUT"];
            const diagnostic = nextDiagnostics.find((item) => item.symbol === candidate.symbol);
            if (diagnostic) potential.unshift({
              diagnostic: { ...diagnostic, failedGates: ["EVENT_BLACKOUT"] },
              setup: candidate,
            });
          }
          nextDiagnostics = nextDiagnostics.map((item) =>
            setupSymbols.has(item.symbol)
              ? { ...item, failedGates: [...new Set([...item.failedGates, "EVENT_BLACKOUT"])] }
              : item,
          );
          technical.length = 0;
        }
      } catch {
        setIntelligence(null);
      }

      technical.sort((a, b) => b.rankingScore - a.rankingScore);
      potential = potential
        .filter((item, index, items) => items.findIndex((entry) => entry.diagnostic.symbol === item.diagnostic.symbol) === index)
        .sort((a, b) =>
          Number(a.diagnostic.direction === "NO TRADE") - Number(b.diagnostic.direction === "NO TRADE") ||
          a.diagnostic.failedGates.length - b.diagnostic.failedGates.length ||
          (b.setup?.rankingScore ?? b.diagnostic.technicalScore) - (a.setup?.rankingScore ?? a.diagnostic.technicalScore),
        )
        .slice(0, 5);
      const paperGates = new Map(nextDiagnostics.map((item) => [item.symbol, item.failedGates]));
      const paperCandidates = allSetups
        .map((item) => ({
          ...item,
          paperGateFailures: (paperGates.get(item.symbol) ?? []).filter((gate) => gate !== "SCORE_BELOW_75"),
        }))
        .filter((item) => item.rankingScore >= PAPER_MIN_SCORE && item.paperGateFailures.length === 0 && item.risk.gatePass)
        .sort((a, b) => b.rankingScore - a.rankingScore)
        .filter((item, index, items) => items.findIndex((candidate) => candidate.symbol === item.symbol) === index);
      if (!readOnlyViewer) {
        const journal = await jsonOrThrow<PaperJournal>("/api/paper-trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidates: paperCandidates, generatedAt: scan.generatedAt, dataHealth: scan.dataHealth }),
        }).catch(() => null);
        if (journal) setPaperJournal(journal);
        await jsonOrThrow<{ state: string; offered: number }>("/api/telegram/offers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidates: paperCandidates, generatedAt: scan.generatedAt, dataHealth: scan.dataHealth }),
        }).catch(() => null);
      }
      void jsonOrThrow<TelegramCompanionStatus>("/api/telegram/status").then(setTelegramStatus).catch(() => null);
      if (!readOnlyViewer) {
        // The authenticated background collector is the authoritative evaluation writer.
        // Manual browser scans only read its bounded report instead of uploading the full market payload.
        const evaluationReport = await jsonOrThrow<EvaluationReport>("/api/evaluation").catch(() => null);
        if (evaluationReport) setEvaluation(evaluationReport);
        const exitReport = await jsonOrThrow<ExitShadowReport>("/api/exit-management", { method: "POST" }).catch(() => null);
        if (exitReport) setExitManagement(exitReport);
      }
      setFailed(failedMap);
      setDiagnostics(nextDiagnostics);
      setCandidates(technical);
      setWatchlist(potential);
      setEarlySignals(early);
      setSelected((current) => {
        const currentSymbol = current?.replace(/^early:/, "") ?? null;
        const earlySelection = Boolean(current?.startsWith("early:"));
        if (earlySelection && early.some((item) => item.symbol === currentSymbol)) return current;
        if (!earlySelection && (
          technical.some((item) => item.symbol === currentSymbol) ||
          potential.some((item) => item.diagnostic.symbol === currentSymbol)
        )) return current;
        return technical[0]?.symbol ?? potential[0]?.diagnostic.symbol ?? (early[0] ? `early:${early[0].symbol}` : null);
      });
      setLastUpdated(new Date(scan.generatedAt));
      setScanState("live");
    } catch (scanError) {
      const fallbackContext = await jsonOrThrow<IntelligenceContext>(
        `/api/context?symbols=${encodeURIComponent("[]")}&items=${encodeURIComponent("[]")}`,
      ).catch(() => null);
      if (fallbackContext) setIntelligence(fallbackContext);
      setError(scanError instanceof Error ? scanError.message : "Scan cloud gagal.");
      setScanState("error");
    } finally {
      scanningRef.current = false;
    }
  }, [readOnlyViewer]);

  const logoutViewer = async () => {
    await fetch("/api/viewer/logout", { method: "POST" }).catch(() => null);
    window.location.reload();
  };

  useEffect(() => {
    const initial = window.setTimeout(() => void runScan(), 0);
    const refresh = window.setInterval(() => void runScan(), 15 * 60 * 1000);
    return () => { window.clearTimeout(initial); window.clearInterval(refresh); };
  }, [runScan]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleInstall);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
    return () => {
      window.clearInterval(clock);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleInstall);
    };
  }, []);

  useEffect(() => {
    if (paperJournal) return;
    void jsonOrThrow<PaperJournal>("/api/paper-trades").then(setPaperJournal).catch(() => null);
  }, [paperJournal]);

  useEffect(() => {
    if (evaluation) return;
    void jsonOrThrow<EvaluationReport>("/api/evaluation").then(setEvaluation).catch(() => null);
  }, [evaluation]);

  useEffect(() => {
    if (readOnlyViewer) {
      void jsonOrThrow<TelegramCompanionStatus>("/api/telegram/status").then(setTelegramStatus).catch(() => null);
      return;
    }
    void jsonOrThrow<{ status: TelegramCompanionStatus; pairingCommand: string | null }>("/api/telegram/setup")
      .then((payload) => { setTelegramStatus(payload.status); setTelegramPairingCommand(payload.pairingCommand); })
      .catch(() => null);
  }, [readOnlyViewer]);

  useEffect(() => {
    if (readOnlyViewer || !telegramStatus?.configured) return;
    const refresh = () => void jsonOrThrow<TelegramCompanionStatus>("/api/telegram/status")
      .then(setTelegramStatus).catch(() => null);
    const initial = window.setTimeout(refresh, 500);
    const timer = window.setInterval(refresh, 15_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [readOnlyViewer, telegramStatus?.configured]);

  const connectTelegram = async () => {
    if (!telegramTokenDraft.trim() || telegramSetupBusy) return;
    setTelegramSetupBusy(true);
    setTelegramSetupError(null);
    try {
      const result = await jsonOrThrow<{ botUsername: string; pairingCommand: string }>("/api/telegram/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: telegramTokenDraft }),
      });
      setTelegramTokenDraft("");
      setTelegramPairingCommand(result.pairingCommand);
      const payload = await jsonOrThrow<{ status: TelegramCompanionStatus; pairingCommand: string | null }>("/api/telegram/setup");
      setTelegramStatus(payload.status);
      setTelegramPairingCommand(payload.pairingCommand);
    } catch (setupError) {
      setTelegramSetupError(setupError instanceof Error ? setupError.message : "Bot gagal disambungkan.");
    } finally {
      setTelegramSetupBusy(false);
    }
  };

  useEffect(() => {
    void jsonOrThrow<ManualExecutionStatus>("/api/manual-execution").then(setManualExecution).catch(() => null);
  }, []);

  useEffect(() => {
    if (readOnlyViewer || activeMenu !== "paper" || !(manualExecution?.active ?? 0)) return;
    const refresh = () => void jsonOrThrow<ManualExecutionStatus>("/api/manual-execution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "REFRESH" }),
    }).then(setManualExecution).catch(() => null);
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [activeMenu, manualExecution?.active, readOnlyViewer]);

  useEffect(() => {
    if (exitManagement) return;
    void jsonOrThrow<ExitShadowReport>("/api/exit-management").then(setExitManagement).catch(() => null);
  }, [exitManagement]);

  useEffect(() => {
    void jsonOrThrow<BackgroundScanStatus>("/api/background/status").then(setCollectorStatus).catch(() => null);
  }, []);

  const runEvidenceCollector = async () => {
    if (readOnlyViewer || collectorRunning) return;
    setCollectorRunning(true);
    try {
      const result = await jsonOrThrow<{ status: BackgroundScanStatus }>("/api/background/status", { method: "POST" });
      setCollectorStatus(result.status);
      const [journal, evaluationReport, exitReport] = await Promise.all([
        jsonOrThrow<PaperJournal>("/api/paper-trades"),
        jsonOrThrow<EvaluationReport>("/api/evaluation"),
        jsonOrThrow<ExitShadowReport>("/api/exit-management"),
      ]);
      setPaperJournal(journal);
      setEvaluation(evaluationReport);
      setExitManagement(exitReport);
    } catch (collectorError) {
      setError(collectorError instanceof Error ? collectorError.message : "Collector gagal dengan aman.");
      void jsonOrThrow<BackgroundScanStatus>("/api/background/status").then(setCollectorStatus).catch(() => null);
    } finally {
      setCollectorRunning(false);
    }
  };

  const loadHotVolume = useCallback(async () => {
    if (hotVolumeLoadingRef.current) return;
    hotVolumeLoadingRef.current = true;
    setHotVolumeLoading(true);
    setHotVolumeError(null);
    try {
      const report = await jsonOrThrow<HotVolumeView>("/api/hot-volume", readOnlyViewer ? undefined : { method: "POST" });
      setHotVolume(report);
      setHotVolumePage(0);
      setHotVolumeSelected((current) => current && report.candidates.some((item) => item.symbol === current) ? current : report.candidates[0]?.symbol ?? null);
    } catch (radarError) {
      setHotVolumeError(radarError instanceof Error ? radarError.message : "Hot Volume Radar belum tersedia.");
    } finally {
      hotVolumeLoadingRef.current = false;
      setHotVolumeLoading(false);
    }
  }, [readOnlyViewer]);

  useEffect(() => {
    if (activeMenu !== "market" || marketTab !== "hot" || hotVolume || hotVolumeLoadingRef.current) return;
    void loadHotVolume();
  }, [activeMenu, hotVolume, loadHotVolume, marketTab]);

  const decideManualTrade = async (trade: PaperTrade, action: "EXECUTE" | "PASS" | "CLOSE", fallbackEntry?: number) => {
    if (readOnlyViewer || manualActionTradeId) return;
    setManualActionTradeId(trade.id);
    try {
      const draft = Number(manualEntryDrafts[trade.id]);
      const actualEntry = Number.isFinite(draft) && draft > 0 ? draft : fallbackEntry ?? trade.entryPrice;
      const status = await jsonOrThrow<ManualExecutionStatus>("/api/manual-execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId: trade.id, action, actualEntry }),
      });
      setManualExecution(status);
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : "Manual Execution gagal diproses.");
    } finally {
      setManualActionTradeId(null);
    }
  };

  const closePaperTrade = async (trade: PaperTrade, livePrice?: number) => {
    if (readOnlyViewer || paperCloseTradeId) return;
    const priceLabel = livePrice && livePrice > 0 ? compactPrice(livePrice) : "harga live server";
    if (!window.confirm(`Tutup paper ${trade.symbol} secara manual pada ${priceLabel}? Posisi akan dipindahkan ke History.`)) return;
    setPaperCloseTradeId(trade.id);
    try {
      const journal = await jsonOrThrow<PaperJournal>("/api/paper-trades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "MANUAL_CLOSE", tradeId: trade.id }),
      });
      setPaperJournal(journal);
      setPaperPage(0);
      setHistoryPage(0);
      const [monitor, exit] = await Promise.all([
        jsonOrThrow<ManualExecutionStatus>("/api/manual-execution").catch(() => null),
        jsonOrThrow<ExitShadowReport>("/api/exit-management").catch(() => null),
      ]);
      if (monitor) setManualExecution(monitor);
      if (exit) setExitManagement(exit);
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "Close manual paper gagal.");
    } finally {
      setPaperCloseTradeId(null);
    }
  };

  const paperSymbols = paperJournal?.openTrades.map((trade) => trade.symbol).sort().join(",") ?? "";
  useEffect(() => {
    if (!paperSymbols) return;
    let cancelled = false;
    let refreshTimer: number | null = null;
    const refreshPaperPrices = async () => {
      try {
        const feed = await jsonOrThrow<PaperPriceFeed>(`/api/paper-prices?symbols=${encodeURIComponent(paperSymbols)}`);
        if (cancelled) return;
        setPaperPrices(feed.prices);
        setPaperPricesUpdatedAt(feed.generatedAt);
        setPaperJournal(feed.journal);
        setPaperFeedState("live");
        refreshTimer = window.setTimeout(() => void refreshPaperPrices(), 30_000);
      } catch {
        if (cancelled) return;
        setPaperFeedState("retrying");
        refreshTimer = window.setTimeout(() => void refreshPaperPrices(), 60_000);
      }
    };
    void refreshPaperPrices();
    return () => {
      cancelled = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [paperSymbols]);

  const paperPageCount = Math.max(1, Math.ceil((paperJournal?.openTrades.length ?? 0) / PAPER_PAGE_SIZE));
  const safePaperPage = Math.min(paperPage, paperPageCount - 1);
  const pagedOpenTrades = paperJournal?.openTrades.slice(
    safePaperPage * PAPER_PAGE_SIZE,
    (safePaperPage + 1) * PAPER_PAGE_SIZE,
  ) ?? [];
  const historyPageCount = Math.max(1, Math.ceil((paperJournal?.history.length ?? 0) / PAPER_PAGE_SIZE));
  const safeHistoryPage = Math.min(historyPage, historyPageCount - 1);
  const pagedHistory = paperJournal?.history.slice(
    safeHistoryPage * PAPER_PAGE_SIZE,
    (safeHistoryPage + 1) * PAPER_PAGE_SIZE,
  ) ?? [];
  const paperFloatingSummary = useMemo(() => {
    const summary = { profit: 0, loss: 0, neutral: 0, updating: 0, liveOneR: 0 };
    for (const trade of paperJournal?.openTrades ?? []) {
      const metrics = paperPositionMetrics(trade, paperPrices[trade.symbol]);
      if (!metrics) {
        summary.updating += 1;
      } else if (metrics.roiPct > 0) {
        summary.profit += 1;
        const riskDistance = Math.abs(trade.entryPrice - trade.stopLoss);
        const favorableDistance = trade.direction === "LONG"
          ? metrics.livePrice - trade.entryPrice
          : trade.entryPrice - metrics.livePrice;
        if (riskDistance > 0 && favorableDistance / riskDistance >= 1) summary.liveOneR += 1;
      } else if (metrics.roiPct < 0) {
        summary.loss += 1;
      } else {
        summary.neutral += 1;
      }
    }
    return summary;
  }, [paperJournal?.openTrades, paperPrices]);
  const paperAccountLive = useMemo(() => {
    if (!paperJournal) return null;
    let floatingNetPnlUsd = 0;
    let pricedOpenTrades = 0;
    for (const trade of paperJournal.openTrades) {
      const metrics = paperPositionMetrics(trade, paperPrices[trade.symbol]);
      if (!metrics) continue;
      floatingNetPnlUsd += metrics.netPnlUsd;
      pricedOpenTrades += 1;
    }
    return {
      floatingNetPnlUsd,
      pricedOpenTrades,
      equityUsd: paperJournal.account.balanceUsd + floatingNetPnlUsd,
    };
  }, [paperJournal, paperPrices]);
  const changePaperPage = (nextPage: number) => {
    setPaperPage(Math.max(0, Math.min(nextPage, paperPageCount - 1)));
    window.requestAnimationFrame(() => paperOpenPanelRef.current?.scrollIntoView({ block: "start" }));
  };

  const earlySelection = Boolean(selected?.startsWith("early:"));
  const selectedSymbol = selected?.replace(/^early:/, "") ?? null;
  const activeReady = !earlySelection ? candidates.find((item) => item.symbol === selectedSymbol) ?? null : null;
  const activeWatch = !earlySelection ? watchlist.find((item) => item.diagnostic.symbol === selectedSymbol) ?? null : null;
  const activeEarly = earlySelection ? earlySignals.find((item) => item.symbol === selectedSymbol) ?? null : null;
  const active = activeReady ?? activeWatch?.setup ?? null;
  const activeDiagnostic = activeWatch?.diagnostic
    ?? (!earlySelection ? diagnostics.find((item) => item.symbol === selectedSymbol) : null)
    ?? null;
  const activeSymbol = activeEarly?.symbol ?? active?.symbol ?? activeDiagnostic?.symbol ?? null;
  const activeStatus = activeReady ? "TRADE READY" : activeWatch ? "POTENTIAL" : activeEarly?.status ?? null;
  const activePrice = active?.price ?? activeEarly?.price ?? activeDiagnostic?.price ?? 0;
  const activeChange = active?.change24h ?? activeEarly?.change24h ?? activeDiagnostic?.change24h ?? 0;
  const activeBaseAsset = active?.baseAsset ?? activeEarly?.baseAsset ?? activeDiagnostic?.baseAsset ?? activeSymbol?.replace(/USDT$/, "") ?? "—";
  const crossExchangeSymbol = activeEarly?.symbol ?? null;
  const crossExchangeDirection = activeEarly?.direction ?? null;
  const crossExchangeReferencePrice = activeEarly?.price ?? null;
  useEffect(() => {
    if (!crossExchangeSymbol || !crossExchangeDirection || !crossExchangeReferencePrice) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCrossExchange(null);
      setCrossExchangeLoading(true);
      const params = new URLSearchParams({
        symbol: crossExchangeSymbol,
        direction: crossExchangeDirection,
        referencePrice: String(crossExchangeReferencePrice),
      });
      void jsonOrThrow<CrossExchangeSnapshot>(`/api/cross-exchange?${params.toString()}`, { signal: controller.signal })
        .then((snapshot) => setCrossExchange(snapshot))
        .catch((loadError) => {
          if (loadError instanceof DOMException && loadError.name === "AbortError") return;
          setCrossExchange({ state: "unavailable", reason: "Konfirmasi exchange belum dapat dimuat." });
        })
        .finally(() => {
          if (!controller.signal.aborted) setCrossExchangeLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [crossExchangeDirection, crossExchangeReferencePrice, crossExchangeSymbol]);
  const gateSummary = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(failed).forEach((gates) => gates.forEach((gate) => counts.set(gate, (counts.get(gate) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [failed]);
  const adaptiveAudit = useMemo(() => {
    const summary = { total: 0, long: 0, short: 0, wait: 0, eligible: 0 };
    for (const diagnostic of diagnostics) {
      const shadow = diagnostic.adaptiveShadow;
      if (!shadow) continue;
      summary.total += 1;
      if (shadow.direction === "LONG") summary.long += 1;
      else if (shadow.direction === "SHORT") summary.short += 1;
      else summary.wait += 1;
      if (shadow.eligible) summary.eligible += 1;
    }
    return summary;
  }, [diagnostics]);
  const adaptiveCandidates = useMemo(() => diagnostics
    .filter((diagnostic) => {
      const shadow = diagnostic.adaptiveShadow;
      if (!shadow || !adaptiveFilter) return false;
      if (adaptiveFilter === "ELIGIBLE") return shadow.eligible;
      if (adaptiveFilter === "WAIT") return shadow.direction === "NO TRADE";
      return shadow.direction === adaptiveFilter;
    })
    .sort((a, b) => {
      const aShadow = a.adaptiveShadow!;
      const bShadow = b.adaptiveShadow!;
      const aScore = adaptiveFilter === "SHORT" ? aShadow.shortScore : adaptiveFilter === "LONG" ? aShadow.longScore : Math.max(aShadow.longScore, aShadow.shortScore);
      const bScore = adaptiveFilter === "SHORT" ? bShadow.shortScore : adaptiveFilter === "LONG" ? bShadow.longScore : Math.max(bShadow.longScore, bShadow.shortScore);
      return Number(bShadow.eligible) - Number(aShadow.eligible) || bScore - aScore || bShadow.scoreDelta - aShadow.scoreDelta;
    }), [adaptiveFilter, diagnostics]);
  const adaptivePageCount = Math.max(1, Math.ceil(adaptiveCandidates.length / PAPER_PAGE_SIZE));
  const safeAdaptivePage = Math.min(adaptivePage, adaptivePageCount - 1);
  const pagedAdaptiveCandidates = adaptiveCandidates.slice(
    safeAdaptivePage * PAPER_PAGE_SIZE,
    (safeAdaptivePage + 1) * PAPER_PAGE_SIZE,
  );
  const toggleAdaptiveFilter = (filter: AdaptiveAuditFilter) => {
    setAdaptivePage(0);
    setAdaptiveFilter((current) => current === filter ? null : filter);
  };
  const exitPageCount = Math.max(1, Math.ceil((exitManagement?.activePositions.length ?? 0) / PAPER_PAGE_SIZE));
  const safeExitPage = Math.min(exitPage, exitPageCount - 1);
  const pagedExitPositions = exitManagement?.activePositions.slice(
    safeExitPage * PAPER_PAGE_SIZE,
    (safeExitPage + 1) * PAPER_PAGE_SIZE,
  ) ?? [];
  const hotVolumePageCount = Math.max(1, Math.ceil((hotVolume?.candidates.length ?? 0) / PAPER_PAGE_SIZE));
  const safeHotVolumePage = Math.min(hotVolumePage, hotVolumePageCount - 1);
  const pagedHotVolume = hotVolume?.candidates.slice(
    safeHotVolumePage * PAPER_PAGE_SIZE,
    (safeHotVolumePage + 1) * PAPER_PAGE_SIZE,
  ) ?? [];
  const activeHotVolume = hotVolume?.candidates.find((item) => item.symbol === hotVolumeSelected) ?? null;
  const isScanning = ["prefilter", "analyzing", "ranking"].includes(scanState);
  const statusLabel = scanState === "prefilter"
    ? "Menyiapkan universe likuid"
    : scanState === "analyzing"
      ? "Analisis MTF + derivatives"
      : scanState === "ranking"
        ? "Validasi konteks & hard gate"
        : scanState === "live"
          ? "LIVE · siklus 15 menit"
          : scanState === "error" ? "DEGRADED" : "Menyiapkan mesin";

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const fng = intelligence?.fearGreed;
  const news = intelligence?.news.items ?? [];
  const events = intelligence?.events.items ?? [];
  const odds = intelligence?.predictionMarkets;

  return (
    <main className="terminal-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div><p>FIKO&apos;S PRIVATE DESK</p><h1>Crypto Futures Terminal</h1></div>
        </div>
        <div className="header-actions">
          {readOnlyViewer && <button className="secondary-button" onClick={() => void logoutViewer()} aria-label="Keluar dari viewer terminal">Keluar</button>}
          {installPrompt && <button className="secondary-button" onClick={install} aria-label="Pasang terminal di Android">Pasang</button>}
          <button className="refresh-button" disabled={isScanning} onClick={() => void runScan()}>
            <span aria-hidden="true">↻</span> {isScanning ? "Scanning" : "Scan ulang"}
          </button>
        </div>
      </header>

      <section className="status-strip" aria-live="polite">
        <span className={`live-dot ${online && scanState !== "error" ? "healthy" : "warning"}`} />
        <strong>{online ? statusLabel : "OFFLINE · data terakhir"}</strong>
        <span className="status-divider" />
        <span>{now ? `${now.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} WIB` : "— WIB"}</span>
        <span className="status-divider" /><span>READ ONLY</span><span className="status-spacer" />
        <span className="owner-chip"><b>{readOnlyViewer ? "Viewer" : "Private"}</b> · {displayName}</span>
      </section>

      {readOnlyViewer && <section className="viewer-readonly-banner"><strong>PUBLIC VIEWER · READ ONLY</strong><span>Sesi berakhir otomatis 5 jam setelah login. Data dapat dilihat, tetapi jurnal, evaluasi, dan Telegram tidak dapat diubah.</span></section>}

      {error && <section className="error-banner"><strong>Data cloud belum tersambung.</strong><span>{error} Tidak ada sinyal yang dipaksakan.</span></section>}
      {intelligence?.events.blackout.active && (
        <section className="blackout-banner"><strong>EVENT BLACKOUT</strong><span>{intelligence.events.blackout.event} · kandidat ditahan sampai {formatWib(intelligence.events.blackout.until)}</span></section>
      )}

      <nav className="terminal-nav" aria-label="Menu terminal">
        {([
          { key: "scanner", icon: "⌁", label: "Scanner", badge: candidates.length },
          { key: "early", icon: "◈", label: "Early", badge: earlySignals.length },
          { key: "intelligence", icon: "◎", label: "Intel", badge: news.length },
          { key: "paper", icon: "↗", label: "Paper", badge: paperJournal?.summary.open ?? 0 },
          { key: "evaluation", icon: "≋", label: "Eval", badge: evaluation?.shadow.resolved ?? 0 },
          { key: "market", icon: "▦", label: "Market", badge: universe.length },
        ] as Array<{ key: MenuKey; icon: string; label: string; badge: number }>).map((item) => (
          <button type="button" key={item.key} className={activeMenu === item.key ? "active" : ""} onClick={() => setActiveMenu(item.key)} aria-current={activeMenu === item.key ? "page" : undefined}>
            <span aria-hidden="true">{item.icon}</span><b>{item.label}</b><small>{item.badge}</small>
          </button>
        ))}
      </nav>

      {activeMenu === "scanner" && <section className="command-grid menu-view">
        <section className="panel candidates-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">HYBRID AUTO SCREENER</p><h2>High Quality Top 5</h2></div>
            <span className="counter">{candidates.length}<small>/5 lolos</small></span>
          </div>

          {adaptiveAudit.total > 0 && (
            <>
              <section className="adaptive-audit" aria-label="Audit arah Adaptive V3 shadow">
                <div className="adaptive-audit-title"><b>ADAPTIVE V3 · DIRECTION AUDIT</b><small>KETUK JUMLAH UNTUK MELIHAT KANDIDAT · SHADOW ONLY</small></div>
                <button type="button" className={`long ${adaptiveFilter === "LONG" ? "active" : ""}`} aria-pressed={adaptiveFilter === "LONG"} onClick={() => toggleAdaptiveFilter("LONG")}><small>LONG BIAS</small><b>{adaptiveAudit.long}</b></button>
                <button type="button" className={`short ${adaptiveFilter === "SHORT" ? "active" : ""}`} aria-pressed={adaptiveFilter === "SHORT"} onClick={() => toggleAdaptiveFilter("SHORT")}><small>SHORT BIAS</small><b>{adaptiveAudit.short}</b></button>
                <button type="button" className={adaptiveFilter === "WAIT" ? "active" : ""} aria-pressed={adaptiveFilter === "WAIT"} onClick={() => toggleAdaptiveFilter("WAIT")}><small>WAIT</small><b>{adaptiveAudit.wait}</b></button>
                <button type="button" className={`eligible ${adaptiveFilter === "ELIGIBLE" ? "active" : ""}`} aria-pressed={adaptiveFilter === "ELIGIBLE"} onClick={() => toggleAdaptiveFilter("ELIGIBLE")}><small>FULL GATE</small><b>{adaptiveAudit.eligible}</b></button>
              </section>
              {adaptiveFilter && (
                <section className="adaptive-candidates" aria-live="polite">
                  <div className="adaptive-candidates-heading">
                    <b>{adaptiveFilter === "ELIGIBLE" ? "FULL GATE" : `${adaptiveFilter} BIAS`} · {adaptiveCandidates.length} KANDIDAT</b>
                    <small>Ketuk pair untuk membuka bukti teknikal</small>
                  </div>
                  <div className="adaptive-candidates-list">
                  {adaptiveCandidates.length ? pagedAdaptiveCandidates.map((diagnostic) => {
                    const shadow = diagnostic.adaptiveShadow!;
                    const leadingDirection = shadow.direction === "NO TRADE" ? (shadow.longScore >= shadow.shortScore ? "LONG" : "SHORT") : shadow.direction;
                    return (
                      <button type="button" className={`adaptive-candidate-row ${activeSymbol === diagnostic.symbol ? "active" : ""}`} key={`${adaptiveFilter}:${diagnostic.symbol}`} onClick={() => setSelected(diagnostic.symbol)}>
                        <span className="adaptive-pair"><b>{diagnostic.baseAsset}</b><small>/USDT · {shadow.regime}</small></span>
                        <span className={`adaptive-direction ${leadingDirection.toLowerCase()}`}>{leadingDirection === "LONG" ? "▲" : "▼"} {shadow.direction === "NO TRADE" ? `${leadingDirection} LEAN` : leadingDirection}</span>
                        <span className="adaptive-scores"><b>L {shadow.longScore} · S {shadow.shortScore}</b><small>EDGE {shadow.scoreDelta}</small></span>
                        <span className={shadow.eligible ? "adaptive-reason pass" : "adaptive-reason"}>{shadow.eligible ? "FULL GATE PASS" : adaptiveGateLabel(shadow.gateFailures[0] ?? "WAIT")}</span>
                      </button>
                    );
                  }) : <p className="adaptive-empty">Belum ada kandidat pada kelompok ini di siklus scan sekarang.</p>}
                  </div>
                  {adaptivePageCount > 1 && <nav className="paper-pagination compact-pagination" aria-label="Halaman kandidat Adaptive">
                    <button type="button" aria-label="Kandidat sebelumnya" disabled={safeAdaptivePage === 0} onClick={() => setAdaptivePage(Math.max(0, safeAdaptivePage - 1))}>‹</button>
                    <span><b>{safeAdaptivePage + 1}</b><i>/</i>{adaptivePageCount}</span>
                    <button type="button" aria-label="Kandidat berikutnya" disabled={safeAdaptivePage >= adaptivePageCount - 1} onClick={() => setAdaptivePage(Math.min(adaptivePageCount - 1, safeAdaptivePage + 1))}>›</button>
                    <small>{PAPER_PAGE_SIZE} kandidat / halaman · geser kanan untuk detail</small>
                  </nav>}
                </section>
              )}
            </>
          )}

          {isScanning && (
            <div className="scan-progress">
              <div className="scan-track"><span style={{ width: scanState === "ranking" ? "92%" : "38%" }} /></div>
              <p>{statusLabel}. Closed candle 4H/1H/15m, OI 45m, taker flow, funding, likuiditas, dan R:R.</p>
            </div>
          )}

          {!isScanning && scanState === "live" && candidates.length === 0 && (
            <div className="empty-state">
              <span className="empty-icon">◇</span><h3>NO TRADE</h3>
              <p>Tidak ada setup yang lolos seluruh hard gate. Ini hasil valid, bukan kegagalan sistem.</p>
              <div className="gate-cloud">{gateSummary.map(([gate, count]) => <span key={gate}>{gateLabel(gate)} <b>{count}</b></span>)}</div>
            </div>
          )}

          {candidates.length > 0 && (
            <div className="candidate-list">
              {candidates.map((candidate, index) => (
                <button key={candidate.symbol} className={`candidate-row ${activeSymbol === candidate.symbol ? "active" : ""}`} onClick={() => setSelected(candidate.symbol)}>
                  <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                  <span className="pair"><b>{candidate.baseAsset}</b><small>/ USDT</small></span>
                  <span className={`direction ${candidate.direction.toLowerCase()}`}>{candidate.direction === "LONG" ? "▲" : "▼"} {candidate.direction}</span>
                  <span className="setup"><b>{candidate.setupType}</b><small>{candidate.location}</small></span>
                  <span className="score-ring"><b>{candidate.rankingScore}</b><small>rank</small></span>
                  <span className="row-price"><b>{compactPrice(candidate.price)}</b><small className={candidate.change24h >= 0 ? "positive" : "negative"}>{signed(candidate.change24h)}%</small></span>
                </button>
              ))}
            </div>
          )}

          {watchlist.length > 0 && (
            <div className="near-miss">
              <div className="near-title"><span>POTENTIAL WATCHLIST</span><small>Ketuk kandidat untuk membuka data setup · belum menjadi sinyal</small></div>
              {watchlist.map(({ diagnostic, setup }) => (
                <button type="button" className={`near-row ${activeSymbol === diagnostic.symbol ? "active" : ""}`} key={diagnostic.symbol} onClick={() => setSelected(diagnostic.symbol)}>
                  <b>{diagnostic.baseAsset}</b>
                  <span className={diagnostic.direction === "LONG" ? "positive" : diagnostic.direction === "SHORT" ? "negative" : "wait-direction"}>{diagnostic.direction === "LONG" ? "▲ LONG" : diagnostic.direction === "SHORT" ? "▼ SHORT" : "◇ WAIT"}</span>
                  <span>score {setup?.rankingScore ?? diagnostic.technicalScore}</span>
                  <small>{diagnostic.failedGates.slice(0, 2).map(gateLabel).join(" · ")}</small>
                </button>
              ))}
            </div>
          )}
          <p className="panel-note">Trade Ready: score ≥75 · ADX ≥20 · RelVol ≥0.9x · spread ≤6 bps · R:R bersih ≥1:3. Potential Watchlist menampilkan data kandidat terbaik yang belum lolos seluruh aturan.</p>
        </section>

        <section className="panel detail-panel">
          <div className="panel-heading compact">
            <div><p className="eyebrow">SETUP INTELLIGENCE DESK</p><h2>{activeSymbol ?? "Menunggu kandidat"}</h2></div>
            {activeStatus && <span className={`hero-direction ${activeStatus === "POTENTIAL" ? "potential" : activeEarly ? "early" : active?.direction.toLowerCase()}`}>{activeStatus}</span>}
          </div>
          {!activeSymbol ? (
            <div className="detail-placeholder"><div className="radar"><span /><span /><span /></div><p>Scanner akan menampilkan Trade Ready, Potential Watchlist, dan Early Radar. Pilih pair untuk membuka data setup lengkap.</p></div>
          ) : (
            <div className="detail-content">
              <section className="setup-spotlight">
                <span className="spotlight-symbol">{activeBaseAsset}</span>
                <div className="spotlight-copy">
                  <small>{activeStatus ?? "MARKET REVIEW"}</small>
                  <b>{active?.setupType ?? (activeEarly ? "EARLY ACCUMULATION WATCH" : "MANUAL REVIEW")}</b>
                  <span>{active?.location ?? "Data teknikal tersedia untuk review manual"}</span>
                </div>
                <div className="spotlight-price">
                  <small>SCAN PRICE · 24H</small>
                  <b>{compactPrice(activePrice)}</b>
                  <span className={activeChange >= 0 ? "positive" : "negative"}>{signed(activeChange)}%</span>
                </div>
                <a className="tradingview-button" href={tradingViewUrl(activeSymbol)} target="_blank" rel="noreferrer">BUKA TRADINGVIEW <span>↗</span></a>
              </section>

              {activeWatch && <div className="watch-alert"><strong>POTENTIAL · BELUM ENTRY</strong><span>{activeWatch.diagnostic.failedGates.slice(0, 4).map(gateLabel).join(" · ")}</span></div>}
              {activeEarly && <div className="watch-alert early-alert"><strong>{activeEarly.status} · {activeEarly.status === "ARMED" ? "TRIGGER AWAL" : "BELUM ENTRY"}</strong><span>Early Radar terpisah dari Trade Ready. Status hanya ditentukan oleh bukti teknikal dan hard gate risiko.</span></div>}
              {active ? <>
                <section className="data-block execution-block">
                  <div className="data-block-heading"><div><small>EXECUTION PLAN</small><b>{active.direction} · {setupProgress(active.price, active)}</b></div><span>R:R {active.adjustedRr.toFixed(2)}</span></div>
                  <div className="execution-grid">
                    <div className="entry"><small>ENTRY ZONE</small><b>{compactPrice(active.entryLow)} — {compactPrice(active.entryHigh)}</b><span>Tunggu harga masuk area</span></div>
                    <div className="stop"><small>INVALIDATION / SL</small><b>{compactPrice(active.stopLoss)}</b><span>Batas risiko wajib</span></div>
                    <div><small>TP 1 · 3R</small><b>{compactPrice(active.tp1)}</b><span>Partial pertama</span></div>
                    <div><small>TP 2 · 4R</small><b>{compactPrice(active.tp2)}</b><span>Partial lanjutan</span></div>
                    <div><small>TP 3 · 5R</small><b>{compactPrice(active.tp3)}</b><span>Target maksimum</span></div>
                    <div><small>NET R:R</small><b>1:{active.risk.netRiskReward.toFixed(2)}</b><span>Setelah estimasi biaya</span></div>
                    <div><small>SL DISTANCE</small><b>{active.risk.stopDistancePct.toFixed(2)}%</b><span>Struktur teknikal · tanpa batas % buatan</span></div>
                    <div><small>ATR DISTANCE</small><b>{active.risk.stopDistanceAtr.toFixed(2)}×</b><span>Minimal 0.50 ATR dari noise</span></div>
                    <div className="stop"><small>PLANNED MAX LOSS</small><b>−{usd(active.risk.estimatedLossAtStopUsd)}</b><span>{active.risk.riskPerTradePct.toFixed(0)}% equity · fee termasuk</span></div>
                    <div className="score"><small>RISK GATE</small><b>{active.risk.gatePass ? "PASS" : "REJECT"}</b><span>{active.risk.version}</span></div>
                    <div><small>NEWS CONTEXT</small><b>{signed(active.newsAdjustment ?? 0, 0)}</b><span>Maksimal ±3 poin</span></div>
                    <div className="score"><small>RULE SCORE</small><b>{active.rankingScore}/100</b><span>Technical {active.technicalScore}</span></div>
                  </div>
                </section>

                <section className="data-block">
                  <div className="data-block-heading"><div><small>MARKET SNAPSHOT</small><b>Multi-timeframe &amp; Derivatives</b></div><span>BINANCE USDⓈ-M</span></div>
                  <div className="metric-grid">
                    <div><small>4H BIAS</small><b>{active.snapshots.higher.trend}</b></div>
                    <div><small>1H RSI</small><b>{active.snapshots.primary.rsi.toFixed(1)}</b></div>
                    <div><small>1H ADX</small><b>{active.snapshots.primary.adx.toFixed(1)}</b></div>
                    <div><small>RELATIVE VOL</small><b>{active.snapshots.primary.relativeVolume.toFixed(2)}x</b></div>
                    <div><small>OI 45M</small><b className={active.oiChangePercent >= 0 ? "positive" : "negative"}>{signed(active.oiChangePercent)}%</b></div>
                    <div><small>TAKER RATIO</small><b>{active.takerBuySellRatio?.toFixed(2) ?? "—"}</b></div>
                    <div><small>FUNDING</small><b className={active.fundingRate >= 0 ? "positive" : "negative"}>{signed(active.fundingRate * 100, 4)}%</b></div>
                    <div><small>SPREAD</small><b>{active.spreadBps.toFixed(2)} bps</b></div>
                    <div><small>ATR 1H</small><b>{compactPrice(active.snapshots.primary.atr)}</b></div>
                    <div><small>24H VOLUME</small><b>${compactVolume(active.quoteVolume24h)}</b></div>
                  </div>
                </section>

                <section className="data-block timeframe-block">
                  <div className="data-block-heading"><div><small>TIMEFRAME LOG</small><b>Closed-candle evidence</b></div><span>4H · 1H · 15M</span></div>
                  <div className="timeframe-table">
                    <div className="timeframe-head"><span>TF</span><span>Trend</span><span>Close</span><span>RSI</span><span>ADX</span><span>RelVol</span><span>Closed WIB</span></div>
                    {[
                      { label: "4H", snapshot: active.snapshots.higher },
                      { label: "1H", snapshot: active.snapshots.primary },
                      { label: "15M", snapshot: active.snapshots.confirmation },
                    ].map(({ label, snapshot }) => <div className="timeframe-row" key={label}><b>{label}</b><span className={snapshot.trend === "BULLISH" ? "positive" : snapshot.trend === "BEARISH" ? "negative" : ""}>{snapshot.trend}</span><span>{compactPrice(snapshot.close)}</span><span>{snapshot.rsi.toFixed(1)}</span><span>{snapshot.adx.toFixed(1)}</span><span>{snapshot.relativeVolume.toFixed(2)}x</span><span>{new Date(snapshot.closedAt).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false })}</span></div>)}
                  </div>
                </section>

                <section className="data-block rationale-block">
                  <div className="data-block-heading"><div><small>WHY THIS SETUP</small><b>{active.location}</b></div><span>{active.trendline}</span></div>
                  <ol className="reason-list">
                    {active.reasons.map((reason) => <li key={reason}><span>✓</span>{reason}</li>)}
                    {active.catalysts.map((catalyst) => <li className="catalyst" key={catalyst}><span>◆</span>{catalyst}</li>)}
                  </ol>
                </section>
                <div className="risk-rule"><strong>RISK CAP 1%</strong><span>Ukuran posisi = batas rugi ÷ jarak entry–SL. Leverage hanya mengatur margin.</span></div>
                <p className="score-footnote">Score adalah hasil aturan, bukan probabilitas profit. Terminal tetap READ ONLY.</p>
              </> : activeEarly ? <>
                <section className="data-block">
                  <div className="data-block-heading"><div><small>EARLY LOCATION V2 · SHADOW</small><b>{activeEarly.direction} · {activeEarly.status}</b></div><span>Belum menjadi Trade Ready</span></div>
                  <div className="metric-grid early-summary">
                  <div><small>RULE SCORE</small><b>{activeEarly.score}/100</b></div>
                  <div><small>NEAREST KEY LEVEL</small><b>{activeEarly.nearestLevel.label} · {activeEarly.nearestLevel.distanceAtr.toFixed(2)} ATR</b></div>
                  <div><small>VOLATILITY</small><b>{activeEarly.volatilityState} · P{activeEarly.atrPercentile.toFixed(0)}</b></div>
                  <div><small>NEXT LEVEL SPACE</small><b>{activeEarly.nextLevel ? `${activeEarly.nextLevel.spaceAtr.toFixed(2)} ATR · ${activeEarly.nextLevel.label}` : "OPEN SPACE"}</b></div>
                  <div><small>OI 45M / TAKER</small><b>{signed(activeEarly.oiChangePercent)}% / {activeEarly.takerBuySellRatio?.toFixed(2) ?? "—"}</b></div>
                  <div><small>EXTENSION</small><b>{activeEarly.extensionAtr.toFixed(2)} ATR</b></div>
                  </div>
                </section>
                <section className="data-block cross-exchange-block">
                  <div className="data-block-heading"><div><small>CROSS-EXCHANGE V1</small><b>Bybit · OKX · Bitget</b></div><span>READ ONLY · SHADOW</span></div>
                  {crossExchangeLoading ? <p className="cross-exchange-message">Mengambil closed candle 15m dari exchange pembanding…</p> : crossExchange?.state === "healthy" && crossExchange.summary ? <>
                    <div className="cross-exchange-summary">
                      <div className={`cross-consensus ${(crossExchange.status ?? "INSUFFICIENT").toLowerCase()}`}><small>CONSENSUS</small><b>{crossExchange.status}</b><span>{crossExchange.summary.aligned}/{crossExchange.summary.available} searah · confidence {crossExchange.confidence}</span></div>
                      <div><small>PRICE INTEGRITY</small><b>{crossExchange.summary.priceIntegrity}/{crossExchange.summary.available}</b><span>Deviasi ≤75 bps dari Binance</span></div>
                      <div><small>EVIDENCE</small><b>{crossExchange.evidenceHash?.slice(0, 10) ?? "—"}</b><span>{crossExchange.generatedAt ? formatWib(crossExchange.generatedAt) : "—"}</span></div>
                    </div>
                    <div className="cross-exchange-list">
                      {crossExchange.exchanges?.map((exchange) => (
                        <div className={`cross-exchange-row ${exchange.alignment.toLowerCase()}`} key={exchange.exchange}>
                          <b>{exchange.exchange}</b>
                          <span>{exchange.state === "HEALTHY" && exchange.price !== null ? compactPrice(exchange.price) : "UNAVAILABLE"}</span>
                          <span className={exchange.change15mPercent !== null && exchange.change15mPercent >= 0 ? "positive" : "negative"}>{exchange.change15mPercent === null ? "—" : `${signed(exchange.change15mPercent)}% · 15M`}</span>
                          <span>{exchange.alignment}</span>
                        </div>
                      ))}
                    </div>
                  </> : <p className="cross-exchange-message">{crossExchange?.reason ?? "Cross-exchange menunggu kandidat Early dipilih."}</p>}
                  <p className="score-footnote">Konfirmasi ini tidak menambah score, tidak membuka paper, dan tidak mengubah keputusan live selama evidence gate belum terpenuhi.</p>
                </section>
                <ol className="reason-list">
                  {activeEarly.reasons.map((reason) => <li key={reason}><span>{reason.includes("belum") || reason.includes("Menunggu") ? "◇" : "✓"}</span>{reason}</li>)}
                </ol>
                <div className="risk-rule early-rule"><strong>LOCATION DISCIPLINE</strong><span>{activeEarly.status === "LATE" ? "Harga sudah lebih dari batas lokasi efisien; jangan dikejar." : activeEarly.status === "INVALID" ? "Key level sudah patah menurut closed candle; tunggu struktur baru." : activeEarly.status === "ARMED" ? "Trigger sudah terlihat; hanya kandidat yang lolos quality gate Telegram yang masuk AUTO PAPER." : "Pantau key level, ruang target, volume/OI, serta trigger closed candle berikutnya."}</span></div>
                <p className="score-footnote">Early Location V2 menghitung posisi harga, bukan peluang pump/drop dan bukan rekomendasi transaksi.</p>
              </> : activeDiagnostic?.snapshots ? <>
                <section className="data-block">
                  <div className="data-block-heading"><div><small>MANUAL REVIEW DATA</small><b>Belum ada arah valid</b></div><span>NO TRADE</span></div>
                  <div className="metric-grid watch-summary">
                  <div><small>4H BIAS</small><b>{activeDiagnostic.snapshots.higher.trend}</b></div>
                  <div><small>1H RSI / ADX</small><b>{activeDiagnostic.snapshots.primary.rsi.toFixed(1)} / {activeDiagnostic.snapshots.primary.adx.toFixed(1)}</b></div>
                  <div><small>RELATIVE VOL</small><b>{activeDiagnostic.snapshots.primary.relativeVolume.toFixed(2)}x</b></div>
                  <div><small>OI 45M / TAKER</small><b>{signed(activeDiagnostic.oiChangePercent)}% / {activeDiagnostic.takerBuySellRatio?.toFixed(2) ?? "—"}</b></div>
                  <div><small>FUNDING</small><b>{signed(activeDiagnostic.fundingRate * 100, 4)}%</b></div>
                  <div><small>SPREAD</small><b>{activeDiagnostic.spreadBps.toFixed(2)} bps</b></div>
                  </div>
                </section>
                <div className="blocker-list"><b>ALASAN DITAHAN</b>{activeDiagnostic.failedGates.map((gate) => <span key={gate}>{gateLabel(gate)}</span>)}</div>
                <p className="watch-copy">Arah setup belum terkonfirmasi, sehingga level entry/SL/TP tidak diterbitkan. Gunakan tombol TradingView hanya untuk review manual.</p>
              </> : null}
            </div>
          )}
        </section>
      </section>}

      {activeMenu === "early" && <section className="panel early-panel menu-view">
        <div className="panel-heading">
          <div><p className="eyebrow">EARLY LOCATION V2 · SHADOW</p><h2>Base &amp; Trigger Watch · Top 5</h2></div>
          <span className="provider-state healthy">TECHNICAL ONLY</span>
        </div>
        <div className="early-list">
          {earlySignals.length ? earlySignals.map((signal, index) => (
              <button type="button" className={`early-row ${selected === `early:${signal.symbol}` ? "active" : ""}`} key={signal.symbol} onClick={() => setSelected(`early:${signal.symbol}`)}>
                <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                <span className="pair"><b>{signal.baseAsset}</b><small>{signal.direction} · / USDT</small></span>
                <span className={`early-status ${signal.status.toLowerCase().replaceAll(" ", "-")}`}>{signal.status}</span>
                <span className="early-score"><b>{signal.score}</b><small>rule</small></span>
                <span className="early-metrics"><b>{signal.nearestLevel.label} · {signal.nearestLevel.distanceAtr.toFixed(2)} ATR</b><small>{signal.volatilityState} VOL P{signal.atrPercentile.toFixed(0)} · DIV {signal.divergenceKind} · ruang {signal.nextLevel ? `${signal.nextLevel.spaceAtr.toFixed(2)} ATR` : "terbuka"}</small></span>
                <span className="evidence-badges">
                  <i className={signal.direction === "LONG" ? "support" : "pressure"}>{signal.direction}</i>
                  <i className="neutral">{signal.volatilityState} VOL</i>
                </span>
                <span className="row-price"><b>{compactPrice(signal.price)}</b><small className={signal.change24h >= 0 ? "positive" : "negative"}>{signed(signal.change24h)}%</small></span>
              </button>
          )) : <div className="module-empty">Menunggu closed candle Binance. Tidak ada kandidat palsu saat provider gagal.</div>}
        </div>
        <p className="panel-note">Urutan shadow: key level → base zone → accumulation/divergence → closed-candle trigger → ruang menuju level berikutnya. Screening X sudah dihapus; status sepenuhnya teknikal.</p>
      </section>}

      {activeMenu === "intelligence" && <section className="intelligence-grid menu-view">
        <section className="panel news-panel">
          <div className="panel-heading compact">
            <div><p className="eyebrow">NEWS INTELLIGENCE</p><h2>Dampak Crypto/USDT</h2></div>
            <div className="intel-heading-state"><small>INTEL V2</small><span className={`provider-state ${intelligence?.news.state ?? "degraded"}`}>{intelligence?.news.state ?? "loading"}</span></div>
          </div>
          <div className="intel-quality-strip">
            <span><b>{intelligence?.news.quality.fresh ?? 0}</b> fresh</span>
            <span><b>{intelligence?.news.quality.reliable ?? 0}</b> reliable</span>
            <span><b>{intelligence?.news.quality.duplicatesRemoved ?? 0}</b> deduped</span>
          </div>
          <div className="news-list">
            {news.length ? news.slice(0, 6).map((item) => (
              <a className="news-row" key={item.url} href={item.url} target="_blank" rel="noreferrer">
                <div><BiasPill item={item} />{item.riskKeywords.slice(0, 2).map((word) => <span className="risk-tag" key={word}>{word}</span>)}</div>
                <b>{item.headline}</b>
                <span className="impact-reason">{item.impactReason} · confidence {item.impactConfidence}</span>
                <small>{item.publisher} · {item.freshness} · reliability {item.sourceReliability}/100 · {item.independentSourceCount} sumber{item.relatedAssets.length ? ` · ${item.relatedAssets.join(", ")}` : ""} · {relativeAge(item.publishedAt)} lalu</small>
              </a>
            )) : <div className="module-empty">{intelligence?.news.reason ?? "Memuat feed berita terverifikasi…"}</div>}
          </div>
          <p className="panel-note">Estimasi berbasis headline: USD kuat cenderung menekan Crypto/USDT, USD lemah cenderung mendukung. Konteks/ranking saja; hard gate tidak berubah.</p>
        </section>

        <div className="context-stack">
          <section className="panel sentiment-panel">
            <div className="panel-heading mini"><div><p className="eyebrow">MARKET SENTIMENT</p><h2>Fear & Greed</h2></div></div>
            <div className="fng-body">
              <div className={`fng-score ${(fng?.value ?? 50) >= 60 ? "greed" : (fng?.value ?? 50) <= 40 ? "fear" : ""}`}>{fng?.value ?? "—"}<small>/100</small></div>
              <div><b>{fng?.classification ?? "Loading"}</b><p>{fng?.previousValue === null || fng?.previousValue === undefined ? "Belum ada pembanding" : `Hari lalu ${fng.previousValue} · delta ${signed((fng.value ?? fng.previousValue) - fng.previousValue, 0)}`}</p></div>
            </div>
            <p className="source-note">Sumber: <a href={fng?.sourceUrl ?? "https://alternative.me/crypto/fear-and-greed-index/"} target="_blank" rel="noreferrer">Alternative.me</a> · konteks, bukan sinyal.</p>
          </section>

          <section className="panel macro-panel">
            <div className="panel-heading mini"><div><p className="eyebrow">MACRO REGIME</p><h2>{intelligence?.macro.regime ?? "Loading"}</h2></div><span className={`provider-state ${intelligence?.macro.state ?? "degraded"}`}>{intelligence?.macro.state ?? "loading"}</span></div>
            {intelligence?.macro.metrics.length ? (
              <div className="macro-grid">{intelligence.macro.metrics.map((metric) => <div key={metric.id}><small>{metric.label}</small><b>{metric.value.toFixed(2)}{metric.unit === "%" ? "%" : metric.unit ? ` ${metric.unit}` : ""}</b><span>{metric.change === null ? metric.observedAt : `${signed(metric.change, 2)}${metric.id === "DTWEXBGS" ? "%" : ""}`}</span></div>)}</div>
            ) : <div className="module-empty compact-empty">{intelligence?.macro.reasons[0] ?? "Memuat FRED…"}</div>}
            <p className="source-note">Sumber: <a href={intelligence?.macro.sourceUrl ?? "https://fred.stlouisfed.org/"} target="_blank" rel="noreferrer">FRED</a> · {intelligence?.macro.sourceMode === "api" ? "API resmi" : intelligence?.macro.sourceMode === "public_csv" ? "CSV resmi tanpa token" : "fallback netral"}.</p>
          </section>
        </div>

        <section className="panel events-panel">
          <div className="panel-heading compact"><div><p className="eyebrow">EVENT RISK</p><h2>Kalender Makro</h2></div><span className={`provider-state ${intelligence?.events.state ?? "degraded"}`}>{intelligence?.events.state === "healthy" ? "live" : "fallback"}</span></div>
          <div className="event-list">
            {events.map((event) => (
              <a href={event.source} target="_blank" rel="noreferrer" className="event-row" key={event.name}>
                <span className="impact-dot" /><div><b>{event.name}</b><small>{event.scheduledAt ? `${formatWib(event.scheduledAt)} WIB` : `${event.eventDate} · waktu resmi belum diumumkan`}</small></div>
              </a>
            ))}
          </div>
          <p className="panel-note">{intelligence?.events.reason ? `${intelligence.events.reason} ` : ""}Blackout: 60 menit sebelum sampai 30 menit sesudah event bertimestamp resmi.</p>
        </section>

        <section className="panel odds-panel">
          <div className="panel-heading compact">
            <div><p className="eyebrow">MARKET ODDS</p><h2>Probabilitas Publik</h2></div>
            <span className={`provider-state ${odds?.state ?? "degraded"}`}>{odds?.state ?? "loading"}</span>
          </div>
          <div className="odds-list">
            {odds?.items.length ? odds.items.map((item) => (
              <a className="odds-row" key={`${item.sourceUrl}:${item.question}`} href={item.sourceUrl} target="_blank" rel="noreferrer">
                <div className="odds-probability"><b>{item.probability.toFixed(item.probability % 1 ? 1 : 0)}%</b><small>{item.outcome}</small></div>
                <div className="odds-question"><span>{item.category}{item.relatedAssets.length ? ` · ${item.relatedAssets.join(", ")}` : ""}</span><b>{item.question}</b><small>Vol 24j US${compactVolume(item.volume24h)} · selesai {item.endDate ? `${formatWib(item.endDate)} WIB` : "belum diumumkan"}</small></div>
                <strong className={item.change24h === null ? "" : item.change24h >= 0 ? "positive" : "negative"}>{item.change24h === null ? "—" : `${signed(item.change24h, 1)} pp`}</strong>
              </a>
            )) : <div className="module-empty compact-empty">{odds?.reason ?? "Memuat market odds publik…"}</div>}
          </div>
          <p className="panel-note">Harga Polymarket = probabilitas tersirat, bukan kepastian atau sinyal entry. Data ini hanya konteks; tidak dapat meloloskan setup teknikal.</p>
        </section>
      </section>}

      {activeMenu === "paper" && <section className="paper-workspace menu-view">
        <section className="panel telegram-companion-panel manual-execution-panel">
          <div className="panel-heading compact">
            <div><p className="eyebrow">POSITION CONTROL · TERMINAL V1</p><h2>Monitor / Pass / Manual Close</h2></div>
            <span className="provider-state healthy">READY</span>
          </div>
          <div className="telegram-companion-body">
            <div className="telegram-companion-copy"><strong>OWNER CONTROL · CLOSED-CANDLE 15M</strong><span>START MONITOR berarti mulai memantau entry manual. PASS melewati setup. CLOSE PAPER menutup jurnal pada harga live server dan memindahkannya ke History.</span></div>
            <div className="telegram-companion-stats">
              <span><small>MONITORING</small><b>{manualExecution?.active ?? 0}</b></span>
              <span><small>PASS</small><b>{manualExecution?.passed ?? 0}</b></span>
              <span><small>CLOSED</small><b>{manualExecution?.closed ?? 0}</b></span>
              <span><small>TELEGRAM</small><b>{telegramStatus?.configured && telegramStatus.paired ? "PAIRED" : "LATER"}</b></span>
            </div>
          </div>
          {!readOnlyViewer && !telegramStatus?.configured && <div className="telegram-secure-setup">
            <div><strong>CONNECT @{telegramStatus?.botUsername ?? "FikoFuturesMonitorBot"}</strong><span>Tempel token BotFather di sini. Token dikirim melalui HTTPS, diverifikasi ke Telegram, lalu disimpan terenkripsi; token tidak ditampilkan kembali.</span></div>
            <label><span>BOTFATHER TOKEN</span><input type="password" value={telegramTokenDraft} onChange={(event) => setTelegramTokenDraft(event.target.value)} autoComplete="off" spellCheck={false} placeholder="123456789:AA…" /></label>
            <button type="button" onClick={() => void connectTelegram()} disabled={telegramSetupBusy || !telegramTokenDraft.trim()}>{telegramSetupBusy ? "CONNECTING…" : "CONNECT BOT"}</button>
            {telegramSetupError && <p className="telegram-setup-error">{telegramSetupError}</p>}
          </div>}
          {!readOnlyViewer && telegramStatus?.configured && !telegramStatus.paired && telegramPairingCommand && <div className="telegram-pairing-step">
            <div><strong>BOT CONNECTED · PAIRING TERAKHIR</strong><span>Buka @{telegramStatus.botUsername ?? "FikoFuturesMonitorBot"}, lalu kirim perintah sekali pakai berikut.</span></div>
            <code>{telegramPairingCommand}</code>
            <a href={`https://t.me/${telegramStatus.botUsername ?? "FikoFuturesMonitorBot"}`} target="_blank" rel="noreferrer">OPEN TELEGRAM ↗</a>
          </div>}
          {!readOnlyViewer && telegramStatus?.configured && telegramStatus.paired && <div className="telegram-paired-state"><strong>✓ @{telegramStatus.botUsername} PAIRED</strong><span>Polling private aktif saat terminal terbuka. Alert hanya dikirim saat state strategi berubah.</span></div>}
          <p className="panel-note">START MONITOR tidak menutup posisi dan tidak mengirim order. Saran PROTECT muncul mulai ≥1R; volume turun sendirian tidak pernah memicu CLOSE.</p>
        </section>

        <section className="panel paper-summary-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">RISK V3 · FIXED FRACTIONAL</p><h2>V3 Entry Journal</h2></div>
            <span className="paper-mode"><i /> SIMULATION ON</span>
          </div>
          <div className="paper-safety-note">
            <strong>{paperJournal?.runtimeSafety.entryCircuit === "OPEN" ? "ENTRY CIRCUIT OPEN" : "NEW ENTRY BLOCKED"}</strong>
            <span>{paperJournal?.runtimeSafety.entryCircuit === "OPEN" ? `Data inti sehat. Cooldown ${paperJournal.runtimeSafety.cooldownHours} jam dan structural reset tetap berlaku per pair.` : `Ditahan: ${paperJournal?.runtimeSafety.reasons.map(runtimeReasonLabel).join(" · ") || "menunggu scan sehat"}. Posisi lama tetap dipantau.`}</span>
          </div>
          <div className="runtime-safety-strip" aria-label="Runtime Safety V1">
            <span className={paperJournal?.runtimeSafety.dataHealthState === "HEALTHY" ? "healthy" : "blocked"}><small>DATA HEALTH</small><b>{paperJournal?.runtimeSafety.dataHealthState ?? "UNKNOWN"}</b></span>
            <span className={paperJournal?.runtimeSafety.entryCircuit === "OPEN" ? "healthy" : "blocked"}><small>ENTRY CIRCUIT</small><b>{paperJournal?.runtimeSafety.entryCircuit ?? "BLOCKED"}</b></span>
            <span className={(paperJournal?.runtimeSafety.cooldownBlocked.length ?? 0) ? "warning" : "healthy"}><small>COOLDOWN BLOCK</small><b>{paperJournal?.runtimeSafety.cooldownBlocked.length ?? 0}</b></span>
          </div>
          <div className="paper-stat-grid">
            <div><small>OPEN · V3</small><b>{paperJournal?.summary.open ?? 0}</b><span>Legacy terpisah: {paperJournal?.summary.legacyOpen ?? 0} open</span></div>
            <div><small>RESOLVED · V3</small><b>{paperJournal?.summary.resolved ?? 0}</b><span>TP + SL + MANUAL</span></div>
            <div><small>TP RATE · V3</small><b>{(paperJournal?.summary.wins ?? 0) + (paperJournal?.summary.losses ?? 0) ? `${paperJournal!.summary.winRate.toFixed(1)}%` : "—"}</b><span>{paperJournal?.summary.wins ?? 0} TP · {paperJournal?.summary.losses ?? 0} SL · {paperJournal?.summary.manualClosed ?? 0} manual</span></div>
            <div><small>EXPECTANCY</small><b className={(paperJournal?.summary.expectancyR ?? 0) >= 0 ? "positive" : "negative"}>{paperJournal?.summary.resolved ? `${signed(paperJournal.summary.expectancyR)}R` : "—"}</b><span>rata-rata / trade</span></div>
            <div><small>NET RESULT</small><b className={(paperJournal?.summary.netR ?? 0) >= 0 ? "positive" : "negative"}>{paperJournal?.summary.resolved ? `${signed(paperJournal.summary.netR)}R` : "—"}</b><span>paper only</span></div>
          </div>
        </section>

        <section className="panel paper-account-panel">
          <div className="panel-heading compact">
            <div><p className="eyebrow">PAPER ACCOUNT · USD JOURNAL</p><h2>$1,000 Simulation Ledger</h2></div>
            <span className="paper-mode"><i /> 2% RISK / TRADE</span>
          </div>
          <div className="paper-account-grid" aria-label="Ringkasan akun paper simulasi">
            <div><small>INITIAL CAPITAL</small><b>{paperJournal ? usd(paperJournal.account.initialCapitalUsd) : "—"}</b><span>paper account</span></div>
            <div><small>REALIZED BALANCE</small><b className={(paperJournal?.account.realizedNetPnlUsd ?? 0) >= 0 ? "positive" : "negative"}>{paperJournal ? usd(paperJournal.account.balanceUsd) : "—"}</b><span>{paperJournal ? `${signed(paperJournal.account.realizedReturnPct)}% realized` : "memuat jurnal"}</span></div>
            <div><small>LIVE EQUITY</small><b className={(paperAccountLive?.floatingNetPnlUsd ?? 0) >= 0 ? "positive" : "negative"}>{paperAccountLive ? usd(paperAccountLive.equityUsd) : "—"}</b><span>{paperAccountLive ? `${paperAccountLive.pricedOpenTrades}/${paperJournal?.openTrades.length ?? 0} harga live` : "menunggu feed"}</span></div>
            <div><small>REALIZED P&amp;L</small><b className={(paperJournal?.account.realizedNetPnlUsd ?? 0) >= 0 ? "positive" : "negative"}>{paperJournal ? usd(paperJournal.account.realizedNetPnlUsd, true) : "—"}</b><span>setelah estimasi biaya</span></div>
            <div><small>FLOATING P&amp;L</small><b className={(paperAccountLive?.floatingNetPnlUsd ?? 0) >= 0 ? "positive" : "negative"}>{paperAccountLive ? usd(paperAccountLive.floatingNetPnlUsd, true) : "—"}</b><span>mark-to-market</span></div>
            <div><small>MARGIN IN USE</small><b>{paperJournal ? usd(paperJournal.account.openMarginUsd) : "—"}</b><span>V3 planned risk {paperJournal ? usd(paperJournal.account.openPlannedRiskUsd) : "—"}</span></div>
          </div>
          <div className="paper-account-secondary">
            <span><small>FREE BALANCE</small><b>{paperJournal ? usd(paperJournal.account.freeBalanceUsd) : "—"}</b></span>
            <span><small>PROFIT FACTOR</small><b>{paperJournal?.account.profitFactor === null || paperJournal?.account.profitFactor === undefined ? "—" : paperJournal.account.profitFactor.toFixed(2)}</b></span>
            <span><small>EXPECTANCY</small><b className={(paperJournal?.account.expectancyUsd ?? 0) >= 0 ? "positive" : "negative"}>{paperJournal ? usd(paperJournal.account.expectancyUsd, true) : "—"}</b></span>
            <span><small>MAX DRAWDOWN</small><b className="negative">{paperJournal ? `${usd(-paperJournal.account.maxDrawdownUsd)} · ${paperJournal.account.maxDrawdownPct.toFixed(1)}%` : "—"}</b></span>
            <span><small>MARGIN-LOSS CAP</small><b className={(paperJournal?.account.marginLossCaps ?? 0) ? "negative" : "positive"}>{paperJournal?.account.marginLossCaps ?? 0}</b></span>
            <span><small>AVAILABLE V3 RISK</small><b className="positive">{paperJournal ? usd(paperJournal.account.availableRiskUsd) : "—"}</b></span>
          </div>
          <div className="paper-system-evaluation">
            <div className="paper-evaluation-verdict">
              <small>CURRENT SYSTEM EVALUATION</small>
              <b className={paperJournal?.systemEvaluation.verdict === "UNDERPERFORMING" ? "negative" : ""}>{paperJournal?.systemEvaluation.verdict.replaceAll("_", " ") ?? "LOADING"}</b>
              <strong>{paperJournal?.systemEvaluation.promotionDecision ?? "KEEP COLLECTING"}</strong>
            </div>
            <div className="paper-evaluation-copy"><b>{paperJournal?.systemEvaluation.headline ?? "Menghitung performa paper journal."}</b>{paperJournal?.systemEvaluation.reasons.map((reason) => <span key={reason}>• {reason}</span>)}</div>
          </div>
          {!!paperJournal?.account.byModel.length && <div className="paper-model-ledger">
            <div className="paper-model-head"><span>Model</span><span>Total</span><span>Resolved</span><span>Win rate</span><span>Net P&amp;L</span><span>Expectancy</span></div>
            {paperJournal.account.byModel.map((model) => <div className="paper-model-row" key={model.modelVersion}>
              <span><b>{model.modelVersion}</b><small>{model.open} open · {model.marginLossCaps} margin cap</small></span>
              <span>{model.total}</span><span>{model.resolved}</span><span>{model.resolved ? `${model.winRate.toFixed(1)}%` : "—"}</span>
              <span className={model.realizedNetPnlUsd >= 0 ? "positive" : "negative"}>{usd(model.realizedNetPnlUsd, true)}</span>
              <span className={model.expectancyUsd >= 0 ? "positive" : "negative"}>{model.resolved ? usd(model.expectancyUsd, true) : "—"}</span>
            </div>)}
          </div>}
          <p className="panel-note">V1 legacy tetap memakai margin $10 × {paperJournal?.account.defaultLeverage ?? PAPER_LEVERAGE}. Semua posisi V3 baru memakai sizing dinamis agar estimasi rugi di SL—termasuk biaya—maksimum 2% dari realized balance, dengan leverage maksimum {paperJournal?.account.defaultLeverage ?? PAPER_LEVERAGE}×.</p>
        </section>

        <section className="panel exit-shadow-panel">
          <div className="panel-heading compact">
            <div><p className="eyebrow">EXIT MANAGEMENT V2 · SHADOW</p><h2>Partial + Net BE + Runner</h2></div>
            <span className="paper-mode shadow"><i /> SHADOW ONLY</span>
          </div>
          <div className="exit-shadow-rule"><strong>25% @ +1R → NET BE</strong><span>25% TP1 · 25% TP2 · 25% TP3. Stop dan target pada candle 15m yang sama dihitung konservatif sebagai stop.</span></div>
          <div className="exit-comparison" aria-label="Perbandingan Exit V2 forward dengan baseline">
            <div><small>PAIRED FORWARD</small><b>{exitManagement?.comparison.forward.pairedResolved ?? 0}<i>/{exitManagement?.comparison.minimumPairedResolved ?? 30}</i></b><span>{exitManagement?.comparison.evidenceGate === "READY_TO_REVIEW" ? "siap direview" : "mengumpulkan bukti"}</span></div>
            <div><small>STAGED EXPECTANCY</small><b className={(exitManagement?.comparison.forward.stagedExpectancyR ?? 0) >= 0 ? "positive" : "negative"}>{exitManagement?.comparison.forward.stagedExpectancyR === null || exitManagement?.comparison.forward.stagedExpectancyR === undefined ? "—" : `${signed(exitManagement.comparison.forward.stagedExpectancyR)}R`}</b><span>resolved berpasangan</span></div>
            <div><small>BASELINE EXPECTANCY</small><b className={(exitManagement?.comparison.forward.baselineExpectancyR ?? 0) >= 0 ? "positive" : "negative"}>{exitManagement?.comparison.forward.baselineExpectancyR === null || exitManagement?.comparison.forward.baselineExpectancyR === undefined ? "—" : `${signed(exitManagement.comparison.forward.baselineExpectancyR)}R`}</b><span>pair yang sama</span></div>
            <div><small>DELTA EXPECTANCY</small><b className={(exitManagement?.comparison.forward.deltaExpectancyR ?? 0) >= 0 ? "positive" : "negative"}>{exitManagement?.comparison.forward.deltaExpectancyR === null || exitManagement?.comparison.forward.deltaExpectancyR === undefined ? "—" : `${signed(exitManagement.comparison.forward.deltaExpectancyR)}R`}</b><span>belum verdict otomatis</span></div>
            <div><small>RUNNER BRIDGE</small><b>{exitManagement?.comparison.bridge.active ?? 0}</b><span>{signed(exitManagement?.comparison.bridge.realizedToDateR ?? 0)}R realized</span></div>
            <div><small>LEGACY EXCLUDED</small><b>{exitManagement?.comparison.excludedLegacy ?? 0}</b><span>tidak mencemari hasil</span></div>
          </div>
          <div className="exit-shadow-stats">
            <div><small>ACTIVE RUNNERS</small><b>{exitManagement?.summary.active ?? 0}</b><span>{exitManagement?.summary.open ?? 0} belum +1R</span></div>
            <div><small>BE PROTECTED</small><b className="positive">{exitManagement?.summary.protected ?? 0}</b><span>{exitManagement?.summary.beArmed ?? 0} baru armed</span></div>
            <div><small>TP1 PARTIAL</small><b>{exitManagement?.summary.tp1Partial ?? 0}</b><span>sisa 50%</span></div>
            <div><small>TP2 PARTIAL</small><b>{exitManagement?.summary.tp2Partial ?? 0}</b><span>sisa 25%</span></div>
            <div><small>FULL TP · TP3</small><b className="positive">{exitManagement?.summary.fullTp ?? 0}</b><span>runner selesai</span></div>
            <div><small>PROTECTED / MANUAL</small><b className="positive">{exitManagement?.summary.protectedExit ?? 0} / {exitManagement?.summary.manualClose ?? 0}</b><span>net BE / close owner</span></div>
          </div>
          <div className="exit-shadow-list">
            {exitManagement?.activePositions.length ? pagedExitPositions.map((position) => (
              <div className="exit-shadow-row" key={position.id}>
                <span className={`direction ${position.direction.toLowerCase()}`}>{position.direction === "LONG" ? "▲" : "▼"} {position.direction}</span>
                <span><b>{position.symbol}</b><small>{position.sourceModelVersion} · {position.state.replaceAll("_", " ")} · {position.cohort.replaceAll("_", " ")}</small></span>
                <span><small>REALIZED</small><b className={position.realizedR >= 0 ? "positive" : "negative"}>{signed(position.realizedR)}R</b></span>
                <span><small>REMAINING</small><b>{Math.round(position.remainingFraction * 100)}%</b></span>
                <span><small>ACTIVE STOP</small><b>{compactPrice(position.activeStop)}</b></span>
                <span><small>NEXT</small><b>{compactPrice(position.state === "OPEN" ? position.oneRPrice : position.state === "BE_ARMED" ? position.tp1 : position.state === "TP1_PARTIAL" ? position.tp2 : position.tp3)}</b></span>
              </div>
            )) : <div className="module-empty compact-empty">Exit shadow akan dibuat dari jurnal paper pada sinkronisasi owner berikutnya.</div>}
          </div>
          {exitPageCount > 1 && <nav className="paper-pagination compact-pagination" aria-label="Halaman Exit shadow">
            <button type="button" aria-label="Exit sebelumnya" disabled={safeExitPage === 0} onClick={() => setExitPage(Math.max(0, safeExitPage - 1))}>‹</button>
            <span><b>{safeExitPage + 1}</b><i>/</i>{exitPageCount}</span>
            <button type="button" aria-label="Exit berikutnya" disabled={safeExitPage >= exitPageCount - 1} onClick={() => setExitPage(Math.min(exitPageCount - 1, safeExitPage + 1))}>›</button>
            <small>{PAPER_PAGE_SIZE} posisi / halaman</small>
          </nav>}
          <p className="panel-note">Expectancy hanya dihitung dari posisi forward yang sudah selesai di kedua strategi pada pair yang sama. Runner SOL sebelum aktivasi ditandai RUNNER BRIDGE; SL historis dikeluarkan dari comparison. Baseline dan History lama tidak diubah.</p>
        </section>

        <section className="panel paper-open-panel" ref={paperOpenPanelRef}>
          <div className="panel-heading compact"><div><p className="eyebrow">RUNNING SETUPS</p><h2>Open Paper Trades</h2></div><span className="counter small-counter">{paperJournal?.openTrades.length ?? 0}</span></div>
          {!!paperJournal?.openTrades.length && <div className="paper-open-hint"><span>Klik pair untuk membuka detail posisi.</span><b className={paperFeedState}>{paperFeedState === "live" && paperPricesUpdatedAt ? `LIVE ${formatWib(paperPricesUpdatedAt, false)} WIB` : paperFeedState === "retrying" ? "FEED RETRY OTOMATIS" : "MEMUAT HARGA LIVE…"} · LEV ≤{PAPER_LEVERAGE}×</b></div>}
          {!!paperJournal?.openTrades.length && <div className="paper-floating-summary four" aria-label="Ringkasan floating paper trade aktif">
            <div className="profit"><small>FLOAT PROFIT</small><b>{paperFloatingSummary.profit}</b><span>trade</span></div>
            <div className="loss"><small>FLOAT LOSS</small><b>{paperFloatingSummary.loss}</b><span>trade</span></div>
            <div className="pending"><small>FLAT / UPDATE</small><b>{paperFloatingSummary.neutral + paperFloatingSummary.updating}</b><span>trade</span></div>
            <div className="review"><small>LIVE ≥1R</small><b>{paperFloatingSummary.liveOneR}</b><span>profit kuat sekarang</span></div>
          </div>}
          <div className="paper-trade-list">
            {paperJournal?.openTrades.length ? pagedOpenTrades.map((trade) => {
              const metrics = paperPositionMetrics(trade, paperPrices[trade.symbol]);
              const performanceClass = (metrics?.roiPct ?? 0) >= 0 ? "positive" : "negative";
              const manualMonitor = manualExecution?.monitors.find((item) => item.paperTradeId === trade.id) ?? null;
              return <details className={`paper-trade-card paper-trade-accordion ${metrics ? performanceClass : "neutral"}`} key={trade.id}>
                <summary className="paper-trade-summary">
                  <span className={`direction ${trade.direction.toLowerCase()}`}>{trade.direction === "LONG" ? "▲" : "▼"} {trade.direction}</span>
                  <span className="paper-trade-identity"><b>{trade.symbol}</b><small>{trade.setupType}</small><em className={`paper-running ${trade.modelVersion === "V1" ? "legacy" : ""}`}>{trade.modelVersion === "V1" ? "LEGACY V1" : `PAPER ${trade.modelVersion}`} · {trade.direction} · SCORE {trade.rankingScore}</em></span>
                  <span className="paper-trade-live"><small>LIVE PRICE</small><b>{metrics ? compactPrice(metrics.livePrice) : "—"}</b><em className={performanceClass}>{metrics ? `${signed(metrics.priceMovePct)}%` : "updating"}</em></span>
                  <span className={`paper-trade-roi ${performanceClass}`}><small>NET P&amp;L · {usd(trade.accounting.marginUsd)}</small><b>{metrics ? usd(metrics.netPnlUsd, true) : "—"}</b><em>{metrics ? `${signed(metrics.roiPct)}% net` : "updating"}</em></span>
                </summary>
                <div className="paper-trade-details">
                  {metrics && <div className={`paper-position-progress ${performanceClass}`}>
                    <div><span>{metrics.progressLabel}</span><b>{metrics.progressPct.toFixed(1)}%</b></div>
                    <i><span style={{ width: `${metrics.progressPct}%` }} /></i>
                  </div>}
                  <div className="paper-levels"><span><small>ENTRY</small><b>{compactPrice(trade.entryPrice)}</b></span><span><small>SL</small><b className="negative">{compactPrice(trade.stopLoss)}</b></span><span><small>TP1</small><b className="positive">{compactPrice(trade.takeProfit)}</b></span></div>
                  <div className="paper-risk-grid">
                    <span><small>MARGIN / NOTIONAL</small><b>{usd(trade.accounting.marginUsd)} / {usd(trade.accounting.notionalUsd)}</b></span>
                    <span><small>LIVE NET ROI</small><b className={performanceClass}>{metrics ? `${signed(metrics.roiPct)}%` : "—"}</b></span>
                    <span><small>EST. ROUNDTRIP COST</small><b>{metrics ? usd(metrics.estimatedFeesUsd) : usd(trade.accounting.estimatedRoundTripFeesUsd)}</b></span>
                    <span><small>NET R:R</small><b>{trade.risk.netRiskReward === null ? "—" : `1:${trade.risk.netRiskReward.toFixed(2)}`}</b></span>
                    <span><small>RISK GATE</small><b className={trade.risk.gatePass ? "positive" : "legacy-risk"}>{trade.risk.gatePass ? "PASS" : "LEGACY"}</b></span>
                    <span><small>PLANNED RISK</small><b className={trade.risk.sizingMode === "FIXED_FRACTIONAL" ? "positive" : "legacy-risk"}>{trade.risk.sizingMode === "FIXED_FRACTIONAL" ? `${usd(trade.risk.riskBudgetUsd)} · ${trade.risk.riskPerTradePct.toFixed(0)}%` : "LEGACY"}</b></span>
                    <span><small>SL DISTANCE</small><b>{trade.risk.stopDistancePct.toFixed(2)}% · {trade.risk.stopDistanceAtr === null ? "LEGACY" : `${trade.risk.stopDistanceAtr.toFixed(2)} ATR`}</b></span>
                  </div>
                  <div className="paper-excursion-grid">
                    <span><small>MFE · FAVORABLE</small><b className="positive">+{trade.excursion.mfeR.toFixed(2)}R</b><em>{trade.excursion.mfePct.toFixed(2)}% move</em></span>
                    <span><small>MAE · ADVERSE</small><b className="negative">−{trade.excursion.maeR.toFixed(2)}R</b><em>{trade.excursion.maePct.toFixed(2)}% move</em></span>
                    <span><small>PEAK ROI · 20×</small><b className="positive">+{trade.excursion.peakRoiAt20xPct.toFixed(1)}%</b><em>paper gross</em></span>
                  </div>
                  <div className={`manual-trade-action ${manualMonitor?.decision === "EXECUTED" ? "active" : ""}`}>
                    <div className="manual-trade-copy">
                      <small>POSITION CONTROL</small>
                      <b>{manualMonitor ? `${manualMonitor.decision} · ${manualMonitor.state.replaceAll("_", " ")}` : "START MONITOR, PASS, ATAU CLOSE PAPER"}</b>
                      <span>{manualMonitor?.latestAdvice?.reason ?? "START MONITOR hanya mengaktifkan pemantauan setelah Anda entry. CLOSE PAPER menutup jurnal pada harga live server."}</span>
                      {manualMonitor?.latestAdvice && <em>{signed(manualMonitor.latestAdvice.r)}R · RSI {manualMonitor.latestAdvice.rsi.toFixed(1)} · Vol {manualMonitor.latestAdvice.relativeVolume.toFixed(2)}×</em>}
                    </div>
                    {!readOnlyViewer ? <div className="paper-position-actions">{manualMonitor?.decision === "EXECUTED" ? <button type="button" className="secondary-button" disabled={manualActionTradeId === trade.id} onClick={() => void decideManualTrade(trade, "CLOSE")}>STOP MONITOR</button> : <div className="manual-trade-controls">
                      <label><span>Actual entry</span><input inputMode="decimal" type="number" step="any" defaultValue={metrics?.livePrice ?? trade.entryPrice} onChange={(event) => setManualEntryDrafts((current) => ({ ...current, [trade.id]: event.target.value }))} /></label>
                      <button type="button" className="manual-execute-button" disabled={manualActionTradeId === trade.id} onClick={() => void decideManualTrade(trade, "EXECUTE", metrics?.livePrice)}>START MONITOR</button>
                      <button type="button" className="secondary-button" disabled={manualActionTradeId === trade.id} onClick={() => void decideManualTrade(trade, "PASS")}>PASS</button>
                    </div>}<button type="button" className="manual-close-button" disabled={paperCloseTradeId === trade.id || !metrics} onClick={() => void closePaperTrade(trade, metrics?.livePrice)}>{paperCloseTradeId === trade.id ? "CLOSING…" : "CLOSE PAPER"}</button></div> : <span className="manual-viewer-note">Owner control</span>}
                  </div>
                  <p className="paper-evidence-stamp">NEWS AT ENTRY {signed(trade.context.newsAdjustment, 0)} · {trade.evidence.schemaVersion === "paper-evidence-v1" ? "EVIDENCE V1" : "EVIDENCE LEGACY"} · {trade.evidence.eventCount} event{trade.evidence.latestHash ? ` · ${trade.evidence.latestHash.slice(0, 10)}…` : ""}</p>
                  <footer><span>Dibuka {formatWib(trade.openedAt)} · simulasi ${trade.accounting.marginUsd.toFixed(0)}, biaya tetap diestimasi; funding/slippage aktual belum dihitung</span><a href={tradingViewUrl(trade.symbol)} target="_blank" rel="noreferrer">TradingView ↗</a></footer>
                </div>
              </details>;
            }) : <div className="module-empty compact-empty">Belum ada paper trade berjalan. Mesin menunggu setup dengan ranking score minimal {PAPER_MIN_SCORE}.</div>}
          </div>
          {paperPageCount > 1 && <nav className="paper-pagination" aria-label="Halaman posisi paper aktif">
            <button type="button" aria-label="Halaman sebelumnya" disabled={safePaperPage === 0} onClick={() => changePaperPage(safePaperPage - 1)}>‹</button>
            <span><b>{safePaperPage + 1}</b><i>/</i>{paperPageCount}</span>
            <button type="button" aria-label="Halaman berikutnya" disabled={safePaperPage >= paperPageCount - 1} onClick={() => changePaperPage(safePaperPage + 1)}>›</button>
            <small>{PAPER_PAGE_SIZE} posisi / halaman</small>
          </nav>}
        </section>

        <section className="panel paper-history-panel">
          <div className="panel-heading compact"><div><p className="eyebrow">OUTCOME HISTORY</p><h2>TP / SL / Manual Records</h2></div><span className="provider-state healthy">PERSISTENT</span></div>
          <div className="paper-floating-summary five paper-outcome-summary" aria-label="Rekap seluruh hasil paper trade">
            <div className="loss"><small>TOTAL SL</small><b>{paperJournal?.summary.allLosses ?? 0}</b><span>seluruh model</span></div>
            <div className="profit"><small>TOTAL TP1 CLOSE</small><b>{paperJournal?.summary.allWins ?? 0}</b><span>baseline · seluruh model</span></div>
            <div className="manual"><small>MANUAL CLOSE</small><b>{paperJournal?.summary.allManualClosed ?? 0}</b><span>harga live server</span></div>
            <div className="review"><small>SL SEMPAT ≥0.5R</small><b>{paperJournal?.summary.slReachedHalfR ?? 0}</b><span>dari total SL</span></div>
            <div className="pending"><small>AVG MFE SEBELUM SL</small><b>{(paperJournal?.summary.slAverageMfeR ?? 0).toFixed(2)}R</b><span>{paperJournal?.summary.slReachedOneR ?? 0} sempat ≥1R</span></div>
          </div>
          <div className="paper-history-wrap">
            <div className="paper-history-head"><span>Pair</span><span>Setup</span><span>Margin</span><span>Entry</span><span>Exit</span><span>Outcome</span><span>Net P&amp;L</span><span>R</span><span>Closed WIB</span></div>
            {paperJournal?.history.length ? pagedHistory.map((trade) => (
              <div className="paper-history-row" key={trade.id}>
                <span data-label="Pair"><b>{trade.baseAsset}</b><small>{trade.direction}</small></span>
                <span data-label="Setup">{trade.setupType}<small>{trade.modelVersion} · MFE {trade.excursion.mfeR.toFixed(2)}R · MAE {trade.excursion.maeR.toFixed(2)}R</small></span>
                <span data-label="Margin">{usd(trade.accounting.marginUsd)}<small>{trade.accounting.leverage}× · {usd(trade.accounting.notionalUsd)} notional</small></span>
                <span data-label="Entry">{compactPrice(trade.entryPrice)}</span>
                <span data-label="Exit">{compactPrice(trade.exitPrice ?? 0)}</span>
                <span data-label="Outcome"><i className={`paper-status ${trade.status.toLowerCase()}`}>{trade.status === "TP" ? "TP1 FULL CLOSE" : trade.status === "MANUAL" ? "MANUAL CLOSE" : trade.status}</i></span>
                <span data-label="Net P&L" className={trade.accounting.netPnlUsd >= 0 ? "positive" : "negative"}>{usd(trade.accounting.netPnlUsd, true)}{trade.accounting.marginLossCapped && <small>MARGIN CAP</small>}</span>
                <span data-label="R" className={(trade.outcomeR ?? 0) >= 0 ? "positive" : "negative"}>{signed(trade.outcomeR ?? 0)}R</span>
                <span data-label="Closed WIB">{formatWib(trade.closedAt)}</span>
              </div>
            )) : <div className="module-empty">Riwayat TP/SL akan muncul setelah paper setup pertama selesai.</div>}
          </div>
          {historyPageCount > 1 && <nav className="paper-pagination" aria-label="Halaman riwayat paper">
            <button type="button" aria-label="Riwayat sebelumnya" disabled={safeHistoryPage === 0} onClick={() => setHistoryPage(Math.max(0, safeHistoryPage - 1))}>‹</button>
            <span><b>{safeHistoryPage + 1}</b><i>/</i>{historyPageCount}</span>
            <button type="button" aria-label="Riwayat berikutnya" disabled={safeHistoryPage >= historyPageCount - 1} onClick={() => setHistoryPage(Math.min(historyPageCount - 1, safeHistoryPage + 1))}>›</button>
            <small>{PAPER_PAGE_SIZE} transaksi / halaman · geser kanan untuk kolom lain</small>
          </nav>}
          <p className="panel-note">Baseline lama menutup 100% posisi saat TP1 tersentuh—jadi label TP di atas berarti TP1 full close, bukan TP3. Exit Management V2 shadow membandingkan hasil staged tanpa mengubah History ini.</p>
        </section>
      </section>}

      {activeMenu === "evaluation" && <section className="evaluation-workspace menu-view">
        <section className="panel collector-panel">
          <div className="panel-heading compact">
            <div><p className="eyebrow">INDEPENDENT SCANNER LANES V1</p><h2>Hard Gate · Early · Hot Volume · Monitor</h2></div>
            <div className="collector-actions">
              <span className={`provider-state ${collectorStatus?.state === "HEALTHY" ? "healthy" : collectorStatus?.state === "FAILED" || collectorStatus?.state === "STALE" ? "degraded" : "disabled"}`}>{collectorStatus?.state ?? "LOADING"}</span>
              {!readOnlyViewer && <button type="button" className="secondary-button" disabled={collectorRunning} onClick={() => void runEvidenceCollector()}>{collectorRunning ? "COLLECTING…" : "COLLECT NOW"}</button>}
            </div>
          </div>
          <div className="collector-grid">
            <div><small>CADENCE TARGET</small><b>{collectorStatus?.cadenceMinutes ?? 15}M</b><span>closed-candle window</span></div>
            <div><small>LAST RUN</small><b>{collectorStatus?.latestRun ? `${collectorStatus.latestRun.ageMinutes}m` : "—"}</b><span>{collectorStatus?.latestRun?.completedAt ? `${formatWib(collectorStatus.latestRun.completedAt)} WIB` : "belum ada cycle"}</span></div>
            <div><small>PAPER OPEN</small><b>{collectorStatus?.latestRun?.paperOpen ?? paperJournal?.summary.allOpen ?? 0}</b><span>paper-only</span></div>
            <div><small>VERIFIED RESOLVED</small><b>{evaluation?.shadow.resolved ?? 0}</b><span>closed-candle target {evaluation?.targetResolved ?? 100}</span></div>
            <div><small>EXIT ACTIVE</small><b>{collectorStatus?.latestRun?.exitActive ?? exitManagement?.summary.active ?? 0}</b><span>paired target 30</span></div>
            <div><small>TELEGRAM</small><b>{telegramStatus?.paired ? "PAIRED" : telegramStatus?.configured ? "CONNECTING" : "SETUP"}</b><span>{telegramStatus?.botUsername ? `@${telegramStatus.botUsername}` : "secure owner setup"}</span></div>
          </div>
          <div className="scanner-lane-grid">
            <div><small>PAPER ELIGIBLE</small><b>{collectorStatus?.latestRun?.lanes?.hardGate.state ?? "WAITING"}</b><span>{collectorStatus?.latestRun?.lanes?.hardGate.eligibleCandidates ?? collectorStatus?.latestRun?.lanes?.hardGate.candidates ?? 0} kandidat · {collectorStatus?.latestRun?.lanes?.hardGate.alerted ?? 0} alert · zero {collectorStatus?.latestRun?.lanes?.hardGate.starvation.consecutiveCycles ?? 0}/96 siklus</span></div>
            <div><small>EARLY · {telegramStatus?.promotionGates?.early.confidence ?? "LOW"}</small><b>{telegramStatus?.promotionGates?.early.verdict ?? "COLLECTING"}</b><span>{telegramStatus?.promotionGates?.early.resolved ?? 0}/{telegramStatus?.promotionGates?.early.targetResolved ?? 30} resolved · shadow sampai KEEP</span></div>
            <div><small>HOT VOLUME · {telegramStatus?.promotionGates?.hotVolume.confidence ?? "LOW"}</small><b>{telegramStatus?.promotionGates?.hotVolume.verdict ?? "COLLECTING"}</b><span>{telegramStatus?.promotionGates?.hotVolume.resolved ?? 0}/{telegramStatus?.promotionGates?.hotVolume.targetResolved ?? 30} execution-eligible · AUTO hanya KEEP</span></div>
            <div><small>POSITION MONITOR</small><b>{collectorStatus?.latestRun?.lanes?.positionMonitor.state ?? "WAITING"}</b><span>{collectorStatus?.latestRun?.lanes?.positionMonitor.checked ?? 0} checked · {collectorStatus?.latestRun?.lanes?.positionMonitor.alerted ?? 0} update</span></div>
          </div>
          <div className="gate-audit-strip">
            <div className="gate-audit-heading">
              <span><small>GATE BOTTLENECK AUDIT V1</small><b>{collectorStatus?.gateAudit.state ?? "COLLECTING"}</b></span>
              <i>REPORT ONLY · NO RULE CHANGE</i>
            </div>
            <div className="gate-audit-metrics">
              <div><small>STRICT SIGNALS</small><b>{collectorStatus?.gateAudit.strictSignals ?? 0}</b><span>{collectorStatus?.gateAudit.cyclesWithStrict ?? 0} cycle aktif</span></div>
              <div><small>MOMENTUM OPPORTUNITY</small><b>{collectorStatus?.gateAudit.opportunitySignals ?? 0}</b><span>{collectorStatus?.gateAudit.cyclesWithOpportunity ?? 0} cycle aktif</span></div>
              <div><small>PAPER ELIGIBLE</small><b>{collectorStatus?.gateAudit.eligibleSignals ?? 0}</b><span>{collectorStatus?.gateAudit.cyclesWithEligible ?? 0} cycle aktif</span></div>
              <div><small>CLASSIFIED WINDOW</small><b>{collectorStatus?.gateAudit.classifiedCycles ?? 0}<i>/{collectorStatus?.gateAudit.targetCycles ?? 96}</i></b><span>zero streak {collectorStatus?.gateAudit.currentZeroEligibleStreak ?? 0}</span></div>
            </div>
            <div className="gate-audit-blockers">
              <small>TOP BLOCKERS</small>
              <span>{collectorStatus?.gateAudit.topBlockers.length
                ? collectorStatus.gateAudit.topBlockers.slice(0, 5).map((item) => <i key={item.reason}>{item.reason.replaceAll("_", " ")} <b>{item.count}</b></i>)
                : <i>Menunggu cycle telemetry v1</i>}</span>
            </div>
          </div>
          <p className="panel-note">GitHub runner memicu cycle 15 menit. Setiap lane gagal-aman secara independen: Early atau Hot Volume yang bermasalah tidak menghentikan Hard Gate maupun monitor posisi.</p>
        </section>

        <section className="panel evaluation-hero">
          <div className="panel-heading">
            <div><p className="eyebrow">CONTROLLED EVALUATION LOOP V2</p><h2>Closed-Candle Evidence</h2></div>
            <span className={`evaluation-verdict ${evaluation?.verdict.toLowerCase().replaceAll(" ", "-") ?? "loading"}`}>{evaluation?.verdict ?? "LOADING"}</span>
          </div>
          <div className="evaluation-safety">
            <strong>CLOSED 15M · HIGH/LOW · STOP FIRST</strong>
            <span>{evaluation?.verdictReason ?? "Menyiapkan cohort closed-candle."} {evaluation?.methodology.legacyExcluded ?? 0} observasi sampled lama dikeluarkan dari verdict.</span>
          </div>
          <div className="evaluation-stat-grid">
            <div><small>VERIFIED OUTCOMES</small><b>{evaluation?.shadow.resolved ?? 0}<i>/{evaluation?.targetResolved ?? 100}</i></b><span>{evaluation?.shadow.open ?? 0} observasi aktif</span></div>
            <div><small>FULL GATE VERIFIED</small><b>{evaluation?.eligible.resolved ?? 0}</b><span>{evaluation?.eligible.total ?? 0} observasi</span></div>
            <div><small>EXPECTANCY</small><b className={(evaluation?.eligible.expectancyR ?? 0) >= 0 ? "positive" : "negative"}>{evaluation?.eligible.resolved ? `${signed(evaluation.eligible.expectancyR)}R` : "—"}</b><span>Adaptive eligible</span></div>
            <div><small>PROFIT FACTOR</small><b>{evaluation?.eligible.resolved ? evaluation.eligible.profitFactor === null ? "∞" : evaluation.eligible.profitFactor.toFixed(2) : "—"}</b><span>shadow resolved</span></div>
            <div><small>BASELINE V2</small><b>{evaluation?.baselinePaper.resolved ?? 0}</b><span>{evaluation?.baselinePaper.resolved ? `${signed(evaluation.baselinePaper.expectancyR)}R expectancy` : "belum cukup sampel"}</span></div>
          </div>
          <div className="evaluation-progress" aria-label="Kemajuan sampel shadow resolved">
            <span style={{ width: `${Math.min(100, ((evaluation?.shadow.resolved ?? 0) / (evaluation?.targetResolved ?? 100)) * 100)}%` }} />
          </div>
        </section>

        <section className="evaluation-grid">
          <section className="panel evaluation-table-panel">
            <div className="panel-heading compact"><div><p className="eyebrow">DIRECTION · VERIFIED COHORT</p><h2>LONG vs SHORT</h2></div><span className="provider-state healthy">CLOSED 15M</span></div>
            <div className="evaluation-table">
              <div className="evaluation-row head"><span>Direction</span><span>Observations</span><span>TP / SL</span><span>TP rate</span><span>Expired</span><span>Avg R</span></div>
              {evaluation?.byDirection.length ? evaluation.byDirection.map((item) => <div className="evaluation-row" key={item.label}><b className={item.label === "LONG" ? "positive" : "negative"}>{item.label}</b><span>{item.total}</span><span>{item.wins} / {item.losses}</span><span>{item.decisive ? `${item.winRate.toFixed(1)}%` : "—"}</span><span>{item.expired}</span><span className={item.expectancyR >= 0 ? "positive" : "negative"}>{item.resolved ? `${signed(item.expectancyR)}R` : "—"}</span></div>) : <div className="module-empty compact-empty">Cohort V2 mulai dari scan closed-candle berikutnya; data sampled lama tidak dicampur.</div>}
            </div>
          </section>

          <section className="panel evaluation-table-panel">
            <div className="panel-heading compact"><div><p className="eyebrow">REGIME · VERIFIED COHORT</p><h2>Performance by Regime</h2></div><span className="provider-state healthy">CLOSED 15M</span></div>
            <div className="evaluation-table">
              <div className="evaluation-row head"><span>Regime</span><span>Observations</span><span>TP / SL</span><span>TP rate</span><span>Expired</span><span>Avg R</span></div>
              {evaluation?.byRegime.length ? evaluation.byRegime.map((item) => <div className="evaluation-row" key={item.label}><b>{item.label}</b><span>{item.total}</span><span>{item.wins} / {item.losses}</span><span>{item.decisive ? `${item.winRate.toFixed(1)}%` : "—"}</span><span>{item.expired}</span><span className={item.expectancyR >= 0 ? "positive" : "negative"}>{item.resolved ? `${signed(item.expectancyR)}R` : "—"}</span></div>) : <div className="module-empty compact-empty">Regime V2 akan muncul dari observasi closed-candle baru.</div>}
            </div>
          </section>
        </section>

        <section className="panel evaluation-evidence-panel">
          <div className="panel-heading compact"><div><p className="eyebrow">EVIDENCE COVERAGE</p><h2>Experiment Controls</h2></div><span className="paper-mode"><i /> READ ONLY</span></div>
          <div className="evaluation-evidence-grid">
            <div><small>ADAPTIVE FULL GATE</small><b>{evaluation?.eligible.total ?? 0}</b><span>{evaluation?.eligible.open ?? 0} open · {evaluation?.eligible.resolved ?? 0} resolved</span></div>
            <div><small>BLOCKED CONTROL</small><b>{evaluation?.blocked.total ?? 0}</b><span>{evaluation?.blocked.open ?? 0} open · {evaluation?.blocked.resolved ?? 0} resolved</span></div>
            <div><small>CROSS-EXCHANGE</small><b>{evaluation?.crossExchange.filter((item) => item.status !== "NOT CHECKED").reduce((sum, item) => sum + item.count, 0) ?? 0}</b><span>{evaluation?.crossExchange.map((item) => `${item.status} ${item.count}`).join(" · ") || "belum ada evidence"}</span></div>
            <div><small>LEGACY EXCLUDED</small><b>{evaluation?.legacyExcluded.total ?? 0}</b><span>sampled-mark V1 tidak dipakai untuk verdict</span></div>
          </div>
          <p className="panel-note">TP rate hanya memakai hasil decisive TP/SL. EXPIRED ditampilkan terpisah dan tetap masuk average R. Evidence gate: minimal 100 verified outcomes dan 30 baseline V2.</p>
        </section>
      </section>}

      {activeMenu === "market" && <section className="market-workspace menu-view">
        <nav className="market-subnav" aria-label="Mode Market Radar">
          <button type="button" className={marketTab === "hot" ? "active" : ""} onClick={() => setMarketTab("hot")}><b>HOT VOLUME</b><span>CoinGlass-style · shadow</span><small>{hotVolume?.summary.hot ?? "—"}</small></button>
          <button type="button" className={marketTab === "liquidity" ? "active" : ""} onClick={() => setMarketTab("liquidity")}><b>LIQUIDITY</b><span>universe utama</span><small>{universe.length}</small></button>
        </nav>

        {marketTab === "hot" && <section className="panel hot-volume-panel">
          <div className="panel-heading compact">
            <div><p className="eyebrow">MOMENTUM BREAKOUT RADAR V2</p><h2>Volume Acceleration Desk</h2></div>
            <div className="hot-volume-actions"><span className={`provider-state ${hotVolume?.source.state === "HEALTHY" ? "healthy" : hotVolume?.source.state === "DEGRADED" ? "degraded" : "disabled"}`}>{hotVolumeLoading ? "SCANNING" : hotVolume?.source.state ?? "WAITING"}</span><button type="button" className="secondary-button" disabled={hotVolumeLoading} onClick={() => void loadHotVolume()}>{hotVolumeLoading ? "LOADING…" : "REFRESH RADAR"}</button></div>
          </div>
          <div className="hot-volume-rule"><strong>VOLUME ≥$100K · MARKET CAP $1M–$1B</strong><span>Prioritas breakout closed 1H: range/trendline 12H, OI, taker, EMA15, arah 4H, spread, dan anti-chase. BREAKOUT READY masuk Telegram; execution tetap manual.</span></div>
          <div className="hot-volume-evidence">
            <span><small>RAW RESOLVED</small><b>{hotVolume?.evaluation?.raw.resolved ?? 0}</b><em>{hotVolume?.evaluation ? `EXP ${hotVolume.evaluation.raw.expectancyR.toFixed(2)}R · PF ${hotVolume.evaluation.raw.profitFactor === null ? "∞" : hotVolume.evaluation.raw.profitFactor.toFixed(2)} · DD ${hotVolume.evaluation.raw.maxDrawdownR.toFixed(1)}R` : "semua momentum hot"}</em></span>
            <span><small>HARDENED RESOLVED</small><b>{hotVolume?.evaluation?.hardened.resolved ?? 0}</b><em>{hotVolume?.evaluation ? `EXP ${hotVolume.evaluation.hardened.expectancyR.toFixed(2)}R · PF ${hotVolume.evaluation.hardened.profitFactor === null ? "∞" : hotVolume.evaluation.hardened.profitFactor.toFixed(2)} · DD ${hotVolume.evaluation.hardened.maxDrawdownR.toFixed(1)}R` : "READY lengkap"}</em></span>
            <span><small>PAIRED GATE</small><b>{hotVolume?.evaluation ? `${hotVolume.evaluation.pairedResolved}/${hotVolume.evaluation.targetPairedResolved}` : "0/30"}</b><em>closed 15m · 24h</em></span>
            <span className={`verdict ${(hotVolume?.evaluation?.verdict ?? "INSUFFICIENT DATA").toLowerCase().replaceAll(" ", "-")}`}><small>EVIDENCE VERDICT</small><b>{hotVolume?.evaluation?.verdict ?? "COLLECTING"}</b><em>KEEP required for AUTO</em></span>
          </div>
          <div className="hot-volume-summary">
            <div><small>HOT NOW</small><b>{hotVolume?.summary.hot ?? 0}</b><span>Vol 1H ≥+20%</span></div>
            <div className="positive"><small>LONG BIAS</small><b>{hotVolume?.summary.long ?? 0}</b><span>harga 1H naik</span></div>
            <div className="negative"><small>SHORT BIAS</small><b>{hotVolume?.summary.short ?? 0}</b><span>harga 1H turun</span></div>
            <div className="positive"><small>BREAKOUT READY</small><b>{hotVolume?.summary.breakoutReady ?? 0}</b><span>{hotVolume?.summary.breakout ?? 0} breakout terdeteksi</span></div>
            <div className="warning"><small>CHASE RISK</small><b>{hotVolume?.summary.chaseRisk ?? 0}</b><span>harga sudah jauh</span></div>
          </div>
          {hotVolumeError ? <div className="module-empty"><b>Radar berhenti aman.</b><span>{hotVolumeError}</span></div> : hotVolumeLoading && !hotVolume ? <div className="module-empty"><b>Mengurutkan percepatan volume…</b><span>Closed candle dan market cap sedang diverifikasi.</span></div> : hotVolume?.candidates.length ? <>
            <div className="hot-volume-table-wrap">
              <div className="hot-volume-row head"><span>Pair</span><span>Status</span><span>Score</span><span>Price 5m / 15m / 1h</span><span>Vol 1H</span><span>Vol 1H%</span><span>OI 1H%</span><span>Taker</span><span>RSI 15m / 1h</span><span>Stochastic 5,3,3</span><span>Market Cap</span><span>Funding</span><span>Spread</span></div>
              {pagedHotVolume.map((item: HotVolumeCandidate) => <button type="button" className={`hot-volume-row ${hotVolumeSelected === item.symbol ? "selected" : ""}`} key={item.symbol} onClick={() => setHotVolumeSelected((current) => current === item.symbol ? null : item.symbol)}>
                <span data-label="Pair"><b>{item.baseAsset}</b><small>/USDT</small></span>
                <span data-label="Status"><i className={`hot-status ${item.status.toLowerCase().replaceAll("_", "-")}`}>{hotStatusLabel(item.status)}</i><small>{item.direction}</small></span>
                <span data-label="Score"><b>{item.score}</b><small>/100</small></span>
                <span data-label="Price TF"><b className={item.priceChange.h1 >= 0 ? "positive" : "negative"}>{signed(item.priceChange.m5)} / {signed(item.priceChange.m15)} / {signed(item.priceChange.h1)}%</b><small>5m / 15m / 1h</small></span>
                <span data-label="Vol 1H"><b>${compactVolume(item.volumeUsd.h1)}</b><small>24h ${compactVolume(item.volumeUsd.h24)}</small></span>
                <span data-label="Vol 1H%" className={item.volumeChange.h1 >= 20 ? "positive" : ""}><b>{signed(item.volumeChange.h1)}%</b><small>4h {signed(item.volumeChange.h4)}%</small></span>
                <span data-label="OI 1H%" className={item.oiChange.h1 >= 0 ? "positive" : "negative"}><b>{signed(item.oiChange.h1)}%</b><small>24h {signed(item.oiChange.h24)}%</small></span>
                <span data-label="Taker"><b>{item.takerBuySellRatio?.toFixed(2) ?? "—"}</b><small>buy / sell</small></span>
                <span data-label="RSI"><b>{item.rsi.m15.toFixed(1)} / {item.rsi.h1.toFixed(1)}</b><small>15m / 1h</small></span>
                <span data-label="Stoch"><b>{item.stochastic.k.toFixed(1)} / {item.stochastic.d.toFixed(1)}</b><small>{item.stochastic.signal}</small></span>
                <span data-label="Market Cap"><b>${compactVolume(item.marketCapUsd)}</b><small>{marketCapSourceLabel(hotVolume.source.marketCap)}</small></span>
                <span data-label="Funding" className={item.fundingRate >= 0 ? "positive" : "negative"}><b>{signed(item.fundingRate * 100, 4)}%</b></span>
                <span data-label="Spread"><b>{item.spreadBps.toFixed(2)}</b><small>bps</small></span>
              </button>)}
            </div>
            {hotVolumePageCount > 1 && <nav className="paper-pagination" aria-label="Halaman Hot Volume Radar"><button type="button" aria-label="Hot Volume sebelumnya" disabled={safeHotVolumePage === 0} onClick={() => setHotVolumePage(Math.max(0, safeHotVolumePage - 1))}>‹</button><span><b>{safeHotVolumePage + 1}</b><i>/</i>{hotVolumePageCount}</span><button type="button" aria-label="Hot Volume berikutnya" disabled={safeHotVolumePage >= hotVolumePageCount - 1} onClick={() => setHotVolumePage(Math.min(hotVolumePageCount - 1, safeHotVolumePage + 1))}>›</button><small>8 pair / halaman · geser kanan untuk kolom lain</small></nav>}
            {activeHotVolume && <section className="hot-volume-detail">
              <div><small>SELECTED PAIR</small><b>{activeHotVolume.symbol} · {hotStatusLabel(activeHotVolume.status)}</b><span>{activeHotVolume.reasons.join(" · ")}</span></div>
              <div className="hot-volume-detail-grid"><span><small>BREAKOUT STRUCTURE</small><b>{activeHotVolume.breakout.confirmed ? activeHotVolume.breakout.kind.replaceAll("_", " ") : "BELUM CONFIRMED"}</b><em>{activeHotVolume.breakout.level ? `level ${activeHotVolume.breakout.level} · ${activeHotVolume.breakout.distanceAtr.toFixed(2)} ATR` : "closed 1H belum melewati struktur"}</em></span><span><small>RETEST 15M</small><b>{activeHotVolume.retest.confirmed ? "HOLD + REJECTION" : "BELUM CONFIRMED"}</b><em>{activeHotVolume.retest.distanceAtr.toFixed(2)} ATR dari breakout level</em></span><span><small>REGIME 4H / 24H</small><b>{activeHotVolume.regime.aligned ? "ALIGNED" : "MIXED"}</b><em>{signed(activeHotVolume.regime.h4ChangePercent)}% / {signed(activeHotVolume.regime.h24ChangePercent)}%</em></span><span><small>EMA15 / EXTENSION</small><b>{activeHotVolume.ema15m.alignment} · {activeHotVolume.extensionAtr.toFixed(2)} ATR</b></span><a href={tradingViewUrl(activeHotVolume.symbol)} target="_blank" rel="noreferrer">OPEN TRADINGVIEW ↗</a></div>
            </section>}
          </> : hotVolume && <div className="module-empty"><b>Belum ada pair terverifikasi.</b><span>Radar hanya menampilkan USDT perpetual dengan volume dan market cap yang lolos filter.</span></div>}
          <p className="panel-note">RULE SCORE menunjukkan kelengkapan rule, bukan probabilitas menang. BREAKOUT READY baru terbentuk setelah breakout 1H, retest hold + rejection closed 15m, regime 4H/24H searah, momentum belum exhaustion, dan quality gate 5/5. Hot Volume tetap shadow kecuali evidence verdict sudah KEEP; tidak ada order exchange.</p>
        </section>}

        {marketTab === "liquidity" && <section className="panel market-panel">
          <div className="panel-heading compact"><div><p className="eyebrow">LIQUIDITY PREFILTER</p><h2>Market Radar</h2></div><div className="mini-health"><span><i className={scanState === "live" ? "ok" : ""} /> Binance relay</span><span><i className={intelligence?.news.state === "healthy" && intelligence?.macro.state === "healthy" && intelligence?.events.state === "healthy" ? "ok" : "muted"} /> Context</span><span><i className={odds?.state === "healthy" ? "ok" : "muted"} /> Odds</span><span><i className="ok" /> No order API</span></div></div>
          <div className="market-table-wrap"><table className="market-table"><thead><tr><th>Pair</th><th>Price</th><th>24H</th><th>Volume</th><th>Spread</th><th>Funding</th><th>Status</th></tr></thead><tbody>{universe.slice(0, 12).map((item) => { const candidate = candidates.find((entry) => entry.symbol === item.symbol); const gates = failed[item.symbol] ?? []; return <tr key={item.symbol}><td><b>{item.baseAsset}</b><small>/USDT</small></td><td>{compactPrice(item.price)}</td><td className={item.change24h >= 0 ? "positive" : "negative"}>{signed(item.change24h)}%</td><td>{compactVolume(item.quoteVolume24h)}</td><td>{item.spreadBps.toFixed(2)} bps</td><td className={(item.fundingRate ?? 0) >= 0 ? "positive" : "negative"}>{item.fundingRate === null ? "—" : `${signed(item.fundingRate * 100, 4)}%`}</td><td>{candidate ? <span className="ready-pill">READY</span> : gates.length ? <span className="wait-pill" title={gates.map(gateLabel).join(", ")}>WAIT · {gateLabel(gates[0])}</span> : <span className="scan-pill">SCAN</span>}</td></tr>; })}</tbody></table></div>
        </section>}
      </section>}

      <footer className="terminal-footer"><span>FORWARD EVIDENCE COLLECTOR</span><p>PAPER V3 · 2% FIXED FRACTIONAL · CLOSED-CANDLE · TELEGRAM {telegramStatus?.paired ? "PAIRED" : "SECURE SETUP"}</p><span>{lastUpdated ? `Update ${lastUpdated.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false })} WIB` : `${progress.done}/${progress.total} dianalisis`}</span></footer>
    </main>
  );
}
