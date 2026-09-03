import { NextRequest, NextResponse } from "next/server";

import { configureTelegramBot, getTelegramPairingCommand, getTelegramStatus } from "@/lib/telegram-monitor";
import { requireOwnerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireOwnerApi(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ status: await getTelegramStatus(), pairingCommand: await getTelegramPairingCommand() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Secure Telegram setup belum tersedia.", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireOwnerApi(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { token?: unknown };
    if (typeof body.token !== "string") throw new Error("Token BotFather wajib diisi.");
    return NextResponse.json(await configureTelegramBot(body.token), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Bot Telegram gagal disambungkan.", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
