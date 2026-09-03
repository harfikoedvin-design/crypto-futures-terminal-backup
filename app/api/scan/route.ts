import { NextRequest, NextResponse } from "next/server";

import { assessScanDataHealth } from "@/lib/data-health";
import { scanMarket, SCREENER_RULES } from "@/lib/market";
import { requireViewerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  try {
    const { universe, results } = await scanMarket();
    const generatedAt = new Date().toISOString();
    return NextResponse.json(
      {
        universe,
        results,
        generatedAt,
        dataHealth: assessScanDataHealth(universe, results, generatedAt),
        policy: {
          topN: SCREENER_RULES.topN,
          minimumScore: SCREENER_RULES.minimumScore,
          minimumAdx: SCREENER_RULES.minimumAdx,
          minimumRelativeVolume: SCREENER_RULES.minimumRelativeVolume,
          minimumRiskReward: SCREENER_RULES.minimumRiskReward,
          maximumSpreadBps: SCREENER_RULES.maximumSpreadBps,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Pemindaian pasar gagal; terminal tidak menerbitkan kandidat.",
        detail: error instanceof Error ? error.message : "Unknown provider error",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
