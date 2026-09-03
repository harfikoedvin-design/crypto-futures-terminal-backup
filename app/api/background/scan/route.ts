import { NextRequest, NextResponse } from "next/server";

import { runBackgroundScan, verifyBackgroundToken } from "@/lib/background-scanner";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await verifyBackgroundToken(request.headers.get("authorization")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return NextResponse.json(await runBackgroundScan(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: "Background scan gagal dengan aman.", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
