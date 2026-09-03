export const RISK_ENGINE_VERSION = "V3" as const;

export const RISK_ENGINE_LIMITS = {
  maximumLeverage: 20,
  riskPerTradePct: 2,
  maximumPortfolioRiskPct: 6,
  maximumSameDirectionRiskPct: 4,
  minimumStopDistanceAtr: 0.5,
  minimumGrossRiskReward: 3,
  minimumNetRiskReward: 2.7,
  estimatedRoundTripCostRate: 0.001,
  liquidationDistanceBuffer: 0.7,
} as const;

export type RiskMetrics = {
  version: typeof RISK_ENGINE_VERSION;
  sizingMode: "FIXED_FRACTIONAL";
  assumedLeverage: number;
  maximumLeverage: number;
  stopDistancePct: number;
  stopDistanceAtr: number;
  estimatedRoiAtStopPct: number;
  grossRiskReward: number;
  netRiskReward: number;
  riskPerTradePct: number;
  accountEquityUsd: number;
  riskBudgetUsd: number;
  estimatedLossAtStopUsd: number;
  estimatedFeesUsd: number;
  notionalUsd: number;
  marginUsd: number;
  quantity: number;
  maximumStopDistancePct: null;
  gateFailures: string[];
  gatePass: boolean;
};

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

export function calculateRiskMetrics(input: {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  atr: number;
  accountEquityUsd?: number;
  riskBudgetUsd?: number;
}): RiskMetrics {
  const { entryPrice, stopLoss, takeProfit, atr } = input;
  const accountEquityUsd = positive(input.accountEquityUsd, 1_000);
  const defaultRiskBudgetUsd = accountEquityUsd * (RISK_ENGINE_LIMITS.riskPerTradePct / 100);
  const riskBudgetUsd = Math.min(defaultRiskBudgetUsd, positive(input.riskBudgetUsd, defaultRiskBudgetUsd));
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);
  const stopDistanceRate = entryPrice > 0 ? risk / entryPrice : 99;
  const stopDistancePct = stopDistanceRate * 100;
  const stopDistanceAtr = atr > 0 ? risk / atr : 99;
  const roundTripCostRate = RISK_ENGINE_LIMITS.estimatedRoundTripCostRate;
  const totalLossRate = stopDistanceRate + roundTripCostRate;
  const notionalUsd = totalLossRate > 0 ? riskBudgetUsd / totalLossRate : 0;
  const safeLeverage = stopDistanceRate > 0
    ? Math.max(1, Math.floor(RISK_ENGINE_LIMITS.liquidationDistanceBuffer / stopDistanceRate))
    : 1;
  const assumedLeverage = Math.min(RISK_ENGINE_LIMITS.maximumLeverage, safeLeverage);
  const marginUsd = assumedLeverage > 0 ? notionalUsd / assumedLeverage : 0;
  const quantity = entryPrice > 0 ? notionalUsd / entryPrice : 0;
  const estimatedFeesUsd = notionalUsd * roundTripCostRate;
  const estimatedLossAtStopUsd = notionalUsd * stopDistanceRate + estimatedFeesUsd;
  const feeCost = entryPrice * roundTripCostRate;
  const grossRiskReward = risk > 0 ? reward / risk : 0;
  const netRiskReward = risk > 0 ? (reward - feeCost) / (risk + feeCost) : 0;
  const gateFailures: string[] = [];
  if (!(entryPrice > 0 && stopLoss > 0 && takeProfit > 0 && risk > 0 && reward > 0)) gateFailures.push("TECHNICAL_PLAN_INVALID");
  if (stopDistanceAtr < RISK_ENGINE_LIMITS.minimumStopDistanceAtr) gateFailures.push("STOP_INSIDE_ATR_NOISE");
  if (grossRiskReward < RISK_ENGINE_LIMITS.minimumGrossRiskReward) gateFailures.push("GROSS_RR_BELOW_3");
  if (netRiskReward < RISK_ENGINE_LIMITS.minimumNetRiskReward) gateFailures.push("NET_RR_BELOW_2_7_AFTER_COSTS");
  if (!(notionalUsd > 0 && marginUsd > 0 && marginUsd <= accountEquityUsd)) gateFailures.push("POSITION_SIZE_INVALID");
  if (estimatedLossAtStopUsd > riskBudgetUsd + 0.01) gateFailures.push("RISK_BUDGET_EXCEEDED");
  return {
    version: RISK_ENGINE_VERSION,
    sizingMode: "FIXED_FRACTIONAL",
    assumedLeverage,
    maximumLeverage: RISK_ENGINE_LIMITS.maximumLeverage,
    stopDistancePct,
    stopDistanceAtr,
    estimatedRoiAtStopPct: stopDistancePct * assumedLeverage,
    grossRiskReward,
    netRiskReward,
    riskPerTradePct: RISK_ENGINE_LIMITS.riskPerTradePct,
    accountEquityUsd,
    riskBudgetUsd,
    estimatedLossAtStopUsd,
    estimatedFeesUsd,
    notionalUsd,
    marginUsd,
    quantity,
    maximumStopDistancePct: null,
    gateFailures,
    gatePass: gateFailures.length === 0,
  };
}
