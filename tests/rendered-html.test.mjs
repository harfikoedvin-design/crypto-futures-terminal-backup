import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /High Quality Top 5/i);
  assert.match(html, /aria-label="Menu terminal"/i);
  assert.match(html, />Intel</i);
  assert.match(html, />Paper</i);
  assert.match(html, />Eval</i);
  assert.match(html, /FORWARD EVIDENCE COLLECTOR/i);
  assert.match(html, /R:R bersih ≥1:3/i);
  const dashboard = await readFile(new URL("../app/terminal-dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /POSITION CONTROL · TERMINAL V1/i);
  assert.match(dashboard, /Monitor \/ Pass \/ Manual Close/i);
  assert.match(dashboard, /START MONITOR/i);
  assert.match(dashboard, /CLOSE PAPER/i);
  assert.match(dashboard, /MOMENTUM BREAKOUT RADAR V2/i);
  assert.match(dashboard, /Volume Acceleration Desk/i);
  assert.match(dashboard, /Stochastic 5,3,3/i);
  assert.match(dashboard, /8 pair \/ halaman/i);
  assert.match(dashboard, /EXIT MANAGEMENT V2 · SHADOW/i);
  assert.match(dashboard, /TP1 FULL CLOSE/i);
  assert.match(dashboard, /PAIRED FORWARD/i);
  assert.match(dashboard, /LEGACY EXCLUDED/i);
  assert.match(dashboard, /NEWS AT ENTRY/i);
  assert.doesNotMatch(dashboard, /X INFLUENCER SCREEN/i);
  assert.match(dashboard, /INDEPENDENT SCANNER LANES V1/i);
  assert.doesNotMatch(dashboard, /bukan uang asli/i);
  const gate = await readFile(new URL("../app/viewer-gate.tsx", import.meta.url), "utf8");
  assert.match(gate, /SESSION 5 HOURS/i);
  assert.match(gate, /AUTHORIZED VIEWER/i);
});
