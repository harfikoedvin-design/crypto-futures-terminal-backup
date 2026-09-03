import { NextRequest, NextResponse } from "next/server";

import { analyzeSymbol } from "@/lib/market";
import { requireViewerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Z0-9]{2,16}USDT$/;

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase() ?? "";
  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json({ error: "Simbol tidak valid." }, { status: 400 });
  }

  try {
    const result = await analyzeSymbol(symbol);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        symbol,
        error: "Analisis simbol gagal; simbol dilewati agar Top 5 tidak dipaksakan.",
        detail: error instanceof Error ? error.message : "Unknown analysis error",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
