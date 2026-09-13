import { loadChartSeries, loadLivePrice, type Candidate } from "@/lib/market";
import {
  calculatePaperPositionAccounting,
  PAPER_ACCOUNT_SCHEMA_VERSION,
  PAPER_DEFAULT_LEVERAGE,
  PAPER_DEFAULT_ROUND_TRIP_COST_RATE,
  PAPER_INITIAL_CAPITAL_USD,
  PAPER_MARGIN_PER_TRADE_USD,
  type PaperPositionAccounting,
} from "@/lib/paper-account";
import { calculateRiskMetrics, RISK_ENGINE_VERSION, RISK_ENGINE_LIMITS } from "@/lib/risk-engine";

const PAPER_MIN_SCORE = 70;
export const PAPER_REENTRY_COOLDOWN_HOURS = 6;
export const PAPER_STRUCTURAL_RESET_MS = 2 * 60 * 60_000;
export const PAPER_EVIDENCE_SCHEMA_VERSION = "paper-evidence-v1";
const AUDIT_GENESIS_HASH = "0".repeat(64);

export type PaperTradeStatus = "OPEN" | "TP" | "SL" | "MANUAL";

export type PaperTradeRecord = {
  id: string;
  signalKey: string;
  symbol: string;
  baseAsset: string;
  direction: "LONG" | "SHORT";
  setupType: string;
  modelVersion: string;
  status: PaperTradeStatus;
  rankingScore: number;
  technicalScore: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number;
  takeProfit3: number;
  exitPrice: number | null;
  outcomeR: number | null;
  openedAt: string;
  closedAt: string | null;
  lastCheckedAt: string;
  observedHigh: number;
  observedLow: number;
  sourceClosedAt: number;
  evidenceJson: string;
  evidence: {
    schemaVersion: string;
    eventCount: number;
    latestHash: string | null;
  };
  accounting: PaperPositionAccounting;
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
    xSnapshot: Candidate["xSnapshot"];
  };
  excursion: {
    mfePct: number;
    maePct: number;
    mfeR: number;
    maeR: number;
    peakRoiAt20xPct: number;
  };
};

export type PaperModelPerformance = {
  modelVersion: string;
  total: number;
  open: number;
  resolved: number;
  wins: number;
  losses: number;
  manualClosed: number;
  winRate: number;
  realizedNetPnlUsd: number;
  expectancyUsd: number;
  profitFactor: number | null;
  marginLossCaps: number;
};

export type PaperAccountSummary = {
  schemaVersion: typeof PAPER_ACCOUNT_SCHEMA_VERSION;
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
  byModel: PaperModelPerformance[];
};

export type PaperSystemEvaluation = {
  verdict: "UNDERPERFORMING" | "OBSERVE" | "INSUFFICIENT_DATA";
  promotionDecision: "DO NOT PROMOTE" | "KEEP COLLECTING";
  headline: string;
  reasons: string[];
};

export type PaperRuntimeSafety = {
  schemaVersion: "runtime-safety-v1";
  dataHealthState: "HEALTHY" | "DEGRADED" | "UNKNOWN";
  entryCircuit: "OPEN" | "BLOCKED";
  reasons: string[];
  cooldownHours: number;
  cooldownBlocked: Array<{ symbol: string; remainingMinutes: number; structuralResetRequired: boolean }>;
  lastSyncAt: string | null;
};

export type PaperJournal = {
  summary: {
    total: number;
    open: number;
    resolved: number;
    wins: number;
    losses: number;
    manualClosed: number;
    winRate: number;
    expectancyR: number;
    netR: number;
    legacy: number;
    legacyOpen: number;
    allTotal: number;
    allOpen: number;
    allResolved: number;
    allWins: number;
    allLosses: number;
    allManualClosed: number;
    allNetR: number;
    slReachedHalfR: number;
    slReachedOneR: number;
    slAverageMfeR: number;
  };
  openTrades: PaperTradeRecord[];
  history: PaperTradeRecord[];
  generatedAt: string;
  mode: "PAPER";
  runtimeSafety: PaperRuntimeSafety;
  account: PaperAccountSummary;
  systemEvaluation: PaperSystemEvaluation;
};

export type ActionablePaperSource = "HARD_GATE" | "EARLY" | "HOT_VOLUME";

export type ActionablePaperInput = {
  signalKey: string;
  source: ActionablePaperSource;
  symbol: string;
  baseAsset: string;
  direction: "LONG" | "SHORT";
  setupType: string;
  rankingScore: number;
  technicalScore?: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number;
  takeProfit3: number;
  atr: number;
  sourceClosedAt: number;
  openedAt?: string;
  reasons?: string[];
};

export type ActionablePaperOpenResult = {
  active: boolean;
  created: boolean;
  reason:
    | "OPENED"
    | "EXISTING_SIGNAL"
    | "DUPLICATE_SIGNAL"
    | "SYMBOL_ACTIVE"
    | "COOLDOWN"
    | "ACCOUNT_DEPLETED"
    | "PORTFOLIO_RISK_LIMIT"
    | "DIRECTION_RISK_LIMIT"
    | "RISK_GATE"
    | "SCORE_GATE"
    | "MARGIN_LIMIT"
    | "RACE_LOST";
  trade: PaperTradeRecord | null;
};

type D1Row = Record<string, unknown>;

type PaperStatement = {
  bind: (...values: unknown[]) => PaperStatement;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

type PaperDatabase = {
  prepare: (query: string) => PaperStatement;
};

declare global {
  // Node's artifact tests do not provide the Cloudflare module loader.
  var __PAPER_D1_TEST_BINDING__: PaperDatabase | undefined;
}

async function database(): Promise<PaperDatabase> {
  if (globalThis.__PAPER_D1_TEST_BINDING__) {
    return globalThis.__PAPER_D1_TEST_BINDING__;
  }
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Paper journal database is unavailable");
  return env.DB as PaperDatabase;
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsedEvidence(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parsedArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function defaultRuntimeSafety(): PaperRuntimeSafety {
  return {
    schemaVersion: "runtime-safety-v1",
    dataHealthState: "UNKNOWN",
    entryCircuit: "BLOCKED",
    reasons: ["WAITING_FOR_HEALTHY_SCAN"],
    cooldownHours: PAPER_REENTRY_COOLDOWN_HOURS,
    cooldownBlocked: [],
    lastSyncAt: null,
  };
}

function evidenceAuditTrail(evidence: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(evidence.auditTrail)
    ? evidence.auditTrail.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function auditEvent(
  sequence: number,
  event: "OPEN" | "TP" | "SL" | "MANUAL_CLOSE",
  occurredAt: string,
  payload: Record<string, unknown>,
  previousHash: string,
) {
  const canonical = JSON.stringify({ sequence, event, occurredAt, payload, previousHash });
  return {
    sequence,
    event,
    occurredAt,
    payload,
    previousHash,
    hash: await sha256Hex(canonical),
  };
}

function openAuditPayload(trade: Pick<PaperTradeRecord,
  "symbol" | "direction" | "setupType" | "modelVersion" | "rankingScore" | "technicalScore" |
  "entryPrice" | "stopLoss" | "takeProfit" | "takeProfit2" | "takeProfit3" | "sourceClosedAt" | "accounting"
>): Record<string, unknown> {
  return {
    symbol: trade.symbol,
    direction: trade.direction,
    setupType: trade.setupType,
    modelVersion: trade.modelVersion,
    rankingScore: trade.rankingScore,
    technicalScore: trade.technicalScore,
    entryPrice: trade.entryPrice,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    takeProfit2: trade.takeProfit2,
    takeProfit3: trade.takeProfit3,
    sourceClosedAt: trade.sourceClosedAt,
    accounting: {
      schemaVersion: trade.accounting.schemaVersion,
      marginUsd: trade.accounting.marginUsd,
      leverage: trade.accounting.leverage,
      roundTripCostRate: trade.accounting.roundTripCostRate,
    },
  };
}

async function ensureOpenEvidence(trade: PaperTradeRecord): Promise<Record<string, unknown>> {
  const stored = parsedEvidence(trade.evidenceJson);
  const trail = evidenceAuditTrail(stored);
  if (stored.schemaVersion === PAPER_EVIDENCE_SCHEMA_VERSION && trail.length) return stored;
  const openedAt = Number.isFinite(Date.parse(trade.openedAt)) ? trade.openedAt : new Date().toISOString();
  const opened = await auditEvent(0, "OPEN", openedAt, openAuditPayload(trade), AUDIT_GENESIS_HASH);
  return {
    ...stored,
    schemaVersion: PAPER_EVIDENCE_SCHEMA_VERSION,
    recordedAt: openedAt,
    migratedFromLegacy: Object.keys(stored).length > 0,
    auditTrail: [opened],
  };
}

async function closeEvidence(
  trade: PaperTradeRecord,
  status: "TP" | "SL" | "MANUAL",
  exitPrice: number,
  outcomeR: number,
  closedAt: string,
  observedHigh: number,
  observedLow: number,
): Promise<string> {
  const evidence = await ensureOpenEvidence(trade);
  const trail = evidenceAuditTrail(evidence);
  const previousHash = String(trail.at(-1)?.hash ?? AUDIT_GENESIS_HASH);
  const event = status === "MANUAL" ? "MANUAL_CLOSE" : status;
  const closed = await auditEvent(trail.length, event, closedAt, {
    exitPrice,
    outcomeR,
    observedHigh,
    observedLow,
  }, previousHash);
  return JSON.stringify({
    ...evidence,
    outcome: { status, exitPrice, outcomeR, closedAt, observedHigh, observedLow },
    auditTrail: [...trail, closed],
  });
}

function rowToTrade(row: D1Row): PaperTradeRecord {
  const evidence = parsedEvidence(row.evidence_json);
  const storedRisk = evidence.risk && typeof evidence.risk === "object"
    ? evidence.risk as Record<string, unknown>
    : {};
  const storedContext = evidence.context && typeof evidence.context === "object"
    ? evidence.context as Record<string, unknown>
    : {};
  const entryPrice = numeric(row.entry_price);
  const stopLoss = numeric(row.stop_loss);
  const fallbackStopDistancePct = entryPrice > 0 ? Math.abs(entryPrice - stopLoss) / entryPrice * 100 : 0;
  const rawModelVersion = String(row.model_version ?? "V1").toUpperCase();
  const modelVersion = /^[A-Z0-9._-]{1,24}$/.test(rawModelVersion) ? rawModelVersion : "V1";
  const auditTrail = evidenceAuditTrail(evidence);
  const direction = row.direction === "SHORT" ? "SHORT" : "LONG";
  const observedHigh = numeric(row.observed_high);
  const observedLow = numeric(row.observed_low);
  const riskDistance = Math.abs(entryPrice - stopLoss);
  const favorableDistance = direction === "LONG" ? Math.max(0, observedHigh - entryPrice) : Math.max(0, entryPrice - observedLow);
  const adverseDistance = direction === "LONG" ? Math.max(0, entryPrice - observedLow) : Math.max(0, observedHigh - entryPrice);
  const mfePct = entryPrice > 0 ? favorableDistance / entryPrice * 100 : 0;
  const maePct = entryPrice > 0 ? adverseDistance / entryPrice * 100 : 0;
  const accounting = calculatePaperPositionAccounting({
    direction,
    entryPrice,
    markPrice: row.status === "OPEN" ? entryPrice : numeric(row.exit_price),
    marginUsd: numeric(row.margin_usd) || PAPER_MARGIN_PER_TRADE_USD,
    leverage: numeric(row.leverage) || PAPER_DEFAULT_LEVERAGE,
    roundTripCostRate: Number.isFinite(Number(row.round_trip_cost_rate))
      ? Number(row.round_trip_cost_rate)
      : PAPER_DEFAULT_ROUND_TRIP_COST_RATE,
  });
  const storedRiskBudget = numeric(storedRisk.riskBudgetUsd) || numeric(storedRisk.estimatedLossAtStopUsd);
  const fallbackRiskBudget = accounting.notionalUsd * (fallbackStopDistancePct / 100 + accounting.roundTripCostRate);
  const riskBudgetUsd = storedRiskBudget || fallbackRiskBudget;
  const leverage = numeric(storedRisk.assumedLeverage) || accounting.leverage;
  return {
    id: String(row.id),
    signalKey: String(row.signal_key),
    symbol: String(row.symbol),
    baseAsset: String(row.base_asset),
    direction,
    setupType: String(row.setup_type),
    modelVersion,
    status: row.status === "TP" ? "TP" : row.status === "SL" ? "SL" : row.status === "MANUAL" ? "MANUAL" : "OPEN",
    rankingScore: numeric(row.ranking_score),
    technicalScore: numeric(row.technical_score),
    entryPrice,
    stopLoss,
    takeProfit: numeric(row.take_profit),
    takeProfit2: numeric(row.take_profit_2),
    takeProfit3: numeric(row.take_profit_3),
    exitPrice: row.exit_price === null || row.exit_price === undefined ? null : numeric(row.exit_price),
    outcomeR: row.outcome_r === null || row.outcome_r === undefined ? null : numeric(row.outcome_r),
    openedAt: String(row.opened_at),
    closedAt: row.closed_at ? String(row.closed_at) : null,
    lastCheckedAt: String(row.last_checked_at),
    observedHigh,
    observedLow,
    sourceClosedAt: numeric(row.source_closed_at),
    evidenceJson: String(row.evidence_json ?? "[]"),
    evidence: {
      schemaVersion: typeof evidence.schemaVersion === "string" ? evidence.schemaVersion : "legacy",
      eventCount: auditTrail.length,
      latestHash: typeof auditTrail.at(-1)?.hash === "string" ? String(auditTrail.at(-1)?.hash) : null,
    },
    accounting,
    risk: {
      version: typeof storedRisk.version === "string" ? storedRisk.version : modelVersion,
      sizingMode: storedRisk.sizingMode === "FIXED_FRACTIONAL" ? "FIXED_FRACTIONAL" : "LEGACY_FIXED_MARGIN",
      assumedLeverage: leverage,
      stopDistancePct: numeric(storedRisk.stopDistancePct) || fallbackStopDistancePct,
      stopDistanceAtr: Number.isFinite(Number(storedRisk.stopDistanceAtr)) ? Number(storedRisk.stopDistanceAtr) : null,
      estimatedRoiAtStopPct: numeric(storedRisk.estimatedRoiAtStopPct) || fallbackStopDistancePct * leverage,
      grossRiskReward: Number.isFinite(Number(storedRisk.grossRiskReward)) ? Number(storedRisk.grossRiskReward) : null,
      netRiskReward: Number.isFinite(Number(storedRisk.netRiskReward)) ? Number(storedRisk.netRiskReward) : null,
      riskPerTradePct: numeric(storedRisk.riskPerTradePct) || (accounting.netPnlUsd < 0 ? Math.abs(accounting.netPnlUsd) / PAPER_INITIAL_CAPITAL_USD * 100 : 0),
      accountEquityUsd: numeric(storedRisk.accountEquityUsd) || PAPER_INITIAL_CAPITAL_USD,
      riskBudgetUsd,
      estimatedLossAtStopUsd: numeric(storedRisk.estimatedLossAtStopUsd) || riskBudgetUsd,
      estimatedFeesUsd: numeric(storedRisk.estimatedFeesUsd) || accounting.estimatedRoundTripFeesUsd,
      notionalUsd: numeric(storedRisk.notionalUsd) || accounting.notionalUsd,
      marginUsd: numeric(storedRisk.marginUsd) || accounting.marginUsd,
      quantity: numeric(storedRisk.quantity) || (entryPrice > 0 ? accounting.notionalUsd / entryPrice : 0),
      gatePass: modelVersion === RISK_ENGINE_VERSION && storedRisk.gatePass === true,
    },
    context: {
      adjustment: numeric(storedContext.adjustment),
      newsAdjustment: numeric(storedContext.newsAdjustment),
      xAdjustment: numeric(storedContext.xAdjustment),
      xSnapshot: storedContext.xSnapshot && typeof storedContext.xSnapshot === "object"
        ? storedContext.xSnapshot as Candidate["xSnapshot"]
        : null,
    },
    excursion: {
      mfePct,
      maePct,
      mfeR: riskDistance > 0 ? favorableDistance / riskDistance : 0,
      maeR: riskDistance > 0 ? adverseDistance / riskDistance : 0,
      peakRoiAt20xPct: mfePct * accounting.leverage,
    },
  };
}

function modelPerformance(modelVersion: string, trades: PaperTradeRecord[]): PaperModelPerformance {
  // P1 audit: expectancy and profit factor measure the rule's decisive edge
  // (TP/SL only). MANUAL closes stay in realized cash flows but never in the
  // rule statistics.
  const decisive = trades.filter((trade) => trade.status === "TP" || trade.status === "SL");
  const manualClosed = trades.filter((trade) => trade.status === "MANUAL").length;
  const wins = decisive.filter((trade) => trade.status === "TP").length;
  const losses = decisive.filter((trade) => trade.status === "SL").length;
  const gains = decisive.reduce((sum, trade) => sum + Math.max(0, trade.accounting.netPnlUsd), 0);
  const lossesUsd = Math.abs(decisive.reduce((sum, trade) => sum + Math.min(0, trade.accounting.netPnlUsd), 0));
  const decisiveNet = decisive.reduce((sum, trade) => sum + trade.accounting.netPnlUsd, 0);
  const net = trades
    .filter((trade) => trade.status !== "OPEN")
    .reduce((sum, trade) => sum + trade.accounting.netPnlUsd, 0);
  return {
    modelVersion,
    total: trades.length,
    open: trades.filter((trade) => trade.status === "OPEN").length,
    resolved: decisive.length,
    wins,
    losses,
    manualClosed,
    winRate: decisive.length ? (wins / decisive.length) * 100 : 0,
    realizedNetPnlUsd: net,
    expectancyUsd: decisive.length ? decisiveNet / decisive.length : 0,
    profitFactor: lossesUsd > 0 ? gains / lossesUsd : gains > 0 ? null : 0,
    marginLossCaps: decisive.filter((trade) => trade.accounting.marginLossCapped).length,
  };
}

function buildPaperAccount(trades: PaperTradeRecord[]): PaperAccountSummary {
  const resolved = trades
    .filter((trade) => trade.status !== "OPEN")
    .sort((left, right) => Date.parse(left.closedAt ?? "") - Date.parse(right.closedAt ?? ""));
  // P1 audit: expectancy/profit factor use decisive (TP/SL) outcomes only.
  // Balance, drawdown and fees keep every realized cash flow, including MANUAL.
  const decisive = resolved.filter((trade) => trade.status === "TP" || trade.status === "SL");
  const realizedGrossPnlUsd = resolved.reduce((sum, trade) => sum + trade.accounting.grossPnlUsd, 0);
  const estimatedFeesUsd = resolved.reduce((sum, trade) => sum + trade.accounting.estimatedRoundTripFeesUsd, 0);
  const realizedNetPnlUsd = resolved.reduce((sum, trade) => sum + trade.accounting.netPnlUsd, 0);
  const decisiveNetPnlUsd = decisive.reduce((sum, trade) => sum + trade.accounting.netPnlUsd, 0);
  const balanceUsd = PAPER_INITIAL_CAPITAL_USD + realizedNetPnlUsd;
  const openMarginUsd = trades
    .filter((trade) => trade.status === "OPEN")
    .reduce((sum, trade) => sum + trade.accounting.marginUsd, 0);
  const gains = decisive.reduce((sum, trade) => sum + Math.max(0, trade.accounting.netPnlUsd), 0);
  const lossesUsd = Math.abs(decisive.reduce((sum, trade) => sum + Math.min(0, trade.accounting.netPnlUsd), 0));
  let runningBalance = PAPER_INITIAL_CAPITAL_USD;
  let peakBalance = runningBalance;
  let maxDrawdownUsd = 0;
  for (const trade of resolved) {
    runningBalance += trade.accounting.netPnlUsd;
    peakBalance = Math.max(peakBalance, runningBalance);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peakBalance - runningBalance);
  }
  const versions = [...new Set(trades.map((trade) => trade.modelVersion))].sort();
  const openPlannedRiskUsd = trades
    .filter((trade) => trade.status === "OPEN" && trade.modelVersion === RISK_ENGINE_VERSION)
    .reduce((sum, trade) => sum + trade.risk.riskBudgetUsd, 0);
  const maximumPortfolioRiskUsd = balanceUsd * (RISK_ENGINE_LIMITS.maximumPortfolioRiskPct / 100);
  return {
    schemaVersion: PAPER_ACCOUNT_SCHEMA_VERSION,
    currency: "USD",
    initialCapitalUsd: PAPER_INITIAL_CAPITAL_USD,
    defaultMarginPerTradeUsd: PAPER_MARGIN_PER_TRADE_USD,
    defaultLeverage: PAPER_DEFAULT_LEVERAGE,
    activeRiskModel: "FIXED_FRACTIONAL",
    riskPerTradePct: RISK_ENGINE_LIMITS.riskPerTradePct,
    maximumPortfolioRiskPct: RISK_ENGINE_LIMITS.maximumPortfolioRiskPct,
    maximumSameDirectionRiskPct: RISK_ENGINE_LIMITS.maximumSameDirectionRiskPct,
    openPlannedRiskUsd,
    availableRiskUsd: Math.max(0, maximumPortfolioRiskUsd - openPlannedRiskUsd),
    estimatedRoundTripCostRate: PAPER_DEFAULT_ROUND_TRIP_COST_RATE,
    realizedGrossPnlUsd,
    estimatedFeesUsd,
    realizedNetPnlUsd,
    balanceUsd,
    openMarginUsd,
    freeBalanceUsd: balanceUsd - openMarginUsd,
    realizedReturnPct: (realizedNetPnlUsd / PAPER_INITIAL_CAPITAL_USD) * 100,
    maxDrawdownUsd,
    maxDrawdownPct: (maxDrawdownUsd / PAPER_INITIAL_CAPITAL_USD) * 100,
    profitFactor: lossesUsd > 0 ? gains / lossesUsd : gains > 0 ? null : 0,
    expectancyUsd: decisive.length ? decisiveNetPnlUsd / decisive.length : 0,
    marginLossCaps: resolved.filter((trade) => trade.accounting.marginLossCapped).length,
    byModel: versions.map((version) => modelPerformance(version, trades.filter((trade) => trade.modelVersion === version))),
  };
}

function evaluatePaperSystem(trades: PaperTradeRecord[], account: PaperAccountSummary): PaperSystemEvaluation {
  // P1 audit: verdicts count decisive (TP/SL) outcomes. MANUAL closes are
  // reported separately and never inflate win rate or the promotion sample.
  const decisive = trades.filter((trade) => trade.status === "TP" || trade.status === "SL");
  const manualClosed = trades.filter((trade) => trade.status === "MANUAL").length;
  const wins = decisive.filter((trade) => trade.status === "TP").length;
  const activeResolved = decisive.filter((trade) => trade.modelVersion === RISK_ENGINE_VERSION).length;
  const directionCounts = new Map<string, number>();
  for (const trade of trades) directionCounts.set(trade.direction, (directionCounts.get(trade.direction) ?? 0) + 1);
  const verdict = decisive.length === 0
    ? "INSUFFICIENT_DATA"
    : decisive.length >= 10 && account.realizedNetPnlUsd < 0
      ? "UNDERPERFORMING"
      : "OBSERVE";
  const reasons = [
    `${decisive.length} decisive: ${wins} TP dan ${decisive.length - wins} SL (${decisive.length ? ((wins / decisive.length) * 100).toFixed(1) : "0.0"}% win rate)${manualClosed ? ` · ${manualClosed} MANUAL excluded` : ""}.`,
    `Realized net ${account.realizedNetPnlUsd >= 0 ? "+" : "−"}$${Math.abs(account.realizedNetPnlUsd).toFixed(2)} dari modal awal $${PAPER_INITIAL_CAPITAL_USD.toFixed(0)}.`,
  ];
  if (directionCounts.size === 1) {
    const [[direction, count]] = [...directionCounts.entries()];
    reasons.push(`Sampel belum seimbang: ${count}/${trades.length} posisi ${direction}, belum ada bukti arah lawan.`);
  }
  if (account.marginLossCaps > 0) reasons.push(`${account.marginLossCaps} hasil mencapai batas rugi margin $${PAPER_MARGIN_PER_TRADE_USD}; SL lama terlalu lebar untuk leverage ${PAPER_DEFAULT_LEVERAGE}×.`);
  if (activeResolved === 0) reasons.push("Risk V3 belum memiliki trade resolved, jadi belum boleh dinilai lebih baik dari baseline.");
  else if (activeResolved < 30) reasons.push(`Risk V3 baru memiliki ${activeResolved}/30 trade resolved; sampel belum cukup untuk promosi.`);
  return {
    verdict,
    promotionDecision: verdict === "UNDERPERFORMING" || activeResolved < 30 ? "DO NOT PROMOTE" : "KEEP COLLECTING",
    headline: verdict === "UNDERPERFORMING"
      ? "V1 masih negatif; pertahankan sebagai baseline dan jangan promosikan rule baru tanpa bukti."
      : verdict === "INSUFFICIENT_DATA"
        ? "Belum ada hasil selesai untuk menilai expectancy."
        : "Sampel masih perlu diperbesar sebelum keputusan rule.",
    reasons,
  };
}

function assessDataHealth(value: unknown, generatedAt: string): Pick<PaperRuntimeSafety, "dataHealthState" | "entryCircuit" | "reasons"> {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const reasons = Array.isArray(item.reasons) ? item.reasons.map(String).slice(0, 12) : [];
  const generated = Date.parse(generatedAt);
  const checked = Date.parse(String(item.checkedAt ?? ""));
  const now = Date.now();
  if (item.schemaVersion !== "data-health-v1" || item.state !== "HEALTHY") reasons.push("SCAN_HEALTH_NOT_VERIFIED");
  if (!Number.isFinite(generated) || Math.abs(now - generated) > 5 * 60_000) reasons.push("SCAN_TIMESTAMP_STALE");
  if (!Number.isFinite(checked) || Math.abs(checked - generated) > 60_000) reasons.push("HEALTH_TIMESTAMP_MISMATCH");
  return reasons.length
    ? { dataHealthState: "DEGRADED", entryCircuit: "BLOCKED", reasons: [...new Set(reasons)] }
    : { dataHealthState: "HEALTHY", entryCircuit: "OPEN", reasons: [] };
}

async function writeRuntimeSafety(state: PaperRuntimeSafety): Promise<void> {
  try {
    const db = await database();
    await db.prepare(
      `INSERT INTO paper_runtime_state (id, data_health_state, entry_circuit, reasons_json, cooldown_blocked_json, last_sync_at)
       VALUES ('singleton', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data_health_state = excluded.data_health_state, entry_circuit = excluded.entry_circuit,
       reasons_json = excluded.reasons_json, cooldown_blocked_json = excluded.cooldown_blocked_json, last_sync_at = excluded.last_sync_at`,
    ).bind(
      state.dataHealthState,
      state.entryCircuit,
      JSON.stringify(state.reasons),
      JSON.stringify(state.cooldownBlocked),
      state.lastSyncAt,
    ).run();
  } catch {
    // Runtime state is observability-only; paper monitoring remains fail-closed.
  }
}

async function readRuntimeSafety(): Promise<PaperRuntimeSafety> {
  try {
    const db = await database();
    const result = await db.prepare("SELECT * FROM paper_runtime_state WHERE id = 'singleton' LIMIT 1").all<D1Row>();
    const row = result.results?.find((item) => item.id === "singleton");
    if (!row) return defaultRuntimeSafety();
    return {
      schemaVersion: "runtime-safety-v1",
      dataHealthState: row.data_health_state === "HEALTHY" ? "HEALTHY" : row.data_health_state === "DEGRADED" ? "DEGRADED" : "UNKNOWN",
      entryCircuit: row.entry_circuit === "OPEN" ? "OPEN" : "BLOCKED",
      reasons: parsedArray(row.reasons_json).map(String),
      cooldownHours: PAPER_REENTRY_COOLDOWN_HOURS,
      cooldownBlocked: parsedArray(row.cooldown_blocked_json).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const value = item as Record<string, unknown>;
        return [{ symbol: String(value.symbol ?? ""), remainingMinutes: numeric(value.remainingMinutes), structuralResetRequired: value.structuralResetRequired === true }];
      }),
      lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null,
    };
  } catch {
    return defaultRuntimeSafety();
  }
}

function validCandidate(value: unknown): value is Candidate {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Candidate>;
  const verifiedRisk = calculateRiskMetrics({
    entryPrice: numeric(item.price),
    stopLoss: numeric(item.stopLoss),
    takeProfit: numeric(item.tp1),
    atr: numeric(item.snapshots?.primary.atr),
  });
  return (
    typeof item.symbol === "string" &&
    /^[A-Z0-9]{2,20}USDT$/.test(item.symbol) &&
    (item.direction === "LONG" || item.direction === "SHORT") &&
    typeof item.setupType === "string" &&
    // P0 audit: eligibility uses the pure technical score. rankingScore
    // (technical + bounded news context) is stored for audit but never gates entry.
    Number.isFinite(item.technicalScore) &&
    Number(item.technicalScore) >= PAPER_MIN_SCORE &&
    item.risk?.version === RISK_ENGINE_VERSION &&
    item.risk.gatePass === true &&
    Array.isArray(item.risk.gateFailures) &&
    item.risk.gateFailures.length === 0 &&
    Array.isArray(item.paperGateFailures) &&
    item.paperGateFailures.length === 0 &&
    verifiedRisk.gatePass &&
    Number.isFinite(item.price) &&
    Number.isFinite(item.stopLoss) &&
    Number.isFinite(item.tp1) &&
    Number.isFinite(item.tp2) &&
    Number.isFinite(item.tp3) &&
    Number.isFinite(item.snapshots?.primary.closedAt)
  );
}

async function readOpenTrades(): Promise<PaperTradeRecord[]> {
  const db = await database();
  const result = await db
    .prepare("SELECT * FROM paper_trades WHERE status = 'OPEN' ORDER BY opened_at ASC")
    .all<D1Row>();
  return (result.results ?? []).map(rowToTrade);
}

async function monitorOpenTrade(trade: PaperTradeRecord): Promise<PaperTradeRecord> {
  try {
    const series = await loadChartSeries(trade.symbol, "15m");
    const lastChecked = Date.parse(trade.lastCheckedAt);
    const opened = Date.parse(trade.openedAt);
    const candles = series.filter((point) => point.time > lastChecked && point.time >= opened);
    if (!candles.length) return trade;

    const long = trade.direction === "LONG";
    let status: PaperTradeStatus = "OPEN";
    let exitPrice: number | null = null;
    let closedAt: string | null = null;
    let observedHigh = trade.observedHigh;
    let observedLow = trade.observedLow;
    for (const candle of candles) {
      observedHigh = Math.max(observedHigh, candle.high);
      observedLow = Math.min(observedLow, candle.low);
      const stopHit = long ? candle.low <= trade.stopLoss : candle.high >= trade.stopLoss;
      const targetHit = long ? candle.high >= trade.takeProfit : candle.low <= trade.takeProfit;
      // Conservative outcome when both levels occur inside the same 15m candle.
      if (stopHit) {
        status = "SL";
        exitPrice = trade.stopLoss;
        closedAt = new Date(candle.time).toISOString();
        break;
      }
      if (targetHit) {
        status = "TP";
        exitPrice = trade.takeProfit;
        closedAt = new Date(candle.time).toISOString();
        break;
      }
    }

    const risk = Math.abs(trade.entryPrice - trade.stopLoss);
    const outcomeR = status === "TP"
      ? risk > 0 ? Math.abs(trade.takeProfit - trade.entryPrice) / risk : 0
      : status === "SL" ? -1 : null;
    const lastCheckedAt = new Date(candles.at(-1)!.time).toISOString();
    const evidenceJson = status === "OPEN"
      ? JSON.stringify(await ensureOpenEvidence(trade))
      : await closeEvidence(trade, status, exitPrice!, outcomeR!, closedAt!, observedHigh, observedLow);
    const db = await database();
    await db.prepare(
      `UPDATE paper_trades
       SET status = ?, exit_price = ?, outcome_r = ?, closed_at = ?, last_checked_at = ?, observed_high = ?, observed_low = ?, evidence_json = ?
       WHERE id = ? AND status = 'OPEN'`,
    ).bind(
      status,
      exitPrice,
      outcomeR,
      closedAt,
      lastCheckedAt,
      observedHigh,
      observedLow,
      evidenceJson,
      trade.id,
    ).run();
    return { ...trade, status, exitPrice, outcomeR, closedAt, lastCheckedAt, observedHigh, observedLow };
  } catch {
    return trade;
  }
}

export async function openActionablePaperTrade(input: ActionablePaperInput): Promise<ActionablePaperOpenResult> {
  const db = await database();
  const exactResult = await db.prepare("SELECT * FROM paper_trades WHERE signal_key = ? LIMIT 1").bind(input.signalKey).all<D1Row>();
  const exactRow = exactResult.results?.[0];
  if (exactRow) {
    const trade = rowToTrade(exactRow);
    return trade.status === "OPEN"
      ? { active: true, created: false, reason: "EXISTING_SIGNAL", trade }
      : { active: false, created: false, reason: "DUPLICATE_SIGNAL", trade: null };
  }

  // P0 audit: actionable/Telegram entries use the same pure-technical gate as
  // the scanner. rankingScore (technical + news context) never opens paper.
  const entryTechnicalScore = Number.isFinite(input.technicalScore)
    ? Number(input.technicalScore)
    : Number(input.rankingScore);
  if (!(entryTechnicalScore >= PAPER_MIN_SCORE)) {
    return { active: false, created: false, reason: "SCORE_GATE", trade: null };
  }

  const openResult = await db.prepare("SELECT * FROM paper_trades WHERE status = 'OPEN' ORDER BY opened_at ASC").all<D1Row>();
  const openTrades = (openResult.results ?? []).map(rowToTrade);
  if (openTrades.some((trade) => trade.symbol === input.symbol)) {
    return { active: false, created: false, reason: "SYMBOL_ACTIVE", trade: null };
  }

  const stoppedResult = await db.prepare("SELECT * FROM paper_trades WHERE symbol = ? AND status = 'SL' ORDER BY closed_at DESC LIMIT 1")
    .bind(input.symbol).all<D1Row>();
  const lastStop = stoppedResult.results?.[0] ? rowToTrade(stoppedResult.results[0]) : null;
  if (lastStop?.closedAt) {
    const cooldownUntil = Date.parse(lastStop.closedAt) + PAPER_REENTRY_COOLDOWN_HOURS * 60 * 60_000;
    const structuralResetRequired = input.sourceClosedAt < lastStop.sourceClosedAt + PAPER_STRUCTURAL_RESET_MS;
    if (Date.now() < cooldownUntil || structuralResetRequired) {
      return { active: false, created: false, reason: "COOLDOWN", trade: null };
    }
  }

  const accountResult = await db.prepare("SELECT * FROM paper_trades ORDER BY opened_at ASC").all<D1Row>();
  const account = buildPaperAccount((accountResult.results ?? []).map(rowToTrade));
  const riskBudgetUsd = Math.max(0, account.balanceUsd * (RISK_ENGINE_LIMITS.riskPerTradePct / 100));
  if (!(account.balanceUsd > 0) || !(riskBudgetUsd > 0)) {
    return { active: false, created: false, reason: "ACCOUNT_DEPLETED", trade: null };
  }
  const openV3 = openTrades.filter((trade) => trade.modelVersion === RISK_ENGINE_VERSION);
  const openRiskUsd = openV3.reduce((sum, trade) => sum + trade.risk.riskBudgetUsd, 0);
  const sameDirectionRiskUsd = openV3
    .filter((trade) => trade.direction === input.direction)
    .reduce((sum, trade) => sum + trade.risk.riskBudgetUsd, 0);
  const maximumPortfolioRiskUsd = account.balanceUsd * (RISK_ENGINE_LIMITS.maximumPortfolioRiskPct / 100);
  const maximumSameDirectionRiskUsd = account.balanceUsd * (RISK_ENGINE_LIMITS.maximumSameDirectionRiskPct / 100);
  if (openRiskUsd + riskBudgetUsd > maximumPortfolioRiskUsd + 0.01) {
    return { active: false, created: false, reason: "PORTFOLIO_RISK_LIMIT", trade: null };
  }
  if (sameDirectionRiskUsd + riskBudgetUsd > maximumSameDirectionRiskUsd + 0.01) {
    return { active: false, created: false, reason: "DIRECTION_RISK_LIMIT", trade: null };
  }

  const verifiedRisk = calculateRiskMetrics({
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    atr: input.atr,
    accountEquityUsd: account.balanceUsd,
    riskBudgetUsd,
  });
  if (!verifiedRisk.gatePass) {
    return { active: false, created: false, reason: "RISK_GATE", trade: null };
  }
  if (verifiedRisk.marginUsd > account.freeBalanceUsd) {
    return { active: false, created: false, reason: "MARGIN_LIMIT", trade: null };
  }

  const openedAt = Number.isFinite(Date.parse(input.openedAt ?? ""))
    ? new Date(input.openedAt!).toISOString()
    : new Date().toISOString();
  const id = crypto.randomUUID();
  const trade: PaperTradeRecord = {
    id,
    signalKey: input.signalKey,
    symbol: input.symbol,
    baseAsset: input.baseAsset,
    direction: input.direction,
    setupType: input.setupType,
    modelVersion: RISK_ENGINE_VERSION,
    status: "OPEN",
    rankingScore: Math.round(input.rankingScore),
    technicalScore: Math.round(input.technicalScore ?? input.rankingScore),
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    takeProfit2: input.takeProfit2,
    takeProfit3: input.takeProfit3,
    exitPrice: null,
    outcomeR: null,
    openedAt,
    closedAt: null,
    lastCheckedAt: openedAt,
    observedHigh: input.entryPrice,
    observedLow: input.entryPrice,
    sourceClosedAt: input.sourceClosedAt,
    evidenceJson: "{}",
    evidence: { schemaVersion: "legacy", eventCount: 0, latestHash: null },
    accounting: calculatePaperPositionAccounting({
      direction: input.direction,
      entryPrice: input.entryPrice,
      markPrice: input.entryPrice,
      marginUsd: verifiedRisk.marginUsd,
      leverage: verifiedRisk.assumedLeverage,
      roundTripCostRate: PAPER_DEFAULT_ROUND_TRIP_COST_RATE,
    }),
    risk: verifiedRisk,
    context: { adjustment: 0, newsAdjustment: 0, xAdjustment: 0, xSnapshot: null },
    excursion: { mfePct: 0, maePct: 0, mfeR: 0, maeR: 0, peakRoiAt20xPct: 0 },
  };
  const evidence = await ensureOpenEvidence(trade);
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO paper_trades (
      id, signal_key, symbol, base_asset, direction, setup_type, model_version, status,
      ranking_score, technical_score, entry_price, stop_loss, take_profit,
      take_profit_2, take_profit_3, margin_usd, leverage, round_trip_cost_rate, opened_at, last_checked_at,
      observed_high, observed_low, source_closed_at, evidence_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    input.signalKey,
    input.symbol,
    input.baseAsset,
    input.direction,
    input.setupType,
    RISK_ENGINE_VERSION,
    Math.round(input.rankingScore),
    Math.round(input.technicalScore ?? input.rankingScore),
    input.entryPrice,
    input.stopLoss,
    input.takeProfit,
    input.takeProfit2,
    input.takeProfit3,
    verifiedRisk.marginUsd,
    verifiedRisk.assumedLeverage,
    PAPER_DEFAULT_ROUND_TRIP_COST_RATE,
    openedAt,
    openedAt,
    input.entryPrice,
    input.entryPrice,
    input.sourceClosedAt,
    JSON.stringify({
      ...evidence,
      source: input.source,
      reasons: input.reasons ?? [],
      risk: verifiedRisk,
      context: { adjustment: 0, newsAdjustment: 0 },
    }),
  ).run() as { meta?: { changes?: number } };
  if (Number(inserted.meta?.changes ?? 0) < 1) {
    const racedResult = await db.prepare("SELECT * FROM paper_trades WHERE signal_key = ? AND status = 'OPEN' LIMIT 1")
      .bind(input.signalKey).all<D1Row>();
    const raced = racedResult.results?.[0] ? rowToTrade(racedResult.results[0]) : null;
    return raced
      ? { active: true, created: false, reason: "EXISTING_SIGNAL", trade: raced }
      : { active: false, created: false, reason: "RACE_LOST", trade: null };
  }
  return { active: true, created: true, reason: "OPENED", trade };
}

export async function syncPaperTrades(rawCandidates: unknown[], generatedAt: string, rawDataHealth?: unknown): Promise<void> {
  const candidates = rawCandidates.filter(validCandidate).slice(0, 30);
  const existing = await readOpenTrades();
  const monitored: PaperTradeRecord[] = [];
  for (const trade of existing) monitored.push(await monitorOpenTrade(trade));
  const openSymbols = new Set(monitored.filter((trade) => trade.status === "OPEN").map((trade) => trade.symbol));
  const openedAt = Number.isFinite(Date.parse(generatedAt)) ? new Date(generatedAt).toISOString() : new Date().toISOString();
  const db = await database();
  const accountRows = await db.prepare("SELECT * FROM paper_trades ORDER BY opened_at ASC").all<D1Row>();
  const accountBeforeEntries = buildPaperAccount((accountRows.results ?? []).map(rowToTrade));
  let availablePaperMarginUsd = accountBeforeEntries.freeBalanceUsd;
  const fullRiskBudgetUsd = Math.max(0, accountBeforeEntries.balanceUsd * (RISK_ENGINE_LIMITS.riskPerTradePct / 100));
  const maximumPortfolioRiskUsd = Math.max(0, accountBeforeEntries.balanceUsd * (RISK_ENGINE_LIMITS.maximumPortfolioRiskPct / 100));
  const maximumSameDirectionRiskUsd = Math.max(0, accountBeforeEntries.balanceUsd * (RISK_ENGINE_LIMITS.maximumSameDirectionRiskPct / 100));
  let openPlannedRiskUsd = monitored
    .filter((trade) => trade.status === "OPEN" && trade.modelVersion === RISK_ENGINE_VERSION)
    .reduce((sum, trade) => sum + trade.risk.riskBudgetUsd, 0);
  const directionRiskUsd = new Map<"LONG" | "SHORT", number>([
    ["LONG", monitored.filter((trade) => trade.status === "OPEN" && trade.modelVersion === RISK_ENGINE_VERSION && trade.direction === "LONG").reduce((sum, trade) => sum + trade.risk.riskBudgetUsd, 0)],
    ["SHORT", monitored.filter((trade) => trade.status === "OPEN" && trade.modelVersion === RISK_ENGINE_VERSION && trade.direction === "SHORT").reduce((sum, trade) => sum + trade.risk.riskBudgetUsd, 0)],
  ]);
  const health = assessDataHealth(rawDataHealth, generatedAt);
  const cooldownBlocked: PaperRuntimeSafety["cooldownBlocked"] = [];
  const stoppedResult = await db.prepare("SELECT * FROM paper_trades WHERE status = 'SL' ORDER BY closed_at DESC").all<D1Row>();
  const latestStops = new Map<string, PaperTradeRecord>();
  for (const row of stoppedResult.results ?? []) {
    const trade = rowToTrade(row);
    if (trade.status !== "SL") continue;
    if (!latestStops.has(trade.symbol)) latestStops.set(trade.symbol, trade);
  }

  if (health.entryCircuit === "BLOCKED") {
    await writeRuntimeSafety({ schemaVersion: "runtime-safety-v1", ...health, cooldownHours: PAPER_REENTRY_COOLDOWN_HOURS, cooldownBlocked, lastSyncAt: openedAt });
    return;
  }

  for (const candidate of candidates) {
    if (fullRiskBudgetUsd <= 0) break;
    if (openSymbols.has(candidate.symbol)) continue;
    const remainingPortfolioRiskUsd = maximumPortfolioRiskUsd - openPlannedRiskUsd;
    const remainingDirectionRiskUsd = maximumSameDirectionRiskUsd - (directionRiskUsd.get(candidate.direction) ?? 0);
    if (remainingPortfolioRiskUsd + 0.01 < fullRiskBudgetUsd || remainingDirectionRiskUsd + 0.01 < fullRiskBudgetUsd) continue;
    const sourceClosedAt = candidate.snapshots.primary.closedAt;
    const lastStop = latestStops.get(candidate.symbol);
    if (lastStop?.closedAt) {
      const cooldownUntil = Date.parse(lastStop.closedAt) + PAPER_REENTRY_COOLDOWN_HOURS * 60 * 60_000;
      const structuralResetRequired = sourceClosedAt < lastStop.sourceClosedAt + PAPER_STRUCTURAL_RESET_MS;
      if (Date.now() < cooldownUntil || structuralResetRequired) {
        cooldownBlocked.push({
          symbol: candidate.symbol,
          remainingMinutes: Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 60_000)),
          structuralResetRequired,
        });
        continue;
      }
    }
    const verifiedRisk = calculateRiskMetrics({
      entryPrice: candidate.price,
      stopLoss: candidate.stopLoss,
      takeProfit: candidate.tp1,
      atr: candidate.snapshots.primary.atr,
      accountEquityUsd: accountBeforeEntries.balanceUsd,
      riskBudgetUsd: fullRiskBudgetUsd,
    });
    if (!verifiedRisk.gatePass || verifiedRisk.marginUsd > availablePaperMarginUsd) continue;
    const signalKey = `${RISK_ENGINE_VERSION}:${candidate.symbol}:${candidate.direction}:${candidate.setupType}:${sourceClosedAt}`;
    const id = crypto.randomUUID();
    const evidenceTrade: PaperTradeRecord = {
      id,
      signalKey,
      symbol: candidate.symbol,
      baseAsset: candidate.baseAsset,
      direction: candidate.direction,
      setupType: candidate.setupType,
      modelVersion: RISK_ENGINE_VERSION,
      status: "OPEN",
      rankingScore: Math.round(candidate.rankingScore),
      technicalScore: Math.round(candidate.technicalScore),
      entryPrice: candidate.price,
      stopLoss: candidate.stopLoss,
      takeProfit: candidate.tp1,
      takeProfit2: candidate.tp2,
      takeProfit3: candidate.tp3,
      exitPrice: null,
      outcomeR: null,
      openedAt,
      closedAt: null,
      lastCheckedAt: openedAt,
      observedHigh: candidate.price,
      observedLow: candidate.price,
      sourceClosedAt,
      evidenceJson: "{}",
      evidence: { schemaVersion: "legacy", eventCount: 0, latestHash: null },
      accounting: calculatePaperPositionAccounting({
        direction: candidate.direction,
        entryPrice: candidate.price,
        markPrice: candidate.price,
        marginUsd: verifiedRisk.marginUsd,
        leverage: verifiedRisk.assumedLeverage,
        roundTripCostRate: PAPER_DEFAULT_ROUND_TRIP_COST_RATE,
      }),
      risk: verifiedRisk,
      context: {
        adjustment: candidate.contextAdjustment ?? 0,
        newsAdjustment: candidate.newsAdjustment ?? 0,
        xAdjustment: 0,
        xSnapshot: null,
      },
      excursion: { mfePct: 0, maePct: 0, mfeR: 0, maeR: 0, peakRoiAt20xPct: 0 },
    };
    const openEvidence = await ensureOpenEvidence(evidenceTrade);
    const insertResult = await db.prepare(
      `INSERT OR IGNORE INTO paper_trades (
        id, signal_key, symbol, base_asset, direction, setup_type, model_version, status,
        ranking_score, technical_score, entry_price, stop_loss, take_profit,
        take_profit_2, take_profit_3, margin_usd, leverage, round_trip_cost_rate, opened_at, last_checked_at,
        observed_high, observed_low, source_closed_at, evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      signalKey,
      candidate.symbol,
      candidate.baseAsset,
      candidate.direction,
      candidate.setupType,
      RISK_ENGINE_VERSION,
      Math.round(candidate.rankingScore),
      Math.round(candidate.technicalScore),
      candidate.price,
      candidate.stopLoss,
      candidate.tp1,
      candidate.tp2,
      candidate.tp3,
      verifiedRisk.marginUsd,
      verifiedRisk.assumedLeverage,
      PAPER_DEFAULT_ROUND_TRIP_COST_RATE,
      openedAt,
      openedAt,
      candidate.price,
      candidate.price,
      sourceClosedAt,
      JSON.stringify({
        ...openEvidence,
        reasons: candidate.reasons,
        catalysts: candidate.catalysts,
        location: candidate.location,
        risk: verifiedRisk,
        context: {
          adjustment: candidate.contextAdjustment ?? 0,
          newsAdjustment: candidate.newsAdjustment ?? 0,
        },
      }),
    ).run() as { meta?: { changes?: number } };
    if (insertResult.meta?.changes) {
      availablePaperMarginUsd -= verifiedRisk.marginUsd;
      openPlannedRiskUsd += verifiedRisk.riskBudgetUsd;
      directionRiskUsd.set(candidate.direction, (directionRiskUsd.get(candidate.direction) ?? 0) + verifiedRisk.riskBudgetUsd);
    }
    openSymbols.add(candidate.symbol);
  }
  await writeRuntimeSafety({
    schemaVersion: "runtime-safety-v1",
    ...health,
    reasons: cooldownBlocked.length ? ["SYMBOL_COOLDOWN_ACTIVE"] : health.reasons,
    cooldownHours: PAPER_REENTRY_COOLDOWN_HOURS,
    cooldownBlocked,
    lastSyncAt: openedAt,
  });
}

export async function settlePaperTrades(prices: Record<string, number>): Promise<PaperJournal> {
  // P1 audit: single settlement path. Live ticks only refresh observed
  // extremes and migrate legacy evidence — they NEVER resolve TP/SL.
  // Resolution happens exclusively on closed 15m candles via monitorOpenTrade
  // (stop-first, conservative), keeping paper outcomes comparable with the
  // shadow evaluation methodology.
  const trades = await readOpenTrades();
  const db = await database();
  const checkedAt = new Date().toISOString();

  for (const trade of trades) {
    const livePrice = numeric(prices[trade.symbol]);
    if (livePrice <= 0) continue;
    const openEvidence = await ensureOpenEvidence(trade);
    const observedHigh = Math.max(trade.observedHigh, livePrice);
    const observedLow = Math.min(trade.observedLow, livePrice);
    if (
      observedHigh === trade.observedHigh &&
      observedLow === trade.observedLow &&
      trade.evidence.schemaVersion === PAPER_EVIDENCE_SCHEMA_VERSION
    ) {
      continue;
    }
    await db.prepare(
      `UPDATE paper_trades
       SET last_checked_at = ?, observed_high = ?, observed_low = ?, evidence_json = ?
       WHERE id = ? AND status = 'OPEN'`,
    ).bind(
      checkedAt,
      observedHigh,
      observedLow,
      JSON.stringify(openEvidence),
      trade.id,
    ).run();
  }

  return getPaperJournal();
}

export async function manualClosePaperTrade(tradeId: string): Promise<PaperJournal> {
  if (!/^[a-f0-9-]{16,64}$/i.test(tradeId)) throw new Error("Paper trade ID tidak valid.");
  const db = await database();
  const result = await db.prepare("SELECT * FROM paper_trades WHERE id = ? AND status = 'OPEN' LIMIT 1").bind(tradeId).all<D1Row>();
  const row = result.results?.[0];
  if (!row) throw new Error("Posisi paper sudah tertutup atau tidak ditemukan.");
  const trade = rowToTrade(row);
  const exitPrice = await loadLivePrice(trade.symbol);
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) throw new Error("Harga live belum tersedia; posisi tidak ditutup.");
  const risk = Math.abs(trade.entryPrice - trade.stopLoss);
  const directionalMove = (exitPrice - trade.entryPrice) * (trade.direction === "LONG" ? 1 : -1);
  const outcomeR = risk > 0 ? directionalMove / risk : 0;
  const closedAt = new Date().toISOString();
  const observedHigh = Math.max(trade.observedHigh, exitPrice);
  const observedLow = Math.min(trade.observedLow, exitPrice);
  const evidenceJson = await closeEvidence(trade, "MANUAL", exitPrice, outcomeR, closedAt, observedHigh, observedLow);
  await db.prepare(
    `UPDATE paper_trades
     SET status = ?, exit_price = ?, outcome_r = ?, closed_at = ?, last_checked_at = ?, observed_high = ?, observed_low = ?, evidence_json = ?
     WHERE id = ? AND status = 'OPEN'`,
  ).bind("MANUAL", exitPrice, outcomeR, closedAt, closedAt, observedHigh, observedLow, evidenceJson, trade.id).run();
  return getPaperJournal();
}

export async function getPaperJournal(limit = 100): Promise<PaperJournal> {
  const db = await database();
  const [result, accountingResult, aggregate, runtimeSafety] = await Promise.all([
    db
    .prepare("SELECT * FROM paper_trades ORDER BY opened_at DESC LIMIT ?")
    .bind(Math.min(250, Math.max(1, Math.round(limit))))
    .all<D1Row>(),
    db
    .prepare("SELECT * FROM paper_trades ORDER BY opened_at ASC LIMIT 1000")
    .all<D1Row>(),
    db.prepare(
      `SELECT
        SUM(CASE WHEN model_version = '${RISK_ENGINE_VERSION}' THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN model_version = '${RISK_ENGINE_VERSION}' AND status = 'OPEN' THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN model_version = '${RISK_ENGINE_VERSION}' AND status IN ('TP', 'SL') THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN model_version = '${RISK_ENGINE_VERSION}' AND status = 'TP' THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN model_version = '${RISK_ENGINE_VERSION}' AND status = 'SL' THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN model_version = '${RISK_ENGINE_VERSION}' AND status = 'MANUAL' THEN 1 ELSE 0 END) AS manual_closed,
        COALESCE(SUM(CASE WHEN model_version = '${RISK_ENGINE_VERSION}' AND status IN ('TP', 'SL') THEN outcome_r ELSE 0 END), 0) AS net_r,
        COALESCE(AVG(CASE WHEN model_version = '${RISK_ENGINE_VERSION}' AND status IN ('TP', 'SL') THEN outcome_r END), 0) AS expectancy_r,
        SUM(CASE WHEN model_version != '${RISK_ENGINE_VERSION}' THEN 1 ELSE 0 END) AS legacy,
        SUM(CASE WHEN model_version != '${RISK_ENGINE_VERSION}' AND status = 'OPEN' THEN 1 ELSE 0 END) AS legacy_open,
        COUNT(*) AS all_total,
        SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS all_open,
        SUM(CASE WHEN status IN ('TP', 'SL') THEN 1 ELSE 0 END) AS all_resolved,
        SUM(CASE WHEN status = 'TP' THEN 1 ELSE 0 END) AS all_wins,
        SUM(CASE WHEN status = 'SL' THEN 1 ELSE 0 END) AS all_losses,
        SUM(CASE WHEN status = 'MANUAL' THEN 1 ELSE 0 END) AS all_manual_closed,
        COALESCE(SUM(CASE WHEN status IN ('TP', 'SL') THEN outcome_r ELSE 0 END), 0) AS all_net_r,
        SUM(CASE WHEN status = 'SL' AND ABS(entry_price - stop_loss) > 0 AND
          (CASE WHEN direction = 'LONG' THEN observed_high - entry_price ELSE entry_price - observed_low END) >= 0.5 * ABS(entry_price - stop_loss)
          THEN 1 ELSE 0 END) AS sl_reached_half_r,
        SUM(CASE WHEN status = 'SL' AND ABS(entry_price - stop_loss) > 0 AND
          (CASE WHEN direction = 'LONG' THEN observed_high - entry_price ELSE entry_price - observed_low END) >= ABS(entry_price - stop_loss)
          THEN 1 ELSE 0 END) AS sl_reached_one_r,
        COALESCE(AVG(CASE WHEN status = 'SL' AND ABS(entry_price - stop_loss) > 0 THEN
          (CASE WHEN direction = 'LONG' THEN observed_high - entry_price ELSE entry_price - observed_low END) / ABS(entry_price - stop_loss)
        END), 0) AS sl_average_mfe_r
       FROM paper_trades`,
    ).all<D1Row>(),
    readRuntimeSafety(),
  ]);
  const trades = (result.results ?? []).map(rowToTrade);
  const allTrades = (accountingResult.results ?? []).map(rowToTrade);
  const openTrades = trades.filter((trade) => trade.status === "OPEN");
  const history = trades
    .filter((trade) => trade.status !== "OPEN")
    .sort((left, right) => Date.parse(right.closedAt ?? "") - Date.parse(left.closedAt ?? ""));
  const totals = aggregate.results?.[0] ?? {};
  const resolved = numeric(totals.resolved);
  const wins = numeric(totals.wins);
  const losses = numeric(totals.losses);
  const account = buildPaperAccount(allTrades);
  return {
    summary: {
      total: numeric(totals.total),
      open: numeric(totals.open_count),
      resolved,
      wins,
      losses,
      manualClosed: numeric(totals.manual_closed),
      winRate: wins + losses ? (wins / (wins + losses)) * 100 : 0,
      expectancyR: numeric(totals.expectancy_r),
      netR: numeric(totals.net_r),
      legacy: numeric(totals.legacy),
      legacyOpen: numeric(totals.legacy_open),
      allTotal: numeric(totals.all_total),
      allOpen: numeric(totals.all_open),
      allResolved: numeric(totals.all_resolved),
      allWins: numeric(totals.all_wins),
      allLosses: numeric(totals.all_losses),
      allManualClosed: numeric(totals.all_manual_closed),
      allNetR: numeric(totals.all_net_r),
      slReachedHalfR: numeric(totals.sl_reached_half_r),
      slReachedOneR: numeric(totals.sl_reached_one_r),
      slAverageMfeR: numeric(totals.sl_average_mfe_r),
    },
    openTrades,
    history,
    generatedAt: new Date().toISOString(),
    mode: "PAPER",
    runtimeSafety,
    account,
    systemEvaluation: evaluatePaperSystem(allTrades, account),
  };
}
