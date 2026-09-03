import { NextRequest, NextResponse } from "next/server";

import { attachCrossExchangeEvidence } from "@/lib/evaluation";
import { requireViewerApi, viewerAccess } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Z0-9]{1,20}USDT$/;
const DIRECTIONS = new Set(["LONG", "SHORT"]);

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const direction = request.nextUrl.searchParams.get("direction")?.trim().toUpperCase() ?? "";
  const referencePrice = Number(request.nextUrl.searchParams.get("referencePrice"));
  if (!SYMBOL_PATTERN.test(symbol) || !DIRECTIONS.has(direction) || !Number.isFinite(referencePrice) || referencePrice <= 0) {
    return NextResponse.json({ error: "Permintaan cross-exchange tidak valid." }, { status: 400 });
  }

  const relayBase = process.env.BINANCE_RELAY_URL?.trim().replace(/\/$/, "");
  const relayToken = process.env.BINANCE_RELAY_TOKEN?.trim();
  if (!relayBase || !relayToken) {
    return NextResponse.json({ state: "disabled", reason: "Relay read-only belum dikonfigurasi." }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const upstream = new URL("/api/cross-exchange", relayBase);
  upstream.searchParams.set("symbol", symbol);
  upstream.searchParams.set("direction", direction);
  upstream.searchParams.set("referencePrice", String(referencePrice));
  try {
    const response = await fetch(upstream, {
      headers: { "X-Relay-Token": relayToken, Accept: "application/json" },
      signal: AbortSignal.timeout(18_000),
      cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel();
      return NextResponse.json({ state: "unavailable", reason: `Relay merespons ${response.status}.` }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const snapshot = await response.json() as Record<string, unknown>;
    if ((await viewerAccess(request)).owner) {
      await attachCrossExchangeEvidence(symbol, direction, snapshot.status, snapshot.evidenceHash).catch(() => null);
    }
    return NextResponse.json({ state: "healthy", ...snapshot }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ state: "unavailable", reason: "Relay cross-exchange belum dapat dijangkau." }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
