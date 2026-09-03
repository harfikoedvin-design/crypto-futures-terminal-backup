import { NextRequest, NextResponse } from "next/server";

import { getTelegramStatus, pollTelegramUpdates, runTelegramMonitor } from "@/lib/telegram-monitor";
import { requireOwnerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = await requireOwnerApi(request);
  if (denied) return denied;
  try {
    const polling = await pollTelegramUpdates();
    const monitoring = await runTelegramMonitor();
    return NextResponse.json({ polling, monitoring, status: await getTelegramStatus() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Telegram polling gagal dengan aman.", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
