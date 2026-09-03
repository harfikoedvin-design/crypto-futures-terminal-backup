import { NextResponse } from "next/server";

import { VIEWER_COOKIE } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ state: "SIGNED_OUT" }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(VIEWER_COOKIE, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
