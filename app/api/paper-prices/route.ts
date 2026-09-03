import { NextRequest, NextResponse } from "next/server";

import { loadLivePrices } from "@/lib/market";
import { getPaperJournal, settlePaperTrades } from "@/lib/paper-trading";
import { requireViewerApi, viewerAccess } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}USDT$/;

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  const symbols = (request.nextUrl.searchParams.get("symbols") ?? "")
    .toUpperCase()
    .split(",")
    .filter((symbol, index, items) => SYMBOL_PATTERN.test(symbol) && items.indexOf(symbol) === index)
    .slice(0, 50);
  if (!symbols.length) {
    return NextResponse.json({ error: "Daftar simbol paper trade tidak valid." }, { status: 400 });
  }

  try {
    const prices = await loadLivePrices(symbols);
    const journal = (await viewerAccess(request)).owner ? await settlePaperTrades(prices) : await getPaperJournal();
    return NextResponse.json(
      { prices, journal, generatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[api/paper-prices] refresh failed", {
      message: error instanceof Error ? error.message : String(error),
      symbols: symbols.length,
    });
    return NextResponse.json(
      {
        error: "Harga live paper trade belum dapat diperbarui.",
        detail: error instanceof Error ? error.message : "Unknown provider error",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
