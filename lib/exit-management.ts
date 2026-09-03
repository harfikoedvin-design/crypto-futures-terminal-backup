import { loadChartSeries, type ChartPoint } from "@/lib/market";
import { RISK_ENGINE_LIMITS } from "@/lib/risk-engine";

export const EXIT_MANAGEMENT_VERSION = "EXIT_V2_SHADOW" as const;
export const EXIT_PARTIAL_FRACTION = 0.25;
export const EXIT_MANAGEMENT_ACTIVATED_AT = "2026-08-27T14:51:11.427Z" as const;
export const EXIT_COMPARISON_MIN_RESOLVED = 30;

export type ExitShadowState = "OPEN" | "BE_ARMED" | "TP1_PARTIAL" | "TP2_PARTIAL" | "FULL_TP" | "PROTECTED_EXIT" | "SL" | "MANUAL_CLOSE";
export type ExitShadowCohort = "LEGACY_BACKFILL" | "FORWARD_CARRY" | "FORWARD_NATIVE" | "RUNNER_BRIDGE";

export type ExitShadowPosition = {
  id: string;
  paperTradeId: string;
  symbol: string;
  baseAsset: string;
  direction: "LONG" | "SHORT";
  sourceModelVersion: string;
  sourceStatus: "OPEN" | "TP" | "SL" | "MANUAL";
  cohort: ExitShadowCohort;
  state: ExitShadowState;
  entryPrice: number;
  originalStop: number;
  activeStop: number;
  oneRPrice: number;
  tp1: number;
  tp2: number;
  tp3: number;
  remainingFraction: number;
  realizedR: number;
  baselineOutcomeR: number | null;
  openedAt: string;
  lastCheckedAt: string;
  closedAt: string | null;
  evidenceJson: string;
  evidence: { eventCount: number; latestHash: string | null };
};

export type ExitShadowReport = {
  schemaVersion: "exit-management-v2-shadow";
  mode: "SHADOW_ONLY";
  rules: { oneRPartialPct: 25; tp1PartialPct: 25; tp2PartialPct: 25; tp3FinalPct: 25; stopAfterOneR: "NET_BE_NEXT_CANDLE" };
  comparison: {
    activatedAt: typeof EXIT_MANAGEMENT_ACTIVATED_AT;
    minimumPairedResolved: number;
    evidenceGate: "COLLECTING" | "READY_TO_REVIEW";
    forward: {
      total: number;
      active: number;
      resolved: number;
      pairedResolved: number;
      realizedToDateR: number;
      stagedNetR: number | null;
      baselineNetR: number | null;
      stagedExpectancyR: number | null;
      baselineExpectancyR: number | null;
      deltaExpectancyR: number | null;
    };
    bridge: { total: number; active: number; resolved: number; realizedToDateR: number };
    excludedLegacy: number;
  };
  summary: {
    total: number;
    active: number;
    open: number;
    beArmed: number;
    tp1Partial: number;
    tp2Partial: number;
    fullTp: number;
    protectedExit: number;
    sl: number;
    manualClose: number;
    protected: number;
    realizedR: number;
    baselineResolvedR: number;
  };
  activePositions: ExitShadowPosition[];
  resolvedPositions: ExitShadowPosition[];
  generatedAt: string;
};

type ExitStatement = {
  bind: (...values: unknown[]) => ExitStatement;
  all: <T>() => Promise<{ results?: T[] }>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};
type ExitDatabase = { prepare: (query: string) => ExitStatement };
type Row = Record<string, unknown>;

declare global {
  var __EXIT_D1_TEST_BINDING__: ExitDatabase | undefined;
  var __EXIT_SERIES_TEST_LOADER__: ((symbol: string) => Promise<ChartPoint[]>) | undefined;
}

async function database(): Promise<ExitDatabase> {
  if (globalThis.__EXIT_D1_TEST_BINDING__) return globalThis.__EXIT_D1_TEST_BINDING__;
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Exit management database is unavailable");
  return env.DB as ExitDatabase;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function riskOf(position: Pick<ExitShadowPosition, "entryPrice" | "originalStop">): number {
  return Math.abs(position.entryPrice - position.originalStop);
}

function priceR(position: Pick<ExitShadowPosition, "direction" | "entryPrice" | "originalStop">, price: number): number {
  const risk = riskOf(position);
  if (risk <= 0) return 0;
  return position.direction === "LONG" ? (price - position.entryPrice) / risk : (position.entryPrice - price) / risk;
}

function netBreakEven(direction: "LONG" | "SHORT", entry: number): number {
  const cost = RISK_ENGINE_LIMITS.estimatedRoundTripCostRate;
  return direction === "LONG" ? entry * (1 + cost) : entry * (1 - cost);
}

function stopHit(position: ExitShadowPosition, candle: Pick<ChartPoint, "high" | "low">): boolean {
  return position.direction === "LONG" ? candle.low <= position.activeStop : candle.high >= position.activeStop;
}

function targetHit(position: ExitShadowPosition, price: number, candle: Pick<ChartPoint, "high" | "low">): boolean {
  return position.direction === "LONG" ? candle.high >= price : candle.low <= price;
}

export type ExitTransition = { position: ExitShadowPosition; events: Array<{ event: string; price: number; realizedR: number; remainingFraction: number }> };

function realize(position: ExitShadowPosition, event: string, price: number, fraction: number, nextState: ExitShadowState, events: ExitTransition["events"]): ExitShadowPosition {
  const realizedR = position.realizedR + fraction * priceR(position, price);
  const remainingFraction = Math.max(0, position.remainingFraction - fraction);
  events.push({ event, price, realizedR, remainingFraction });
  return { ...position, state: nextState, realizedR, remainingFraction };
}

export function advanceExitShadow(position: ExitShadowPosition, candle: Pick<ChartPoint, "high" | "low" | "time">): ExitTransition {
  if (["FULL_TP", "PROTECTED_EXIT", "SL", "MANUAL_CLOSE"].includes(position.state)) return { position, events: [] };
  const occurredAt = new Date(candle.time).toISOString();
  const events: ExitTransition["events"] = [];
  let next = { ...position, lastCheckedAt: occurredAt };

  // Conservative: the active stop wins when stop and target coexist in one closed candle.
  if (stopHit(next, candle)) {
    const protectedState = next.state !== "OPEN";
    const finalR = next.realizedR + next.remainingFraction * priceR(next, next.activeStop);
    const state: ExitShadowState = protectedState ? "PROTECTED_EXIT" : "SL";
    events.push({ event: state, price: next.activeStop, realizedR: finalR, remainingFraction: 0 });
    return { position: { ...next, state, realizedR: finalR, remainingFraction: 0, closedAt: occurredAt }, events };
  }

  if (next.state === "OPEN" && targetHit(next, next.oneRPrice, candle)) {
    next = realize(next, "ONE_R_PARTIAL", next.oneRPrice, EXIT_PARTIAL_FRACTION, "BE_ARMED", events);
    next.activeStop = netBreakEven(next.direction, next.entryPrice);
  }
  if (next.state === "BE_ARMED" && targetHit(next, next.tp1, candle)) {
    next = realize(next, "TP1_PARTIAL", next.tp1, EXIT_PARTIAL_FRACTION, "TP1_PARTIAL", events);
  }
  if (next.state === "TP1_PARTIAL" && targetHit(next, next.tp2, candle)) {
    next = realize(next, "TP2_PARTIAL", next.tp2, EXIT_PARTIAL_FRACTION, "TP2_PARTIAL", events);
  }
  if (next.state === "TP2_PARTIAL" && targetHit(next, next.tp3, candle)) {
    next = realize(next, "FULL_TP", next.tp3, next.remainingFraction, "FULL_TP", events);
    next.closedAt = occurredAt;
  }
  return { position: next, events };
}

function parseEvidence(value: unknown): { events: Array<Record<string, unknown>> } {
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as { events?: unknown };
    return { events: Array.isArray(parsed.events) ? parsed.events.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [] };
  } catch {
    return { events: [] };
  }
}

function cohortFor(
  openedAt: string,
  closedAt: string | null,
  sourceStatus: "OPEN" | "TP" | "SL" | "MANUAL",
  events: Array<Record<string, unknown>>,
): ExitShadowCohort {
  const activation = Date.parse(EXIT_MANAGEMENT_ACTIVATED_AT);
  const opened = Date.parse(openedAt);
  if (Number.isFinite(opened) && opened >= activation) return "FORWARD_NATIVE";
  const firstEventAt = Date.parse(String(events[0]?.occurredAt ?? ""));
  if (sourceStatus === "TP" && Number.isFinite(firstEventAt) && firstEventAt < activation) return "RUNNER_BRIDGE";
  const closed = closedAt ? Date.parse(closedAt) : Number.NaN;
  if (sourceStatus === "SL" && Number.isFinite(closed) && closed < activation) return "LEGACY_BACKFILL";
  return "FORWARD_CARRY";
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function appendEvidence(position: ExitShadowPosition, transitions: ExitTransition["events"], occurredAt: string): Promise<string> {
  const evidence = parseEvidence(position.evidenceJson);
  for (const transition of transitions) {
    const previousHash = String(evidence.events.at(-1)?.hash ?? "0".repeat(64));
    const payload = { ...transition, occurredAt };
    evidence.events.push({ ...payload, previousHash, hash: await sha256(`${previousHash}|${JSON.stringify(payload)}`) });
  }
  return JSON.stringify({ schemaVersion: "exit-evidence-v2", mode: "SHADOW_ONLY", events: evidence.events });
}

function rowToPosition(row: Row): ExitShadowPosition {
  const evidenceJson = String(row.evidence_json ?? "{}");
  const evidence = parseEvidence(evidenceJson);
  const sourceStatus = row.source_status === "TP" ? "TP" : row.source_status === "SL" ? "SL" : row.source_status === "MANUAL" ? "MANUAL" : "OPEN";
  const openedAt = String(row.opened_at);
  const closedAt = row.closed_at ? String(row.closed_at) : null;
  return {
    id: String(row.id),
    paperTradeId: String(row.paper_trade_id),
    symbol: String(row.symbol),
    baseAsset: String(row.base_asset),
    direction: row.direction === "SHORT" ? "SHORT" : "LONG",
    sourceModelVersion: String(row.source_model_version),
    sourceStatus,
    cohort: cohortFor(openedAt, closedAt, sourceStatus, evidence.events),
    state: String(row.state) as ExitShadowState,
    entryPrice: number(row.entry_price),
    originalStop: number(row.original_stop),
    activeStop: number(row.active_stop),
    oneRPrice: number(row.one_r_price),
    tp1: number(row.tp1),
    tp2: number(row.tp2),
    tp3: number(row.tp3),
    remainingFraction: number(row.remaining_fraction),
    realizedR: number(row.realized_r),
    baselineOutcomeR: row.baseline_outcome_r === null || row.baseline_outcome_r === undefined ? null : number(row.baseline_outcome_r),
    openedAt,
    lastCheckedAt: String(row.last_checked_at),
    closedAt,
    evidenceJson,
    evidence: { eventCount: evidence.events.length, latestHash: evidence.events.length ? String(evidence.events.at(-1)?.hash ?? "") : null },
  };
}

function paperDirection(row: Row): "LONG" | "SHORT" {
  return row.direction === "SHORT" ? "SHORT" : "LONG";
}

async function seedPosition(row: Row): Promise<ExitShadowPosition> {
  const direction = paperDirection(row);
  const entryPrice = number(row.entry_price);
  const originalStop = number(row.stop_loss);
  const risk = Math.abs(entryPrice - originalStop);
  const oneRPrice = direction === "LONG" ? entryPrice + risk : entryPrice - risk;
  const sourceStatus = row.status === "TP" ? "TP" : row.status === "SL" ? "SL" : row.status === "MANUAL" ? "MANUAL" : "OPEN";
  const openedAt = String(row.opened_at);
  const sourceClosedAt = row.closed_at ? String(row.closed_at) : null;
  const base: ExitShadowPosition = {
    id: crypto.randomUUID(), paperTradeId: String(row.id), symbol: String(row.symbol), baseAsset: String(row.base_asset), direction,
    sourceModelVersion: String(row.model_version), sourceStatus, cohort: "FORWARD_CARRY", state: "OPEN", entryPrice, originalStop, activeStop: originalStop,
    oneRPrice, tp1: number(row.take_profit), tp2: number(row.take_profit_2), tp3: number(row.take_profit_3), remainingFraction: 1,
    realizedR: 0, baselineOutcomeR: row.outcome_r === null || row.outcome_r === undefined ? null : number(row.outcome_r),
    openedAt, lastCheckedAt: sourceStatus === "TP" && sourceClosedAt ? sourceClosedAt : String(row.last_checked_at ?? openedAt), closedAt: null,
    evidenceJson: "{}", evidence: { eventCount: 0, latestHash: null },
  };
  let seeded = base;
  const events: ExitTransition["events"] = [];
  const occurredAt = sourceClosedAt ?? base.lastCheckedAt;
  if (sourceStatus === "MANUAL") {
    seeded = { ...base, state: "MANUAL_CLOSE", remainingFraction: 0, realizedR: number(row.outcome_r), closedAt: occurredAt };
    events.push({ event: "MANUAL_CLOSE", price: number(row.exit_price), realizedR: seeded.realizedR, remainingFraction: 0 });
  } else if (sourceStatus === "SL") {
    // Historical SL lacks candle-by-candle order, so backfill stays conservative.
    seeded = { ...base, state: "SL", remainingFraction: 0, realizedR: -1, closedAt: occurredAt };
    events.push({ event: "SL", price: originalStop, realizedR: -1, remainingFraction: 0 });
  } else {
    // A baseline TP proves TP1 was touched. Open legacy trades are not backfilled
    // from aggregate MFE because it cannot prove candle-by-candle event order.
    if (sourceStatus === "TP") {
      seeded = realize(seeded, "ONE_R_PARTIAL", oneRPrice, EXIT_PARTIAL_FRACTION, "BE_ARMED", events);
      seeded.activeStop = netBreakEven(direction, entryPrice);
    }
    if (sourceStatus === "TP") seeded = realize(seeded, "TP1_PARTIAL", base.tp1, EXIT_PARTIAL_FRACTION, "TP1_PARTIAL", events);
  }
  seeded.evidenceJson = await appendEvidence(base, events, occurredAt);
  return seeded;
}

async function insertSeed(position: ExitShadowPosition): Promise<void> {
  await (await database()).prepare(
    `INSERT OR IGNORE INTO exit_shadow_positions (
      id, paper_trade_id, symbol, base_asset, direction, source_model_version, source_status, state,
      entry_price, original_stop, active_stop, one_r_price, tp1, tp2, tp3, remaining_fraction,
      realized_r, baseline_outcome_r, opened_at, last_checked_at, closed_at, evidence_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    position.id, position.paperTradeId, position.symbol, position.baseAsset, position.direction, position.sourceModelVersion,
    position.sourceStatus, position.state, position.entryPrice, position.originalStop, position.activeStop, position.oneRPrice,
    position.tp1, position.tp2, position.tp3, position.remainingFraction, position.realizedR, position.baselineOutcomeR,
    position.openedAt, position.lastCheckedAt, position.closedAt, position.evidenceJson,
  ).run();
}

async function savePosition(position: ExitShadowPosition, sourceStatus?: "OPEN" | "TP" | "SL"): Promise<void> {
  await (await database()).prepare(
    `UPDATE exit_shadow_positions
     SET source_status = ?, state = ?, active_stop = ?, remaining_fraction = ?, realized_r = ?, baseline_outcome_r = ?,
         last_checked_at = ?, closed_at = ?, evidence_json = ?
     WHERE id = ?`,
  ).bind(
    sourceStatus ?? position.sourceStatus, position.state, position.activeStop, position.remainingFraction, position.realizedR,
    position.baselineOutcomeR, position.lastCheckedAt, position.closedAt, position.evidenceJson, position.id,
  ).run();
}

async function monitorPosition(position: ExitShadowPosition): Promise<ExitShadowPosition> {
  if (["FULL_TP", "PROTECTED_EXIT", "SL"].includes(position.state)) return position;
  try {
    const series = globalThis.__EXIT_SERIES_TEST_LOADER__ ? await globalThis.__EXIT_SERIES_TEST_LOADER__(position.symbol) : await loadChartSeries(position.symbol, "15m");
    const lastChecked = Date.parse(position.lastCheckedAt);
    const candles = series.filter((candle) => candle.time > lastChecked);
    let next = position;
    for (const candle of candles) {
      const transition = advanceExitShadow(next, candle);
      if (transition.events.length) transition.position.evidenceJson = await appendEvidence(next, transition.events, new Date(candle.time).toISOString());
      next = transition.position;
      if (["FULL_TP", "PROTECTED_EXIT", "SL"].includes(next.state)) break;
    }
    if (candles.length) await savePosition(next);
    return next;
  } catch {
    return position;
  }
}

export async function syncExitManagement(): Promise<ExitShadowReport> {
  const store = await database();
  const [paperResult, existingResult] = await Promise.all([
    store.prepare("SELECT * FROM paper_trades ORDER BY opened_at ASC").all<Row>(),
    store.prepare("SELECT paper_trade_id FROM exit_shadow_positions").all<{ paper_trade_id: string }>(),
  ]);
  const existing = new Set((existingResult.results ?? []).map((row) => String(row.paper_trade_id)));
  for (const paper of paperResult.results ?? []) {
    if (!existing.has(String(paper.id))) await insertSeed(await seedPosition(paper));
  }

  const sourceById = new Map((paperResult.results ?? []).map((row) => [String(row.id), row]));
  const activeResult = await store.prepare(
    `SELECT * FROM exit_shadow_positions
     WHERE state NOT IN ('FULL_TP', 'PROTECTED_EXIT', 'SL', 'MANUAL_CLOSE')
     ORDER BY CASE state WHEN 'TP2_PARTIAL' THEN 0 WHEN 'TP1_PARTIAL' THEN 1 WHEN 'BE_ARMED' THEN 2 ELSE 3 END,
              last_checked_at ASC
     LIMIT 8`,
  ).all<Row>();
  await Promise.all((activeResult.results ?? []).map(async (row) => {
    let position = rowToPosition(row);
    const source = sourceById.get(position.paperTradeId);
    if (source) {
      const sourceStatus: "OPEN" | "TP" | "SL" | "MANUAL" = source.status === "TP" ? "TP" : source.status === "SL" ? "SL" : source.status === "MANUAL" ? "MANUAL" : "OPEN";
      position = { ...position, sourceStatus, baselineOutcomeR: source.outcome_r === null || source.outcome_r === undefined ? null : number(source.outcome_r) };
      if (sourceStatus === "MANUAL") {
        const exitPrice = number(source.exit_price);
        const occurredAt = String(source.closed_at ?? new Date().toISOString());
        const realizedR = position.realizedR + position.remainingFraction * priceR(position, exitPrice);
        const event = { event: "MANUAL_CLOSE", price: exitPrice, realizedR, remainingFraction: 0 };
        const closed = { ...position, state: "MANUAL_CLOSE" as const, remainingFraction: 0, realizedR, closedAt: occurredAt, lastCheckedAt: occurredAt };
        closed.evidenceJson = await appendEvidence(position, [event], occurredAt);
        await savePosition(closed);
        return;
      }
    }
    await monitorPosition(position);
  }));
  return getExitManagementReport();
}

export async function getExitManagementReport(): Promise<ExitShadowReport> {
  const result = await (await database()).prepare("SELECT * FROM exit_shadow_positions ORDER BY opened_at DESC LIMIT 250").all<Row>();
  const positions = (result.results ?? []).map(rowToPosition);
  const terminal = new Set<ExitShadowState>(["FULL_TP", "PROTECTED_EXIT", "SL", "MANUAL_CLOSE"]);
  const count = (state: ExitShadowState) => positions.filter((position) => position.state === state).length;
  const forward = positions.filter((position) => position.cohort === "FORWARD_CARRY" || position.cohort === "FORWARD_NATIVE");
  const bridge = positions.filter((position) => position.cohort === "RUNNER_BRIDGE");
  const paired = forward.filter((position) => terminal.has(position.state) && position.baselineOutcomeR !== null);
  const stagedNetR = paired.length ? paired.reduce((sum, position) => sum + position.realizedR, 0) : null;
  const baselineNetR = paired.length ? paired.reduce((sum, position) => sum + (position.baselineOutcomeR ?? 0), 0) : null;
  const stagedExpectancyR = stagedNetR === null ? null : stagedNetR / paired.length;
  const baselineExpectancyR = baselineNetR === null ? null : baselineNetR / paired.length;
  return {
    schemaVersion: "exit-management-v2-shadow",
    mode: "SHADOW_ONLY",
    rules: { oneRPartialPct: 25, tp1PartialPct: 25, tp2PartialPct: 25, tp3FinalPct: 25, stopAfterOneR: "NET_BE_NEXT_CANDLE" },
    comparison: {
      activatedAt: EXIT_MANAGEMENT_ACTIVATED_AT,
      minimumPairedResolved: EXIT_COMPARISON_MIN_RESOLVED,
      evidenceGate: paired.length >= EXIT_COMPARISON_MIN_RESOLVED ? "READY_TO_REVIEW" : "COLLECTING",
      forward: {
        total: forward.length,
        active: forward.filter((position) => !terminal.has(position.state)).length,
        resolved: forward.filter((position) => terminal.has(position.state)).length,
        pairedResolved: paired.length,
        realizedToDateR: forward.reduce((sum, position) => sum + position.realizedR, 0),
        stagedNetR,
        baselineNetR,
        stagedExpectancyR,
        baselineExpectancyR,
        deltaExpectancyR: stagedExpectancyR === null || baselineExpectancyR === null ? null : stagedExpectancyR - baselineExpectancyR,
      },
      bridge: {
        total: bridge.length,
        active: bridge.filter((position) => !terminal.has(position.state)).length,
        resolved: bridge.filter((position) => terminal.has(position.state)).length,
        realizedToDateR: bridge.reduce((sum, position) => sum + position.realizedR, 0),
      },
      excludedLegacy: positions.filter((position) => position.cohort === "LEGACY_BACKFILL").length,
    },
    summary: {
      total: positions.length,
      active: positions.filter((position) => !terminal.has(position.state)).length,
      open: count("OPEN"), beArmed: count("BE_ARMED"), tp1Partial: count("TP1_PARTIAL"), tp2Partial: count("TP2_PARTIAL"),
      fullTp: count("FULL_TP"), protectedExit: count("PROTECTED_EXIT"), sl: count("SL"), manualClose: count("MANUAL_CLOSE"),
      protected: positions.filter((position) => ["BE_ARMED", "TP1_PARTIAL", "TP2_PARTIAL", "FULL_TP", "PROTECTED_EXIT"].includes(position.state)).length,
      realizedR: positions.reduce((sum, position) => sum + position.realizedR, 0),
      baselineResolvedR: positions.reduce((sum, position) => sum + (position.baselineOutcomeR ?? 0), 0),
    },
    activePositions: positions.filter((position) => !terminal.has(position.state)),
    resolvedPositions: positions.filter((position) => terminal.has(position.state)),
    generatedAt: new Date().toISOString(),
  };
}
