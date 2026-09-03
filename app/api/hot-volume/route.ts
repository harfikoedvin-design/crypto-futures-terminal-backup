import { NextRequest, NextResponse } from "next/server";

import { loadHotVolumeReport } from "@/lib/hot-volume";
import { syncHotVolumeEvaluation } from "@/lib/hot-volume-evaluation";
import { requireOwnerApi, requireViewerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await loadHotVolumeReport(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Hot Volume Radar gagal dengan aman.",
        detail: error instanceof Error ? error.message : "Unknown radar error",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireOwnerApi(request);
  if (denied) return denied;
  try {
    const report = await loadHotVolumeReport();
    return NextResponse.json(
      { ...report, evaluation: await syncHotVolumeEvaluation(report) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Hot Volume evidence gagal dengan aman.",
        detail: error instanceof Error ? error.message : "Unknown evidence error",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
