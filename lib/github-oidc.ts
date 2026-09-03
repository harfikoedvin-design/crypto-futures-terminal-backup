const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const COLLECTOR_OIDC_AUDIENCE = "crypto-futures-terminal-collector-v1";
const COLLECTOR_WORKFLOW_PATH = ".github/workflows/collector.yml";
const TOKEN_MAX_AGE_SECONDS = 10 * 60;
const CLOCK_TOLERANCE_SECONDS = 60;

type RuntimeEnvironment = Record<string, string | undefined>;
type GitHubOidcClaims = {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  iat?: unknown;
  nbf?: unknown;
  repository?: unknown;
  repository_visibility?: unknown;
  ref?: unknown;
  event_name?: unknown;
  workflow_ref?: unknown;
};
type JsonWebKeyWithId = JsonWebKey & { kid?: string; alg?: string; use?: string };

declare global {
  var __GITHUB_OIDC_ENV_TEST_BINDING__: RuntimeEnvironment | undefined;
  var __GITHUB_OIDC_FETCH_TEST__: ((input: string) => Promise<Response>) | undefined;
}

let cachedKeys: { expiresAt: number; keys: JsonWebKeyWithId[] } | null = null;

async function runtimeEnv(): Promise<RuntimeEnvironment> {
  if (globalThis.__GITHUB_OIDC_ENV_TEST_BINDING__) return globalThis.__GITHUB_OIDC_ENV_TEST_BINDING__;
  try {
    const { env } = await import("cloudflare:workers");
    return env as unknown as RuntimeEnvironment;
  } catch {
    return process.env;
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
  } catch {
    return null;
  }
}

async function oidcFetch(input: string): Promise<Response> {
  if (globalThis.__GITHUB_OIDC_FETCH_TEST__) return globalThis.__GITHUB_OIDC_FETCH_TEST__(input);
  return fetch(input, { headers: { Accept: "application/json" } });
}

async function githubSigningKeys(): Promise<JsonWebKeyWithId[]> {
  if (cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;
  const discoveryResponse = await oidcFetch(`${GITHUB_OIDC_ISSUER}/.well-known/openid-configuration`);
  if (!discoveryResponse.ok) {
    await discoveryResponse.body?.cancel();
    throw new Error("GitHub OIDC discovery unavailable");
  }
  const discovery = await discoveryResponse.json() as { issuer?: string; jwks_uri?: string };
  if (discovery.issuer !== GITHUB_OIDC_ISSUER || !discovery.jwks_uri?.startsWith(`${GITHUB_OIDC_ISSUER}/`)) {
    throw new Error("GitHub OIDC discovery is invalid");
  }
  const jwksResponse = await oidcFetch(discovery.jwks_uri);
  if (!jwksResponse.ok) {
    await jwksResponse.body?.cancel();
    throw new Error("GitHub OIDC keys unavailable");
  }
  const jwks = await jwksResponse.json() as { keys?: JsonWebKeyWithId[] };
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  if (!keys.length) throw new Error("GitHub OIDC keys are empty");
  cachedKeys = { expiresAt: Date.now() + 60 * 60_000, keys };
  return keys;
}

function hasAudience(value: unknown): boolean {
  return value === COLLECTOR_OIDC_AUDIENCE
    || (Array.isArray(value) && value.length === 1 && value[0] === COLLECTOR_OIDC_AUDIENCE);
}

export function validateGitHubOidcClaims(
  claims: GitHubOidcClaims,
  repository: string,
  subject: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const workflowRef = `${repository}/${COLLECTOR_WORKFLOW_PATH}@refs/heads/main`;
  return claims.iss === GITHUB_OIDC_ISSUER
    && hasAudience(claims.aud)
    && claims.repository === repository
    && claims.repository_visibility === "public"
    && claims.ref === "refs/heads/main"
    && (claims.event_name === "schedule" || claims.event_name === "workflow_dispatch")
    && claims.workflow_ref === workflowRef
    && claims.sub === subject
    && typeof claims.exp === "number"
    && claims.exp >= nowSeconds - CLOCK_TOLERANCE_SECONDS
    && typeof claims.iat === "number"
    && claims.iat <= nowSeconds + CLOCK_TOLERANCE_SECONDS
    && claims.iat >= nowSeconds - TOKEN_MAX_AGE_SECONDS - CLOCK_TOLERANCE_SECONDS
    && (claims.nbf === undefined || (typeof claims.nbf === "number" && claims.nbf <= nowSeconds + CLOCK_TOLERANCE_SECONDS));
}

export async function verifyGitHubSchedulerToken(authorization: string | null): Promise<boolean> {
  try {
    const environment = await runtimeEnv();
    const repository = environment.GITHUB_SCHEDULER_REPOSITORY?.trim();
    const subject = environment.GITHUB_SCHEDULER_SUBJECT?.trim();
    if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return false;
    if (!subject || !/^repo:[A-Za-z0-9_.-]+@\d+\/[A-Za-z0-9_.-]+@\d+:ref:refs\/heads\/main$/.test(subject)) return false;
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
    if (!match) return false;
    const [encodedHeader, encodedClaims, encodedSignature] = match[1].split(".");
    const header = decodeJson<{ alg?: unknown; kid?: unknown; typ?: unknown }>(encodedHeader);
    const claims = decodeJson<GitHubOidcClaims>(encodedClaims);
    if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") return false;
    const jwk = (await githubSigningKeys()).find((key) => key.kid === header.kid && key.kty === "RSA");
    if (!jwk) return false;
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`);
    const verified = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      publicKey,
      decodeBase64Url(encodedSignature),
      signed,
    );
    return verified && validateGitHubOidcClaims(claims, repository, subject);
  } catch {
    return false;
  }
}
