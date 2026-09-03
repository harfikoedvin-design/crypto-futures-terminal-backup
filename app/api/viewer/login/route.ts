import { NextRequest, NextResponse } from "next/server";

import { clearFailedLogins, createViewerSession, loginRateLimit, recordFailedLogin, verifyAccessCode, VIEWER_COOKIE, VIEWER_SESSION_SECONDS } from "@/lib/viewer-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rate = await loginRateLimit(request);
  if (!rate.allowed) return NextResponse.json({ error: "Too many attempts", retryAfterSeconds: rate.retryAfterSeconds }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(rate.retryAfterSeconds) } });
  let code = "";
  try {
    const body = await request.json() as { code?: unknown };
    code = typeof body.code === "string" ? body.code.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!(await verifyAccessCode(code))) {
    await recordFailedLogin(request);
    return NextResponse.json({ error: "Invalid access code" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  await clearFailedLogins(request);
  const response = NextResponse.json({ state: "AUTHORIZED", expiresInSeconds: VIEWER_SESSION_SECONDS }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(VIEWER_COOKIE, await createViewerSession(), { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: VIEWER_SESSION_SECONDS });
  return response;
}
