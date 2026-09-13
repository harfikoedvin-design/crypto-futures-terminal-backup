import { loadIntelligence } from "@/lib/context";
import { assessScanDataHealth, degradeScanDataHealth } from "@/lib/data-health";
import { syncShadowEvaluation } from "@/lib/evaluation";
import { syncHaxkaiShadow } from "@/lib/haxkai-shadow";
import { syncExitManagement } from "@/lib/exit-management";
import { loadHotVolumeReport } from "@/lib/hot-volume";
import { syncHotVolumeEvaluation } from "@/lib/hot-volume-evaluation";
import { scanMarket, type Candidate } from "@/lib/market";
import { getPaperJournal, syncPaperTrades } from "@/lib/paper-trading";
import {
  offerTelegramEarlyWatches,
  offerTelegramHotVolumeWatches,
  offerTelegramSetups,
  runTelegramMonitor,
  type TelegramEarlyWatch,
} from "@/lib/telegram-monitor";

export const BACKGROUND_SCANNER_VERSION = "background-scanner-v2-independent-lanes" as const;
export const BACKGROUND_STATUS_VERSION = "forward-evidence-collector-v1" as const;
export const GATE_AUDIT_VERSION = "gate-bottleneck-audit-v1" as const;
const PAPER_MIN_SCORE = 70;

type BackgroundStatement = {
  bind: (...values: unknown[]) => BackgroundStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<{ meta?: { changes?: number } } | unknown>;
};
type BackgroundDatabase = { prepare: (query: string) => BackgroundStatement };

declare global {
  var __BACKGROUND_D1_TEST_BINDING__: BackgroundDatabase | undefined;
  var __BACKGROUND_ENV_TEST_BINDING__: Record<string, string | undefined> | undefined;
}

export type BackgroundScanReport = {
  schemaVersion: typeof BACKGROUND_SCANNER_VERSION;
  mode: "PAPER_SHADOW_READ_ONLY";
  state: "COMPLETED" | "PARTIAL" | "SKIPPED_DUPLICATE";
  cycleKey: string;
  generatedAt: string;
  dataHealth: "HEALTHY" | "DEGRADED";
  candidates: number;
  paper: { total: number; open: number; resolved: number };
  shadow: { total: number; open: number; resolved: number; verdict: string };
  hotVolume: { state: "HEALTHY" | "DEGRADED" | "NOT_RUN"; returned: number; ready: number; breakout: number; breakoutReady: number; pairedResolved: number; verdict: string };
  exitActive: number;
  telegram: { offerState: string; offered: number; monitorState: string; checked: number; alerted: number };
  lanes: {
    hardGate: {
      state: string;
      candidates: number;
      strictCandidates: number;
      opportunityCandidates: number;
      eligibleCandidates: number;
      alerted: number;
      rejections: Array<{ reason: string; count: number }>;
      starvation: { consecutiveCycles: number; threshold: 96; active: boolean };
    };
    early: { state: string; candidates: number; alerted: number };
    hotVolume: { state: string; candidates: number; alerted: number };
    positionMonitor: { state: string; polled: number; handled: number; failed: number; checked: number; alerted: number };
  };
  warnings: string[];
  evidenceHash: string;
};

type BackgroundRunRow = {
  cycle_key: string;
  state: "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
  started_at: string;
  completed_at: string | null;
  summary_json: string;
};

export type BackgroundScanStatus = {
  schemaVersion: typeof BACKGROUND_STATUS_VERSION;
  mode: "PAPER_SHADOW_READ_ONLY";
  state: "OFF" | "WAITING" | "HEALTHY" | "PARTIAL" | "STALE" | "FAILED";
  configured: boolean;
  cadenceMinutes: 15;
  telegramEnabled: false;
  gateAudit: GateAuditReport;
  latestRun: {
    cycleKey: string;
    state: BackgroundRunRow["state"];
    startedAt: string;
    completedAt: string | null;
    ageMinutes: number;
    candidates: number;
    paperOpen: number;
    shadowResolved: number;
    exitActive: number;
    lanes: BackgroundScanReport["lanes"] | null;
    warnings: string[];
  } | null;
};

export type GateAuditReport = {
  schemaVersion: typeof GATE_AUDIT_VERSION;
  mode: "REPORT_ONLY_NO_RULE_CHANGE";
  state: "COLLECTING" | "STARVED" | "LOW_FLOW" | "FLOWING";
  targetCycles: 96;
  windowCycles: number;
  classifiedCycles: number;
  periodStart: string | null;
  periodEnd: string | null;
  strictSignals: number;
  opportunitySignals: number;
  eligibleSignals: number;
  cyclesWithStrict: number;
  cyclesWithOpportunity: number;
  cyclesWithEligible: number;
  currentZeroEligibleStreak: number;
  topBlockers: Array<{ reason: string; category: "MOMENTUM" | "STRUCTURE" | "MARKET_QUALITY" | "RISK" | "DATA" | "OTHER"; count: number }>;
  categoryCounts: Array<{ category: "MOMENTUM" | "STRUCTURE" | "MARKET_QUALITY" | "RISK" | "DATA" | "OTHER"; count: number }>;
};

type GateAuditRow = { started_at: string; summary_json: string };

function blockerCategory(reason: string): GateAuditReport["topBlockers"][number]["category"] {
  if (new Set(["SCORE_BELOW_75", "ADX_BELOW_20", "RELATIVE_VOLUME_BELOW_0_9", "OI_NOT_CONFIRMING"]).has(reason)) return "MOMENTUM";
  if (new Set(["15M_NOT_ALIGNED", "LOCATION_NOT_ACTIONABLE", "TRENDLINE_BROKEN", "PRICE_OVEREXTENDED"]).has(reason)) return "STRUCTURE";
  if (new Set(["LIQUIDITY_TOO_LOW", "SPREAD_ABOVE_6_BPS", "FUNDING_EXTREME"]).has(reason)) return "MARKET_QUALITY";
  if (/RISK|REWARD|STOP|LEVERAGE|MARGIN|PORTFOLIO/.test(reason)) return "RISK";
  if (/PROVIDER|UNAVAILABLE|STALE|DATA/.test(reason)) return "DATA";
  return "OTHER";
}

export function buildGateAudit(rows: GateAuditRow[]): GateAuditReport {
  const ordered = rows.slice(0, 96);
  let classifiedCycles = 0;
  let strictSignals = 0;
  let opportunitySignals = 0;
  let eligibleSignals = 0;
  let cyclesWithStrict = 0;
  let cyclesWithOpportunity = 0;
  let cyclesWithEligible = 0;
  let currentZeroEligibleStreak = 0;
  let streakOpen = true;
  const blockers = new Map<string, number>();

  for (const row of ordered) {
    try {
      const summary = JSON.parse(row.summary_json) as Partial<BackgroundScanReport>;
      const lane = summary.lanes?.hardGate;
      if (!lane) continue;
      const eligible = Number(lane.eligibleCandidates ?? lane.candidates ?? summary.candidates ?? 0);
      const hasClassifiedTelemetry = Number.isFinite(lane.strictCandidates) && Number.isFinite(lane.opportunityCandidates);
      const strict = hasClassifiedTelemetry ? Number(lane.strictCandidates) : 0;
      const opportunity = hasClassifiedTelemetry ? Number(lane.opportunityCandidates) : eligible;
      if (hasClassifiedTelemetry) classifiedCycles += 1;
      strictSignals += strict;
      opportunitySignals += opportunity;
      eligibleSignals += eligible;
      if (strict > 0) cyclesWithStrict += 1;
      if (opportunity > 0) cyclesWithOpportunity += 1;
      if (eligible > 0) cyclesWithEligible += 1;
      if (streakOpen && eligible === 0) currentZeroEligibleStreak += 1;
      else streakOpen = false;
      for (const item of lane.rejections ?? []) {
        if (!item?.reason || !Number.isFinite(item.count)) continue;
        blockers.set(item.reason, (blockers.get(item.reason) ?? 0) + Math.max(0, item.count));
      }
    } catch {
      // A malformed historical summary is excluded without hiding newer evidence.
    }
  }

  const topBlockers = [...blockers.entries()]
    .map(([reason, count]) => ({ reason, category: blockerCategory(reason), count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
    .slice(0, 8);
  const categoryMap = new Map<GateAuditReport["topBlockers"][number]["category"], number>();
  for (const [reason, count] of blockers) {
    const category = blockerCategory(reason);
    categoryMap.set(category, (categoryMap.get(category) ?? 0) + count);
  }
  const categoryCounts = [...categoryMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
  const state = classifiedCycles === 0
    ? "COLLECTING"
    : currentZeroEligibleStreak >= 96
      ? "STARVED"
      : cyclesWithEligible / Math.max(1, classifiedCycles) >= 0.25
        ? "FLOWING"
        : "LOW_FLOW";
  return {
    schemaVersion: GATE_AUDIT_VERSION,
    mode: "REPORT_ONLY_NO_RULE_CHANGE",
    state,
    targetCycles: 96,
    windowCycles: ordered.length,
    classifiedCycles,
    periodStart: ordered.at(-1)?.started_at ?? null,
    periodEnd: ordered[0]?.started_at ?? null,
    strictSignals,
    opportunitySignals,
    eligibleSignals,
    cyclesWithStrict,
    cyclesWithOpportunity,
    cyclesWithEligible,
    currentZeroEligibleStreak,
    topBlockers,
    categoryCounts,
  };
}

async function database(): Promise<BackgroundDatabase> {
  if (globalThis.__BACKGROUND_D1_TEST_BINDING__) return globalThis.__BACKGROUND_D1_TEST_BINDING__;
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Background scanner database is unavailable");
  return env.DB as BackgroundDatabase;
}

async function runtimeEnv(): Promise<Record<string, string | undefined>> {
  if (globalThis.__BACKGROUND_ENV_TEST_BINDING__) return globalThis.__BACKGROUND_ENV_TEST_BINDING__;
  try {
    const { env } = await import("cloudflare:workers");
    return env as unknown as Record<string, string | undefined>;
  } catch {
    return process.env;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cycleKey(now = Date.now()): string {
  const closedWindow = Math.floor(now / (15 * 60_000)) * 15 * 60_000;
  return `${BACKGROUND_SCANNER_VERSION}:${closedWindow}`;
}

function paperCandidates(results: Awaited<ReturnType<typeof scanMarket>>["results"]): Candidate[] {
  const weightedMomentumGates = new Set([
    "SCORE_BELOW_75",
    "ADX_BELOW_20",
    "RELATIVE_VOLUME_BELOW_0_9",
    "OI_NOT_CONFIRMING",
  ]);
  return results
    .flatMap((item) => {
      const candidate = item.candidate ?? item.watchCandidate;
      if (!candidate) return [];
      return [{
        ...candidate,
        paperGateFailures: item.diagnostic.failedGates.filter((gate) => !weightedMomentumGates.has(gate)),
      }];
    })
    // P0 audit: eligibility uses the pure technical score. rankingScore
    // (technical + bounded news context) only affects display/sort order.
    .filter((item) => item.technicalScore >= PAPER_MIN_SCORE && item.paperGateFailures?.length === 0 && item.risk.gatePass)
    .sort((left, right) => right.rankingScore - left.rankingScore)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.symbol === item.symbol) === index);
}

function rejectionSummary(results: Awaited<ReturnType<typeof scanMarket>>["results"]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of results) {
    const riskFailures = (item.candidate ?? item.watchCandidate)?.risk.gateFailures ?? [];
    const reasons = [...item.diagnostic.failedGates, ...riskFailures];
    for (const reason of new Set(reasons)) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
    .slice(0, 8);
}

async function starvationState(currentCycleKey: string, currentCandidates: number): Promise<{ consecutiveCycles: number; threshold: 96; active: boolean }> {
  let consecutiveCycles = currentCandidates === 0 ? 1 : 0;
  if (currentCandidates > 0) return { consecutiveCycles, threshold: 96, active: false };
  try {
    const rows = await (await database()).prepare(
      "SELECT summary_json FROM background_scan_runs WHERE cycle_key != ? AND state IN ('COMPLETED', 'PARTIAL') ORDER BY started_at DESC LIMIT 95",
    ).bind(currentCycleKey).all<{ summary_json: string }>();
    for (const row of rows.results ?? []) {
      try {
        const summary = JSON.parse(row.summary_json) as Partial<BackgroundScanReport>;
        if (Number(summary.lanes?.hardGate?.candidates ?? summary.candidates ?? 0) > 0) break;
        consecutiveCycles += 1;
      } catch {
        break;
      }
    }
  } catch {
    // Telemetry must never block the trading lanes.
  }
  return { consecutiveCycles, threshold: 96, active: consecutiveCycles >= 96 };
}

function earlyWatches(results: Awaited<ReturnType<typeof scanMarket>>["results"]): TelegramEarlyWatch[] {
  return results.flatMap((item) => item.earlySignal && item.diagnostic.snapshots?.primary.closedAt
    ? [{ signal: item.earlySignal, sourceClosedAt: item.diagnostic.snapshots.primary.closedAt }]
    : []);
}

async function runPositionLane() {
  const monitor = await runTelegramMonitor().catch(() => ({ state: "FAILED" as const, checked: 0, alerted: 0 }));
  return {
    state: monitor.state === "FAILED" ? "DEGRADED" : monitor.state,
    polled: 0,
    handled: 0,
    failed: 0,
    checked: monitor.checked,
    alerted: monitor.alerted,
  };
}

async function runHotVolumeLane() {
  const report = await loadHotVolumeReport();
  const evaluation = await syncHotVolumeEvaluation(report);
  return { report, evaluation };
}

async function reserveCycle(key: string, startedAt: string): Promise<boolean> {
  const store = await database();
  const existing = await store.prepare("SELECT cycle_key FROM background_scan_runs WHERE cycle_key = ?").bind(key).first<{ cycle_key: string }>();
  if (existing) return false;
  const evidenceHash = await sha256(`${key}|${startedAt}|RUNNING`);
  await store.prepare(
    "INSERT OR IGNORE INTO background_scan_runs (id, cycle_key, version, mode, state, started_at, evidence_hash, summary_json) VALUES (?, ?, ?, 'PAPER_SHADOW_READ_ONLY', 'RUNNING', ?, ?, '{}')",
  ).bind(crypto.randomUUID(), key, BACKGROUND_SCANNER_VERSION, startedAt, evidenceHash).run();
  return true;
}

async function completeCycle(report: BackgroundScanReport): Promise<void> {
  await (await database()).prepare(
    "UPDATE background_scan_runs SET state = ?, completed_at = ?, evidence_hash = ?, summary_json = ? WHERE cycle_key = ?",
  ).bind(report.state, report.generatedAt, report.evidenceHash, JSON.stringify(report), report.cycleKey).run();
}

export async function verifyBackgroundToken(value: string | null): Promise<boolean> {
  const env = await runtimeEnv();
  return Boolean(env.BACKGROUND_SCANNER_TOKEN && value === `Bearer ${env.BACKGROUND_SCANNER_TOKEN}`);
}

export async function getBackgroundScanStatus(now = new Date()): Promise<BackgroundScanStatus> {
  const store = await database();
  const [env, latest, history] = await Promise.all([
    runtimeEnv(),
    store.prepare(
      "SELECT cycle_key, state, started_at, completed_at, summary_json FROM background_scan_runs ORDER BY started_at DESC LIMIT 1",
    ).first<BackgroundRunRow>(),
    store.prepare(
      "SELECT started_at, summary_json FROM background_scan_runs WHERE state IN ('COMPLETED', 'PARTIAL') ORDER BY started_at DESC LIMIT 96",
    ).all<GateAuditRow>(),
  ]);
  const configured = Boolean(env.BACKGROUND_SCANNER_TOKEN);
  const gateAudit = buildGateAudit(history.results ?? []);
  if (!latest) {
    return {
      schemaVersion: BACKGROUND_STATUS_VERSION,
      mode: "PAPER_SHADOW_READ_ONLY",
      state: configured ? "WAITING" : "OFF",
      configured,
      cadenceMinutes: 15,
      telegramEnabled: false,
      gateAudit,
      latestRun: null,
    };
  }
  const referenceTime = latest.completed_at ?? latest.started_at;
  const ageMinutes = Math.max(0, Math.round((now.getTime() - Date.parse(referenceTime)) / 60_000));
  let summary: Partial<BackgroundScanReport> = {};
  try {
    summary = JSON.parse(latest.summary_json) as Partial<BackgroundScanReport>;
  } catch {
    summary = {};
  }
  const state = !configured
    ? "OFF"
    : latest.state === "FAILED"
      ? "FAILED"
      : ageMinutes > 30
        ? "STALE"
        : latest.state === "PARTIAL"
          ? "PARTIAL"
          : "HEALTHY";
  return {
    schemaVersion: BACKGROUND_STATUS_VERSION,
    mode: "PAPER_SHADOW_READ_ONLY",
    state,
    configured,
    cadenceMinutes: 15,
    telegramEnabled: false,
    gateAudit,
    latestRun: {
      cycleKey: latest.cycle_key,
      state: latest.state,
      startedAt: latest.started_at,
      completedAt: latest.completed_at,
      ageMinutes,
      candidates: Number(summary.candidates ?? 0),
      paperOpen: Number(summary.paper?.open ?? 0),
      shadowResolved: Number(summary.shadow?.resolved ?? 0),
      exitActive: Number(summary.exitActive ?? 0),
      lanes: summary.lanes ?? null,
      warnings: Array.isArray(summary.warnings) ? summary.warnings : [],
    },
  };
}

export async function runBackgroundScan(now = new Date()): Promise<BackgroundScanReport> {
  const startedAt = now.toISOString();
  const key = cycleKey(now.getTime());
  if (!(await reserveCycle(key, startedAt))) {
    const position = await runPositionLane();
    const evidenceHash = await sha256(`${key}|SKIPPED_DUPLICATE`);
    return {
      schemaVersion: BACKGROUND_SCANNER_VERSION, mode: "PAPER_SHADOW_READ_ONLY", state: "SKIPPED_DUPLICATE",
      cycleKey: key, generatedAt: startedAt, dataHealth: "DEGRADED", candidates: 0,
      paper: { total: 0, open: 0, resolved: 0 }, shadow: { total: 0, open: 0, resolved: 0, verdict: "UNCHANGED" },
      hotVolume: { state: "NOT_RUN", returned: 0, ready: 0, breakout: 0, breakoutReady: 0, pairedResolved: 0, verdict: "UNCHANGED" },
      exitActive: 0, telegram: { offerState: "NOT_RUN", offered: 0, monitorState: position.state, checked: position.checked, alerted: position.alerted },
      lanes: {
        hardGate: { state: "SKIPPED_DUPLICATE", candidates: 0, strictCandidates: 0, opportunityCandidates: 0, eligibleCandidates: 0, alerted: 0, rejections: [], starvation: { consecutiveCycles: 0, threshold: 96, active: false } },
        early: { state: "SKIPPED_DUPLICATE", candidates: 0, alerted: 0 },
        hotVolume: { state: "SKIPPED_DUPLICATE", candidates: 0, alerted: 0 },
        positionMonitor: position,
      },
      warnings: ["CYCLE_ALREADY_PROCESSED"], evidenceHash,
    };
  }

  try {
    const warnings: string[] = [];
    const generatedAt = new Date().toISOString();
    const positionPromise = runPositionLane();
    const hotPromise = runHotVolumeLane();
    let scan: Awaited<ReturnType<typeof scanMarket>> | null = null;
    try {
      scan = await scanMarket();
    } catch {
      warnings.push("MARKET_SCAN_LANE_FAILED");
    }
    const scanHealth = assessScanDataHealth(scan?.universe ?? [], scan?.results ?? [], generatedAt);
    let health = scanHealth;
    let candidates = scan ? paperCandidates(scan.results) : [];
    const strictCandidateCount = scan ? scan.results.filter((item) => item.candidate?.risk.gatePass).length : 0;
    const opportunityCandidateCount = candidates.length;
    const earlyCandidates = scan ? earlyWatches(scan.results) : [];
    let hardState = scan ? "READY" : "FAILED";
    let hardAlerted = 0;
    let earlyState = scan ? "READY" : "FAILED";
    let earlyAlerted = 0;
    const hardRejections = scan ? rejectionSummary(scan.results) : [];

    if (scan) {
      try {
        const inputs = candidates.slice(0, 10).map(({ symbol, direction }) => ({ symbol, direction }));
        const intelligence = await loadIntelligence(scan.universe.map((item) => item.symbol), inputs);
        for (const candidate of candidates) {
          const context = intelligence.context[candidate.symbol];
          if (!context) continue;
          candidate.rankingScore = Math.max(0, Math.min(100, candidate.technicalScore + context.adjustment));
          candidate.catalysts = context.catalysts;
          candidate.contextAdjustment = context.adjustment;
          candidate.newsAdjustment = context.newsAdjustment;
        }
        if (intelligence.events.blackout.active) {
          health = degradeScanDataHealth(health, "EVENT_BLACKOUT");
          candidates = [];
        } else {
          // P0 audit: news context must not push a sub-threshold setup into paper.
          candidates = candidates.filter((candidate) => candidate.technicalScore >= PAPER_MIN_SCORE);
        }
      } catch {
        health = degradeScanDataHealth(health, "INTEL_UNAVAILABLE");
        candidates = [];
      }
      try {
        await syncPaperTrades(candidates, generatedAt, health);
        const hardOffer = await offerTelegramSetups(candidates, generatedAt, health);
        hardState = hardOffer.state;
        hardAlerted = hardOffer.offered;
        if (hardOffer.state !== "READY" && hardOffer.state !== "DISABLED" && hardOffer.state !== "BLOCKED_EVIDENCE_GATE") warnings.push(`HARD_GATE_${hardOffer.state}`);
      } catch {
        hardState = "FAILED";
        warnings.push("HARD_GATE_LANE_FAILED");
      }
      try {
        const earlyOffer = await offerTelegramEarlyWatches(earlyCandidates, scanHealth);
        earlyState = earlyOffer.state;
        earlyAlerted = earlyOffer.offered;
        if (earlyOffer.state !== "READY" && earlyOffer.state !== "DISABLED") warnings.push(`EARLY_${earlyOffer.state}`);
      } catch {
        earlyState = "FAILED";
        warnings.push("EARLY_LANE_FAILED");
      }
    }

    const paper = await getPaperJournal().catch(() => null);
    const shadow = scan ? await syncShadowEvaluation(scan.results, generatedAt).catch(() => null) : null;
    const exit = await syncExitManagement().catch(() => null);
    const haxkai = scan ? await syncHaxkaiShadow(scan.universe.map((item) => item.symbol), generatedAt).catch(() => null) : null;
    if (!paper) warnings.push("PAPER_JOURNAL_UNAVAILABLE");
    if (!shadow) warnings.push("SHADOW_EVIDENCE_UNAVAILABLE");
    if (!exit) warnings.push("EXIT_LANE_FAILED");
    if (!haxkai) warnings.push("HAXKAI_LANE_FAILED");
    let hotVolume: BackgroundScanReport["hotVolume"] = { state: "NOT_RUN", returned: 0, ready: 0, breakout: 0, breakoutReady: 0, pairedResolved: 0, verdict: "INSUFFICIENT DATA" };
    let hotState = "FAILED";
    let hotAlerted = 0;
    try {
      const { report: hotReport, evaluation: hotEvaluation } = await hotPromise;
      const hotTelegram = await offerTelegramHotVolumeWatches(hotReport.candidates, hotReport.source.state).catch(() => ({ state: "FAILED", offered: 0 }));
      hotVolume = {
        state: hotReport.source.state,
        returned: hotReport.summary.returned,
        ready: hotReport.summary.ready,
        breakout: hotReport.summary.breakout,
        breakoutReady: hotReport.summary.breakoutReady,
        pairedResolved: hotEvaluation.pairedResolved,
        verdict: hotEvaluation.verdict,
      };
      hotState = hotTelegram.state;
      hotAlerted = hotTelegram.offered;
      if (hotReport.source.state !== "HEALTHY") warnings.push("HOT_VOLUME_DEGRADED");
      if (hotTelegram.state !== "READY" && hotTelegram.state !== "DISABLED" && hotTelegram.state !== "BLOCKED_SOURCE_HEALTH" && hotTelegram.state !== "BLOCKED_EVIDENCE_GATE") warnings.push(`HOT_VOLUME_${hotTelegram.state}`);
    } catch {
      warnings.push("HOT_VOLUME_EVIDENCE_UNAVAILABLE");
    }
    const position = await positionPromise;
    if (position.polled > position.handled) warnings.push("TELEGRAM_UPDATE_PARTIAL");
    if (position.state === "DEGRADED") warnings.push("POSITION_MONITOR_DEGRADED");
    if (health.state !== "HEALTHY") warnings.push(...health.reasons);
    const starvation = await starvationState(key, candidates.length);
    if (starvation.active) warnings.push("HARD_GATE_STARVATION_24H");

    const reportBase = {
      schemaVersion: BACKGROUND_SCANNER_VERSION,
      mode: "PAPER_SHADOW_READ_ONLY" as const,
      state: (warnings.length ? "PARTIAL" : "COMPLETED") as "PARTIAL" | "COMPLETED",
      cycleKey: key,
      generatedAt,
      dataHealth: health.state,
      candidates: candidates.length,
      paper: { total: paper?.summary.allTotal ?? 0, open: paper?.summary.allOpen ?? 0, resolved: paper?.summary.allResolved ?? 0 },
      shadow: { total: shadow?.shadow.total ?? 0, open: shadow?.shadow.open ?? 0, resolved: shadow?.shadow.resolved ?? 0, verdict: shadow?.verdict ?? "UNAVAILABLE" },
      hotVolume,
      exitActive: exit?.summary.active ?? 0,
      telegram: { offerState: hardState, offered: hardAlerted, monitorState: position.state, checked: position.checked, alerted: position.alerted },
      lanes: {
        hardGate: {
          state: hardState,
          candidates: candidates.length,
          strictCandidates: strictCandidateCount,
          opportunityCandidates: opportunityCandidateCount,
          eligibleCandidates: candidates.length,
          alerted: hardAlerted,
          rejections: hardRejections,
          starvation,
        },
        early: { state: earlyState, candidates: earlyCandidates.length, alerted: earlyAlerted },
        hotVolume: { state: hotState, candidates: hotVolume.returned, alerted: hotAlerted },
        positionMonitor: position,
      },
      warnings: [...new Set(warnings)],
    };
    const evidenceHash = await sha256(JSON.stringify(reportBase));
    const report: BackgroundScanReport = { ...reportBase, evidenceHash };
    await completeCycle(report);
    return report;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const detail = error instanceof Error ? error.message : "Unknown background error";
    const evidenceHash = await sha256(`${key}|FAILED|${completedAt}|${detail}`);
    await (await database()).prepare(
      "UPDATE background_scan_runs SET state = 'FAILED', completed_at = ?, evidence_hash = ?, summary_json = ? WHERE cycle_key = ?",
    ).bind(completedAt, evidenceHash, JSON.stringify({ error: detail }), key).run();
    throw error;
  }
}
