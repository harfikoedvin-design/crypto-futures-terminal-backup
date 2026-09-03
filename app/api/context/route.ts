import { NextRequest, NextResponse } from "next/server";

import { loadIntelligence, type ContextInput } from "@/lib/context";
import { requireViewerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Z0-9]{1,20}USDT$/;

function validInputs(raw: string): ContextInput[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ContextInput =>
          typeof item === "object" &&
          item !== null &&
          "symbol" in item &&
          "direction" in item &&
          typeof item.symbol === "string" &&
          SYMBOL_PATTERN.test(item.symbol) &&
          (item.direction === "LONG" || item.direction === "SHORT"),
      )
      .slice(0, 5);
  } catch {
    return [];
  }
}

function validSymbols(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is string =>
      typeof item === "string" && SYMBOL_PATTERN.test(item),
    ))].slice(0, 24);
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  const inputs = validInputs(request.nextUrl.searchParams.get("items") ?? "[]");
  const symbols = validSymbols(request.nextUrl.searchParams.get("symbols") ?? "[]");
  try {
    const intelligence = await loadIntelligence(symbols, inputs);
    return NextResponse.json(intelligence, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Konteks eksternal sedang tidak tersedia; hasil teknikal tidak diubah.",
        detail: error instanceof Error ? error.message : "Unknown context error",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
