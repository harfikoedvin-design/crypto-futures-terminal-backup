import { NextRequest, NextResponse } from "next/server";

import { loadChartSeries, loadLivePrice, loadMarketLevels, type ChartInterval, type ChartSnapshot } from "@/lib/market";
import { requireViewerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Z0-9]{2,16}USDT$/;
const INTERVALS = new Set<ChartInterval>(["4h", "1h", "15m"]);

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase() ?? "";
  const interval = (request.nextUrl.searchParams.get("interval") ?? "1h") as ChartInterval;
  if (!SYMBOL_PATTERN.test(symbol) || !INTERVALS.has(interval)) {
    return NextResponse.json({ error: "Simbol atau timeframe tidak valid." }, { status: 400 });
  }

  try {
    const [points, livePrice, levels] = await Promise.all([
      loadChartSeries(symbol, interval),
      loadLivePrice(symbol),
      loadMarketLevels(symbol),
    ]);
    if (!points.length) throw new Error("Candle tertutup belum tersedia");
    const payload: ChartSnapshot = {
      symbol,
      interval,
      points,
      livePrice,
      levels,
      flowSource: points.some((point) => point.openInterestDelta !== null) ? "OPEN_INTEREST" : "VOLUME_PROXY",
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(
      payload,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Chart belum dapat dimuat.",
        detail: error instanceof Error ? error.message : "Unknown provider error",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
