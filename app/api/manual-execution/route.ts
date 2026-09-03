import { NextRequest, NextResponse } from "next/server";

import { decideManualExecution, getManualExecutionStatus, runTelegramMonitor } from "@/lib/telegram-monitor";
import { requireOwnerApi, requireViewerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getManualExecutionStatus(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Manual Execution belum tersedia.", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireOwnerApi(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { tradeId?: unknown; action?: unknown; actualEntry?: unknown };
    if (body.action === "REFRESH") {
      await runTelegramMonitor();
      return NextResponse.json(await getManualExecutionStatus(), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (!new Set(["EXECUTE", "PASS", "CLOSE"]).has(String(body.action))) throw new Error("Action tidak valid.");
    return NextResponse.json(await decideManualExecution({
      tradeId: String(body.tradeId ?? ""),
      action: body.action as "EXECUTE" | "PASS" | "CLOSE",
      actualEntry: Number(body.actualEntry),
    }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Manual Execution gagal diproses.", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
