import { NextRequest, NextResponse } from "next/server";

import { handleTelegramUpdate, verifyWebhookSecret } from "@/lib/telegram-monitor";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await verifyWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return NextResponse.json(await handleTelegramUpdate(await request.json()), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Webhook update ditolak dengan aman." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
