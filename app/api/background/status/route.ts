import { NextRequest, NextResponse } from "next/server";

import { getBackgroundScanStatus, runBackgroundScan } from "@/lib/background-scanner";
import { requireOwnerApi, requireViewerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getBackgroundScanStatus(), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Status collector belum tersedia." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireOwnerApi(request);
  if (denied) return denied;
  try {
    const report = await runBackgroundScan();
    return NextResponse.json(
      { report, status: await getBackgroundScanStatus() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Collector gagal dengan aman.", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
