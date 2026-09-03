import type { AnalysisResult, UniverseItem } from "@/lib/market";

export type ScanDataHealth = {
  schemaVersion: "data-health-v1";
  state: "HEALTHY" | "DEGRADED";
  checkedAt: string;
  universeCount: number;
  resultCount: number;
  providerFailures: number;
  reasons: string[];
  warnings: string[];
};

export function assessScanDataHealth(
  universe: UniverseItem[],
  results: AnalysisResult[],
  checkedAt: string,
): ScanDataHealth {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const providerFailures = results.filter((item) => item.failedGates.includes("PROVIDER_UNAVAILABLE")).length;
  const missingSnapshots = results.filter((item) => !item.diagnostic.snapshots).length;
  if (!universe.length || !results.length) reasons.push("EMPTY_SCAN");
  const minimumCoverage = Math.min(universe.length, Math.max(5, Math.ceil(universe.length * 0.8)));
  if (results.length < minimumCoverage) reasons.push("INSUFFICIENT_SCAN_COVERAGE");
  else if (results.length !== universe.length) warnings.push("PARTIAL_SCAN_COVERAGE");
  if (providerFailures >= Math.max(3, Math.ceil(results.length * 0.2))) reasons.push("PROVIDER_FAILURE_CLUSTER");
  else if (providerFailures > 0) warnings.push("PROVIDER_FAILURE_PARTIAL");
  if (missingSnapshots >= Math.max(3, Math.ceil(results.length * 0.2))) reasons.push("MISSING_CLOSED_CANDLES_CLUSTER");
  else if (missingSnapshots > 0) warnings.push("MISSING_CLOSED_CANDLES_PARTIAL");
  const now = Date.parse(checkedAt);
  const staleConfirmations = results.filter((item) => {
    const closedAt = item.diagnostic.snapshots?.confirmation.closedAt;
    return !closedAt || closedAt > now + 2 * 60_000 || now - closedAt > 45 * 60_000;
  }).length;
  if (staleConfirmations >= Math.max(3, Math.ceil(results.length * 0.2))) reasons.push("STALE_15M_CANDLE_CLUSTER");
  else if (staleConfirmations > 0) warnings.push("STALE_15M_CANDLE_PARTIAL");
  return {
    schemaVersion: "data-health-v1",
    state: reasons.length ? "DEGRADED" : "HEALTHY",
    checkedAt,
    universeCount: universe.length,
    resultCount: results.length,
    providerFailures,
    reasons,
    warnings,
  };
}

export function degradeScanDataHealth(health: ScanDataHealth, reason: string): ScanDataHealth {
  return { ...health, state: "DEGRADED", reasons: [...new Set([...health.reasons, reason])] };
}
