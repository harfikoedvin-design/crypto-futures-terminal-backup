import { RISK_ENGINE_LIMITS } from "@/lib/risk-engine";

export const PAPER_ACCOUNT_SCHEMA_VERSION = "paper-account-v1" as const;
export const PAPER_INITIAL_CAPITAL_USD = 1_000;
export const PAPER_MARGIN_PER_TRADE_USD = 10;
export const PAPER_DEFAULT_LEVERAGE = RISK_ENGINE_LIMITS.maximumLeverage;
export const PAPER_DEFAULT_ROUND_TRIP_COST_RATE = RISK_ENGINE_LIMITS.estimatedRoundTripCostRate;

export type PaperAccountingInput = {
  direction: "LONG" | "SHORT";
  entryPrice: number;
  markPrice: number;
  marginUsd?: number;
  leverage?: number;
  roundTripCostRate?: number;
};

export type PaperPositionAccounting = {
  schemaVersion: typeof PAPER_ACCOUNT_SCHEMA_VERSION;
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

function positiveOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

export function calculatePaperPositionAccounting(input: PaperAccountingInput): PaperPositionAccounting {
  const marginUsd = positiveOr(input.marginUsd, PAPER_MARGIN_PER_TRADE_USD);
  const leverage = positiveOr(input.leverage, PAPER_DEFAULT_LEVERAGE);
  const roundTripCostRate = Number.isFinite(input.roundTripCostRate) && Number(input.roundTripCostRate) >= 0
    ? Number(input.roundTripCostRate)
    : PAPER_DEFAULT_ROUND_TRIP_COST_RATE;
  const notionalUsd = marginUsd * leverage;
  const direction = input.direction === "SHORT" ? -1 : 1;
  const priceReturn = input.entryPrice > 0 && Number.isFinite(input.markPrice)
    ? ((input.markPrice - input.entryPrice) / input.entryPrice) * direction
    : 0;
  const grossPnlUsd = notionalUsd * priceReturn;
  const estimatedRoundTripFeesUsd = notionalUsd * roundTripCostRate;
  const rawNetPnlUsd = grossPnlUsd - estimatedRoundTripFeesUsd;
  // Isolated-margin paper accounting cannot lose more than the margin assigned
  // to the position. Maintenance margin and liquidation fees are not modeled.
  const netPnlUsd = Math.max(-marginUsd, rawNetPnlUsd);
  return {
    schemaVersion: PAPER_ACCOUNT_SCHEMA_VERSION,
    marginUsd,
    leverage,
    notionalUsd,
    roundTripCostRate,
    estimatedRoundTripFeesUsd,
    grossPnlUsd,
    rawNetPnlUsd,
    netPnlUsd,
    netRoiPct: marginUsd > 0 ? (netPnlUsd / marginUsd) * 100 : 0,
    marginLossCapped: rawNetPnlUsd <= -marginUsd,
  };
}
