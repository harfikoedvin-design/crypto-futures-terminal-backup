import { NextRequest, NextResponse } from "next/server";

import { loadUniverse, SCREENER_RULES } from "@/lib/market";
import { requireViewerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  try {
    const universe = await loadUniverse();
    return NextResponse.json(
      {
        universe,
        generatedAt: new Date().toISOString(),
        policy: {
          prefilterLimit: SCREENER_RULES.prefilterLimit,
          minimumQuoteVolume: SCREENER_RULES.minimumQuoteVolume,
          maximumSpreadBps: SCREENER_RULES.maximumSpreadBps,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Data Binance Futures sedang tidak dapat dijangkau dari cloud.",
        detail: error instanceof Error ? error.message : "Unknown provider error",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
