import { NextRequest, NextResponse } from "next/server";

import { getEvaluationReport, syncShadowEvaluation } from "@/lib/evaluation";
import { requireOwnerApi, requireViewerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getEvaluationReport(), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Evaluation journal belum tersedia." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireOwnerApi(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { results?: unknown; generatedAt?: unknown };
    return NextResponse.json(
      await syncShadowEvaluation(body.results, String(body.generatedAt ?? "")),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Sinkronisasi controlled evaluation gagal." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
