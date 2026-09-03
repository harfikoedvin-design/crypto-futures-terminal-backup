import assert from "node:assert/strict";
import test from "node:test";

class FakeD1 {
  constructor() { this.rows = new Map(); }
  prepare(sql) {
    let values = [];
    return {
      bind(...input) { values = input; return this; },
      first: async () => {
        if (sql.includes("viewer_login_attempts")) return this.rows.get(values[0]) ?? null;
        return null;
      },
      run: async () => {
        if (sql.startsWith("DELETE FROM viewer_login_attempts")) this.rows.delete(values[0]);
        if (sql.startsWith("INSERT INTO viewer_login_attempts")) {
          this.rows.set(values[0], { failed_count: values[1], window_started_at: values[2], blocked_until: values[3], updated_at: values[4] });
        }
        return { success: true };
      },
    };
  }
}

async function worker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("viewer-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

const context = { waitUntil() {}, passThroughOnException() {} };

test("public viewer receives a fixed five-hour signed session and remains read-only", async () => {
  const database = new FakeD1();
  globalThis.__VIEWER_D1_TEST_BINDING__ = database;
  globalThis.__VIEWER_ENV_TEST_BINDING__ = {
    PUBLIC_VIEWER_ACCESS_CODE: "FIKO-TEST-829",
    PUBLIC_VIEWER_SESSION_SECRET: "test-secret-with-at-least-thirty-two-characters",
    TERMINAL_OWNER_EMAIL: "owner@example.com",
  };
  const app = await worker();
  const runtime = { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };

  const locked = await app.fetch(new Request("http://localhost/api/paper-trades", { headers: { "x-viewer-auth-test": "enabled" } }), runtime, context);
  assert.equal(locked.status, 401);

  const login = await app.fetch(new Request("http://localhost/api/viewer/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.10", "x-viewer-auth-test": "enabled" },
    body: JSON.stringify({ code: "FIKO-TEST-829" }),
  }), runtime, context);
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie") ?? "";
  assert.match(cookie, /fiko_viewer_session=/);
  assert.match(cookie, /Max-Age=18000/i);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Strict/i);

  const viewerCookie = cookie.split(";")[0];
  const mutation = await app.fetch(new Request("http://localhost/api/paper-trades", {
    method: "POST",
    headers: { cookie: viewerCookie, "content-type": "application/json", "x-viewer-auth-test": "enabled" },
    body: JSON.stringify({ candidates: [] }),
  }), runtime, context);
  assert.equal(mutation.status, 403);
  assert.equal((await mutation.json()).code, "OWNER_REQUIRED");

  const tampered = `${viewerCookie.slice(0, -1)}x`;
  const rejected = await app.fetch(new Request("http://localhost/api/paper-trades", { headers: { cookie: tampered, "x-viewer-auth-test": "enabled" } }), runtime, context);
  assert.equal(rejected.status, 401);
});

test("five failed codes trigger a fifteen-minute rate limit", async () => {
  const database = new FakeD1();
  globalThis.__VIEWER_D1_TEST_BINDING__ = database;
  globalThis.__VIEWER_ENV_TEST_BINDING__ = {
    PUBLIC_VIEWER_ACCESS_CODE: "FIKO-TEST-829",
    PUBLIC_VIEWER_SESSION_SECRET: "test-secret-with-at-least-thirty-two-characters",
    TERMINAL_OWNER_EMAIL: "owner@example.com",
  };
  const app = await worker();
  const runtime = { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const request = () => new Request("http://localhost/api/viewer/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.11", "x-viewer-auth-test": "enabled" },
    body: JSON.stringify({ code: "WRONG-CODE" }),
  });
  for (let index = 0; index < 5; index += 1) assert.equal((await app.fetch(request(), runtime, context)).status, 401);
  const blocked = await app.fetch(request(), runtime, context);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});
