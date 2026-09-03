import { NextRequest, NextResponse } from "next/server";

import { offerTelegramSetups } from "@/lib/telegram-monitor";
import { requireOwnerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = await requireOwnerApi(request);
  if (denied) return denied;
  try {
    const payload = await request.json() as { candidates?: unknown[]; generatedAt?: string; dataHealth?: unknown };
    const result = await offerTelegramSetups(Array.isArray(payload.candidates) ? payload.candidates : [], typeof payload.generatedAt === "string" ? payload.generatedAt : new Date().toISOString(), payload.dataHealth);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Telegram offer gagal dengan aman.", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
