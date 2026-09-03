import { NextRequest, NextResponse } from "next/server";

import { verifyGitHubSchedulerToken } from "@/lib/github-oidc";
import { pollTelegramUpdates, runTelegramMonitor } from "@/lib/telegram-monitor";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await verifyGitHubSchedulerToken(request.headers.get("authorization")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const polling = await pollTelegramUpdates();
    const monitoring = await runTelegramMonitor();
    return NextResponse.json({ state: polling.state === "DEGRADED" || monitoring.state === "FAILED" ? "DEGRADED" : "READY", polling, monitoring }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Telegram listener gagal dengan aman.", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
