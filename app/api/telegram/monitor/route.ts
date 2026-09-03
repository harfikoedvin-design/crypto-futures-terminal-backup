import { NextRequest, NextResponse } from "next/server";

import { runTelegramMonitor, verifyMonitorToken } from "@/lib/telegram-monitor";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await verifyMonitorToken(request.headers.get("authorization")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(await runTelegramMonitor(), { headers: { "Cache-Control": "no-store" } });
}
