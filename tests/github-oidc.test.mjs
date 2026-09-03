import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const context = { waitUntil() {}, passThroughOnException() {} };

function base64url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  return Buffer.from(bytes).toString("base64url");
}

async function signedToken(privateKey, claims) {
  const header = base64url(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }));
  const payload = base64url(JSON.stringify(claims));
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(input));
  return `${input}.${base64url(signature)}`;
}

test("GitHub collector fails closed when no trusted scheduler repository is configured", async () => {
  globalThis.__GITHUB_OIDC_ENV_TEST_BINDING__ = {};
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("github-oidc-test", `${process.pid}-${Date.now()}`);
  const app = (await import(workerUrl.href)).default;
  const response = await app.fetch(
    new Request("http://localhost/api/background/github", { method: "POST" }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    context,
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("GitHub OIDC trust is bounded to one public main-branch scheduled workflow", async () => {
  const [source, route, telegramRoute, readme] = await Promise.all([
    readFile(new URL("../lib/github-oidc.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/background/github/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/telegram/github/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);
  assert.match(source, /token\.actions\.githubusercontent\.com/);
  assert.match(source, /repository_visibility === "public"/);
  assert.match(source, /claims\.ref === "refs\/heads\/main"/);
  assert.match(source, /claims\.event_name === "schedule"/);
  assert.match(source, /claims\.workflow_ref === workflowRef/);
  assert.match(source, /claims\.sub === subject/);
  assert.match(source, /GITHUB_SCHEDULER_SUBJECT/);
  assert.match(source, /crypto-futures-terminal-collector-v1/);
  assert.match(route, /verifyGitHubSchedulerToken/);
  assert.match(route, /runBackgroundScan/);
  assert.match(telegramRoute, /verifyGitHubSchedulerToken/);
  assert.match(telegramRoute, /pollTelegramUpdates/);
  assert.match(telegramRoute, /runTelegramMonitor/);
  assert.match(readme, /workflow scheduler publik aktif/i);
});

test("GitHub collector accepts a correctly signed, bounded, short-lived identity", async () => {
  const repository = "harfikoedvin-design/crypto-terminal-scheduler";
  const subject = "repo:harfikoedvin-design@320202505/crypto-terminal-scheduler@1350792998:ref:refs/heads/main";
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  publicJwk.kid = "test-key";
  const now = Math.floor(Date.now() / 1000);
  const token = await signedToken(keys.privateKey, {
    iss: "https://token.actions.githubusercontent.com",
    aud: "crypto-futures-terminal-collector-v1",
    sub: subject,
    repository,
    repository_visibility: "public",
    ref: "refs/heads/main",
    event_name: "workflow_dispatch",
    workflow_ref: `${repository}/.github/workflows/collector.yml@refs/heads/main`,
    iat: now,
    nbf: now - 1,
    exp: now + 300,
  });
  globalThis.__GITHUB_OIDC_ENV_TEST_BINDING__ = {
    GITHUB_SCHEDULER_REPOSITORY: repository,
    GITHUB_SCHEDULER_SUBJECT: subject,
  };
  globalThis.__GITHUB_OIDC_FETCH_TEST__ = async (input) => {
    if (input.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer: "https://token.actions.githubusercontent.com",
        jwks_uri: "https://token.actions.githubusercontent.com/.well-known/jwks",
      });
    }
    return Response.json({ keys: [publicJwk] });
  };
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("github-oidc-valid-test", `${process.pid}-${Date.now()}`);
  const app = (await import(workerUrl.href)).default;
  const response = await app.fetch(
    new Request("http://localhost/api/background/github", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    context,
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /collector gagal/i);
  assert.doesNotMatch(body.detail, /unauthorized/i);
  delete globalThis.__GITHUB_OIDC_ENV_TEST_BINDING__;
  delete globalThis.__GITHUB_OIDC_FETCH_TEST__;
});
