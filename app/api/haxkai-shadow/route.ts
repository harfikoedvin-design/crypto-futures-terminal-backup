import { NextRequest, NextResponse } from "next/server";

import { getHaxkaiShadowReport, syncHaxkaiShadow } from "@/lib/haxkai-shadow";
import { requireOwnerApi, requireViewerApi } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireViewerApi(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await getHaxkaiShadowReport(), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Haxkai shadow journal belum tersedia." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireOwnerApi(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { symbols?: unknown; generatedAt?: unknown };
    return NextResponse.json(
      await syncHaxkaiShadow(body.symbols, String(body.generatedAt ?? "")),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Sinkronisasi haxkai shadow gagal." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
