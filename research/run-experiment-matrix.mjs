import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const days = Number(process.argv.find((item) => item.startsWith("--days="))?.split("=")[1] ?? 210);
const resume = process.argv.includes("--resume=true");
const experiments = [
  { tag: "matrix-baseline", args: [] },
  { tag: "matrix-strict", args: ["--breakout-strict-trend=true", "--sweep-strict-trend=true"] },
  {
    tag: "matrix-quality-3r",
    args: [
      "--breakout-strict-trend=true",
      "--breakout-volume=1.5",
      "--breakout-adx=20",
      "--breakout-max-penetration=0.5",
      "--retest-volume-cap=1.2",
      "--sweep-volume=1.5",
      "--sweep-strict-trend=true",
    ],
  },
  {
    tag: "matrix-volume-18",
    args: [
      "--breakout-strict-trend=true",
      "--breakout-volume=1.8",
      "--breakout-adx=20",
      "--breakout-max-penetration=0.5",
      "--retest-volume-cap=1.2",
      "--sweep-volume=1.8",
      "--sweep-strict-trend=true",
    ],
  },
  {
    tag: "matrix-quality-25r",
    args: [
      "--rr=2.5",
      "--breakout-strict-trend=true",
      "--breakout-volume=1.5",
      "--breakout-adx=20",
      "--breakout-max-penetration=0.5",
      "--retest-volume-cap=1.2",
      "--sweep-volume=1.5",
      "--sweep-strict-trend=true",
    ],
  },
  {
    tag: "matrix-quality-2r",
    args: [
      "--rr=2",
      "--breakout-strict-trend=true",
      "--breakout-volume=1.5",
      "--breakout-adx=20",
      "--breakout-max-penetration=0.5",
      "--retest-volume-cap=1.2",
      "--sweep-volume=1.5",
      "--sweep-strict-trend=true",
    ],
  },
  {
    tag: "matrix-quality-3r-48h",
    args: [
      "--horizon=192",
      "--breakout-strict-trend=true",
      "--breakout-volume=1.5",
      "--breakout-adx=20",
      "--breakout-max-penetration=0.5",
      "--retest-volume-cap=1.2",
      "--sweep-volume=1.5",
      "--sweep-strict-trend=true",
    ],
  },
  {
    tag: "matrix-quality-breakeven",
    args: [
      "--breakeven-at=1",
      "--breakout-strict-trend=true",
      "--breakout-volume=1.5",
      "--breakout-adx=20",
      "--breakout-max-penetration=0.5",
      "--retest-volume-cap=1.2",
      "--sweep-volume=1.5",
      "--sweep-strict-trend=true",
      "--sweep-momentum=true",
    ],
  },
  {
    tag: "matrix-quality-btc",
    args: [
      "--benchmark-alignment=true",
      "--breakout-strict-trend=true",
      "--breakout-volume=1.5",
      "--breakout-adx=20",
      "--breakout-max-penetration=0.5",
      "--retest-volume-cap=1.2",
      "--sweep-volume=1.5",
      "--sweep-strict-trend=true",
      "--sweep-momentum=true",
    ],
  },
  {
    tag: "matrix-quality-btc-breakeven",
    args: [
      "--benchmark-alignment=true",
      "--breakeven-at=1",
      "--breakout-strict-trend=true",
      "--breakout-volume=1.5",
      "--breakout-adx=20",
      "--breakout-max-penetration=0.5",
      "--retest-volume-cap=1.2",
      "--sweep-volume=1.5",
      "--sweep-strict-trend=true",
      "--sweep-momentum=true",
    ],
  },
  {
    tag: "matrix-retest-fast",
    args: [
      "--benchmark-alignment=true",
      "--retest-holds=1",
      "--breakout-strict-trend=true",
      "--breakout-volume=1.5",
      "--breakout-adx=20",
      "--breakout-max-penetration=0.5",
      "--retest-volume-cap=1.2",
      "--sweep-volume=1.5",
      "--sweep-strict-trend=true",
      "--sweep-momentum=true",
    ],
  },
  {
    tag: "matrix-active-session",
    args: [
      "--benchmark-alignment=true",
      "--active-utc-start=6",
      "--active-utc-end=21",
      "--breakout-strict-trend=true",
      "--breakout-volume=1.5",
      "--breakout-adx=20",
      "--breakout-max-penetration=0.5",
      "--retest-volume-cap=1.2",
      "--sweep-volume=1.5",
      "--sweep-strict-trend=true",
      "--sweep-momentum=true",
    ],
  },
];

function run(experiment) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["research/backtest-framework.mjs", `--days=${days}`, `--tag=${experiment.tag}`, ...experiment.args],
      { cwd: process.cwd(), stdio: "inherit" },
    );
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${experiment.tag} exited ${code}`))));
  });
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function summarize(trades) {
  const wins = trades.filter((item) => item.outcome === "WIN").length;
  const losses = trades.filter((item) => item.outcome === "LOSS").length;
  const positive = trades.filter((item) => item.netR > 0).reduce((sum, item) => sum + item.netR, 0);
  const negative = Math.abs(trades.filter((item) => item.netR < 0).reduce((sum, item) => sum + item.netR, 0));
  return {
    trades: trades.length,
    winRate: wins / Math.max(1, wins + losses) * 100,
    expectancyR: mean(trades.map((item) => item.netR)),
    profitFactor: negative > 0 ? positive / negative : positive > 0 ? 99 : 0,
    netR: trades.reduce((sum, item) => sum + item.netR, 0),
  };
}

function format(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

for (const experiment of experiments) {
  const resultPath = join(process.cwd(), "research", "results", `${experiment.tag}.json`);
  if (resume && existsSync(resultPath)) continue;
  await run(experiment);
}

const results = [];
for (const experiment of experiments) {
  const payload = JSON.parse(await readFile(join(process.cwd(), "research", "results", `${experiment.tag}.json`), "utf8"));
  const evaluationStart = new Date(payload.meta.evaluationStart).getTime();
  const end = new Date(payload.meta.endAt).getTime();
  const cutoff = evaluationStart + (end - evaluationStart) * (2 / 3);
  for (const strategy of ["BREAKOUT_CONTINUATION", "RETEST_CONTINUATION", "LIQUIDITY_SWEEP_REVERSAL"]) {
    const trades = payload.trades.filter((item) => item.strategy === strategy);
    results.push({
      tag: experiment.tag,
      strategy,
      config: payload.meta.config,
      cutoff: new Date(cutoff).toISOString(),
      train: summarize(trades.filter((item) => new Date(item.signalAt).getTime() < cutoff)),
      test: summarize(trades.filter((item) => new Date(item.signalAt).getTime() >= cutoff)),
    });
  }
}

const rows = results.map((item) =>
  `| ${item.tag} | ${item.strategy.replaceAll("_", " ")} | ${item.train.trades} | ${format(item.train.expectancyR)}R | ${format(item.train.profitFactor)} | ${item.test.trades} | ${format(item.test.expectancyR)}R | ${format(item.test.profitFactor)} |`,
).join("\n");

const selected = ["BREAKOUT_CONTINUATION", "RETEST_CONTINUATION", "LIQUIDITY_SWEEP_REVERSAL"].map((strategy) => {
  const eligible = results
    .filter((item) => item.strategy === strategy && item.train.trades >= 20)
    .sort((a, b) => b.train.expectancyR - a.train.expectancyR);
  return { strategy, selection: eligible[0] ?? null };
});

const selectionText = selected.map(({ strategy, selection }) => {
  if (!selection) return `- ${strategy}: no variant had at least 20 training trades.`;
  const pass = selection.train.expectancyR > 0 && selection.test.expectancyR > 0 && selection.test.profitFactor > 1;
  return `- ${strategy}: ${selection.tag} was best on train; test ${format(selection.test.expectancyR)}R expectancy / PF ${format(selection.test.profitFactor)} — ${pass ? "provisional pass" : "fail or inconclusive"}.`;
}).join("\n");

const report = `# Walk-forward Parameter Matrix

Generated: ${new Date().toISOString()}  
History requested: ${days} days  
Split: first two-thirds of the evaluation window for exploratory selection; final third held out for test.

| Variant | Strategy | Train N | Train Exp. | Train PF | Test N | Test Exp. | Test PF |
|---|---|---:|---:|---:|---:|---:|---:|
${rows}

## Selection check

${selectionText}

## Guardrail

These are predefined sensitivity variants, not permission to deploy. A positive held-out slice still requires enough trades, stability across pairs/regimes, and live shadow confirmation with OI, funding, spread, and taker data.
`;

await mkdir(join(process.cwd(), "research", "results"), { recursive: true });
await writeFile(join(process.cwd(), "research", "results", "walk-forward-matrix.json"), JSON.stringify({ days, experiments, results, selected }, null, 2));
await writeFile(join(process.cwd(), "research", "results", "walk-forward-matrix.md"), report);
process.stdout.write(`\n${report}\n`);
