import { NextRequest, NextResponse } from "next/server";

import { getPaperJournal, manualClosePaperTrade, syncPaperTrades } from "@/lib/paper-trading";
import { syncExitManagement } from "@/lib/exit-management";
import { decideManualExecution } from "@/lib/telegram-monitor";
import { requireOwnerApi, requireViewerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getPaperJournal(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Paper journal belum tersedia.",
        detail: error instanceof Error ? error.message : "Unknown database error",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireOwnerApi(request);
  if (denied) return denied;
  try {
    const payload = await request.json() as { candidates?: unknown[]; generatedAt?: string; dataHealth?: unknown };
    await syncPaperTrades(
      Array.isArray(payload.candidates) ? payload.candidates : [],
      typeof payload.generatedAt === "string" ? payload.generatedAt : new Date().toISOString(),
      payload.dataHealth,
    );
    return NextResponse.json(await getPaperJournal(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Sinkronisasi Auto Paper Trade gagal.",
        detail: error instanceof Error ? error.message : "Unknown paper engine error",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await requireOwnerApi(request);
  if (denied) return denied;
  try {
    const payload = await request.json() as { action?: unknown; tradeId?: unknown };
    if (payload.action !== "MANUAL_CLOSE") throw new Error("Action paper tidak valid.");
    const tradeId = String(payload.tradeId ?? "");
    const journal = await manualClosePaperTrade(tradeId);
    await Promise.all([
      decideManualExecution({ tradeId, action: "CLOSE" }).catch(() => null),
      syncExitManagement().catch(() => null),
    ]);
    return NextResponse.json(journal, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: "Close manual paper gagal.", detail: error instanceof Error ? error.message : "Unknown paper error" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
