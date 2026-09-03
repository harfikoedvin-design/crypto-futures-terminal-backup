import { NextRequest, NextResponse } from "next/server";

export const VIEWER_COOKIE = "fiko_viewer_session";
export const VIEWER_SESSION_SECONDS = 5 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

type ViewerStatement = {
  bind: (...values: unknown[]) => ViewerStatement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};
type ViewerDatabase = { prepare: (query: string) => ViewerStatement };

declare global {
  var __VIEWER_D1_TEST_BINDING__: ViewerDatabase | undefined;
  var __VIEWER_ENV_TEST_BINDING__: Record<string, string | undefined> | undefined;
}

type SessionPayload = { version: 1; issuedAt: number; expiresAt: number; nonce: string };

async function runtimeEnv(): Promise<Record<string, string | undefined>> {
  if (globalThis.__VIEWER_ENV_TEST_BINDING__) return globalThis.__VIEWER_ENV_TEST_BINDING__;
  try {
    const { env } = await import("cloudflare:workers");
    return env as unknown as Record<string, string | undefined>;
  } catch {
    return process.env;
  }
}

async function database(): Promise<ViewerDatabase> {
  if (globalThis.__VIEWER_D1_TEST_BINDING__) return globalThis.__VIEWER_D1_TEST_BINDING__;
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Viewer authentication database is unavailable");
  return env.DB as ViewerDatabase;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToString(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([digest(left), digest(right)]);
  let mismatch = leftHash.length ^ rightHash.length;
  for (let index = 0; index < leftHash.length; index += 1) mismatch |= leftHash[index] ^ rightHash[index];
  return mismatch === 0;
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

async function viewerAuthConfigured(): Promise<boolean> {
  const env = await runtimeEnv();
  return Boolean(env.PUBLIC_VIEWER_ACCESS_CODE && env.PUBLIC_VIEWER_SESSION_SECRET && env.TERMINAL_OWNER_EMAIL);
}

export async function createViewerSession(): Promise<string> {
  const env = await runtimeEnv();
  if (!env.PUBLIC_VIEWER_SESSION_SECRET) throw new Error("Viewer session secret is not configured");
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { version: 1, issuedAt, expiresAt: issuedAt + VIEWER_SESSION_SECONDS, nonce: crypto.randomUUID() };
  const encoded = stringToBase64Url(JSON.stringify(payload));
  return `${encoded}.${await sign(encoded, env.PUBLIC_VIEWER_SESSION_SECRET)}`;
}

export async function verifyViewerSession(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const env = await runtimeEnv();
  if (!env.PUBLIC_VIEWER_SESSION_SECRET) return false;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return false;
  if (!(await secureEqual(signature, await sign(encoded, env.PUBLIC_VIEWER_SESSION_SECRET)))) return false;
  try {
    const payload = JSON.parse(base64UrlToString(encoded)) as Partial<SessionPayload>;
    const now = Math.floor(Date.now() / 1000);
    return payload.version === 1 && Number.isInteger(payload.issuedAt) && Number.isInteger(payload.expiresAt) &&
      typeof payload.nonce === "string" && payload.issuedAt! <= now + 30 && payload.expiresAt! > now &&
      payload.expiresAt! - payload.issuedAt! === VIEWER_SESSION_SECONDS;
  } catch {
    return false;
  }
}

export async function isOwnerRequest(request: NextRequest): Promise<boolean> {
  const env = await runtimeEnv();
  const ownerEmail = env.TERMINAL_OWNER_EMAIL?.trim().toLowerCase();
  const requestEmail = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  return Boolean(ownerEmail && requestEmail && await secureEqual(ownerEmail, requestEmail));
}

export async function viewerAccess(request: NextRequest): Promise<{ authenticated: boolean; owner: boolean }> {
  if (globalThis.__VIEWER_ENV_TEST_BINDING__ && request.headers.get("x-viewer-auth-test") !== "enabled") return { authenticated: true, owner: true };
  if (!(await viewerAuthConfigured())) return { authenticated: true, owner: true };
  const owner = await isOwnerRequest(request);
  if (owner) return { authenticated: true, owner: true };
  return { authenticated: await verifyViewerSession(request.cookies.get(VIEWER_COOKIE)?.value), owner: false };
}

export async function requireViewerApi(request: NextRequest): Promise<NextResponse | null> {
  if ((await viewerAccess(request)).authenticated) return null;
  return NextResponse.json({ error: "Access code required", code: "VIEWER_AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

export async function requireOwnerApi(request: NextRequest): Promise<NextResponse | null> {
  if (globalThis.__VIEWER_ENV_TEST_BINDING__ && request.headers.get("x-viewer-auth-test") !== "enabled") return null;
  if (!(await viewerAuthConfigured())) return null;
  if (await isOwnerRequest(request)) return null;
  return NextResponse.json({ error: "Viewer mode is read only", code: "OWNER_REQUIRED" }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

async function identifierHash(request: NextRequest): Promise<string> {
  const env = await runtimeEnv();
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return bytesToBase64Url(await digest(`${env.PUBLIC_VIEWER_SESSION_SECRET ?? "viewer"}|${ip}`));
}

export async function loginRateLimit(request: NextRequest): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const identifier = await identifierHash(request);
  const row = await (await database()).prepare("SELECT failed_count, window_started_at, blocked_until FROM viewer_login_attempts WHERE identifier_hash = ?")
    .bind(identifier).first<{ failed_count: number; window_started_at: string; blocked_until: string | null }>();
  if (!row?.blocked_until) return { allowed: true, retryAfterSeconds: 0 };
  const remaining = Date.parse(row.blocked_until) - Date.now();
  return remaining > 0 ? { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) } : { allowed: true, retryAfterSeconds: 0 };
}

export async function recordFailedLogin(request: NextRequest): Promise<void> {
  const identifier = await identifierHash(request);
  const store = await database();
  const existing = await store.prepare("SELECT failed_count, window_started_at FROM viewer_login_attempts WHERE identifier_hash = ?")
    .bind(identifier).first<{ failed_count: number; window_started_at: string }>();
  const now = Date.now();
  const windowExpired = !existing || now - Date.parse(existing.window_started_at) >= LOGIN_WINDOW_MS;
  const count = windowExpired ? 1 : Number(existing.failed_count) + 1;
  const windowStartedAt = new Date(windowExpired ? now : Date.parse(existing!.window_started_at)).toISOString();
  const blockedUntil = count >= MAX_FAILED_ATTEMPTS ? new Date(now + LOGIN_WINDOW_MS).toISOString() : null;
  await store.prepare("INSERT INTO viewer_login_attempts (identifier_hash, failed_count, window_started_at, blocked_until, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(identifier_hash) DO UPDATE SET failed_count = excluded.failed_count, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until, updated_at = excluded.updated_at")
    .bind(identifier, count, windowStartedAt, blockedUntil, new Date(now).toISOString()).run();
}

export async function clearFailedLogins(request: NextRequest): Promise<void> {
  await (await database()).prepare("DELETE FROM viewer_login_attempts WHERE identifier_hash = ?").bind(await identifierHash(request)).run();
}

export async function verifyAccessCode(candidate: string): Promise<boolean> {
  const env = await runtimeEnv();
  const expected = env.PUBLIC_VIEWER_ACCESS_CODE;
  if (!expected || candidate.length < 6 || candidate.length > 64) return false;
  return secureEqual(candidate, expected);
}
