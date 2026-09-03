import { NextRequest, NextResponse } from "next/server";

import { getTelegramStatus } from "@/lib/telegram-monitor";
import { requireViewerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getTelegramStatus(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Status Telegram Companion belum tersedia.", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
