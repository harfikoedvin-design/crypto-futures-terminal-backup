# Signal Improvement Notes — v82

Date: 2026-09-01

## Product boundary

Crypto Futures Terminal remains a signal-first, read-only learning system:

- output is `LONG`, `SHORT`, or `NO TRADE`;
- actionable setups may enter the universal `AUTO PAPER` ledger;
- simulated starting capital stays USD 1,000;
- planned loss at the structural stop, including estimated round-trip cost, stays at or below 2% of realized balance;
- no authenticated exchange endpoint, private exchange key, order placement, modification, or cancellation;
- Telegram is a notification and paper-monitoring companion, never an execution venue.

## Live baseline before v82

- Sites v81, commit `1b8d1e2073712510a158fb04f6c13d5ba0551f51`.
- Runtime safety was `HEALTHY`; entry circuit was `OPEN`.
- Paper ledger: 37 total, 11 open, 26 resolved.
- V1 legacy: 35 total, 2 TP, 20 SL, 4 manual, 9 open; all were LONG.
- V3: 2 open and no resolved outcomes, so there is no valid V3 performance verdict yet.
- Telegram monitor ledger: 138 records, including 105 stale `OFFERED` records; all 105 were older than six hours and 64 were older than 24 hours.
- Hard Gate had produced zero eligible candidates for 73 consecutive cycles. The leading rejection reasons were base `NO TRADE`, 15m misalignment, insufficient post-cost R:R, unconfirmed OI, low relative volume, and overextension.
- Hot Volume paired evidence had reached 61 resolved comparisons and still returned `REVERT`.

## What the evidence says

The V1 loss cohort is primarily an entry/continuation problem, not only an exit-target problem. None of the 20 V1 stop-outs reached +1R before SL; only five reached +0.5R. Staged exit management improved the observed average only slightly, so loosening the entry gate or moving TP closer is not justified by current evidence.

The V3 risk gate is behaving correctly. Two open LONG positions consumed the configured same-direction allowance, and the next LONG AUTO PAPER attempt was blocked with `PAPER_DIRECTION_RISK_LIMIT`. This protection must remain intact.

## Phanes concepts worth adopting

Phanes is used only as product-method inspiration. Its documentation says it is not a trading bot, does not offer an API, and does not permit automated queries. The terminal must not scrape or automate Phanes. Original, permitted public providers remain the only data inputs.

Relevant concepts:

1. **First-call anchoring** — preserve signal time, reference price, source closed candle, and subsequent move from that exact point.
2. **Multi-horizon agreement** — a strong directional verdict requires agreement from at least two horizons; one strong horizon remains a leaning/watch state.
3. **State and milestone alerts** — notify once when a meaningful state or risk milestone is crossed, not on every data refresh.
4. **Cohort leaderboard** — compare signal models and setup families by hit rate, average and median R, expectancy, drawdown, and sample size.
5. **Time-performance analysis** — evaluate results by market session, regime, direction, setup type, and signal age.
6. **Bounded alert bands** — a state or threshold alerts once, then remains quiet until the state changes or the signal is re-armed.
7. **Source selection with provenance** — record which public venue supplied each observation and whether cross-venue evidence agreed.

Official references:

- https://docs.phanes.bot/phanes/commands
- https://docs.phanes.bot/phanes/alerts
- https://docs.phanes.bot/phanes/leaderboard
- https://docs.phanes.bot/phanes/dapp
- https://docs.phanes.bot/overview/faq
- https://docs.phanes.bot/overview/rate-limits

## v82 implementation scope

### Alert lifecycle

- Expire an untouched `OFFERED` monitor after four 15m candles (60 minutes).
- Preserve the row and evidence; mark it `EXPIRED` with `STALE_OFFER_4_CLOSED_15M` instead of deleting history.
- A stale offer must no longer block a fresh signal for the same pair, setup, direction, and state.

### State-change notifications

- Deduplicate monitor updates by strategy state, not by explanatory text containing changing indicator values.
- Keep `HOLD` silent in Telegram while continuing to persist its latest snapshot for `/status` and `/pnl`.
- Notify only meaningful changes: `WAIT`, `PROTECT`, `CLOSE_REVIEW`, `TP`, and `SL`.
- A state may alert again only after the monitor has transitioned away and returned to it.

### Evaluation workload

- The browser should not POST the full controlled-evaluation payload after every manual scan.
- Background collection remains the authoritative writer for closed-candle evaluation cohorts.
- The browser refreshes the stored evaluation report with a bounded GET request.

## Next evidence work after v82

These items remain shadow/report-only until their own forward evidence passes:

1. Near-miss funnel: top five rejected candidates with the exact missing gates and next closed-candle review condition.
2. Direction calibration: separate LONG and SHORT expectancy by regime; never force a SHORT merely to balance counts.
3. Multi-horizon verdict: 15m trigger plus agreement from at least two higher-timeframe evidence buckets.
4. Cohort scorecard: median R, hit rate at +0.5R/+1R, expectancy, profit factor, maximum drawdown, and sample size by model/setup/session.
5. Cross-venue provenance: Binance remains the execution-reference price for paper accounting; other public venues can confirm or conflict but cannot silently replace it.
6. Alert-band settings: configurable state/milestone preferences without weakening risk or entry gates.

## Promotion rules

- Do not judge V3 until at least 30 resolved trades; 50–100 is preferred.
- Do not promote a shadow feature from raw win rate alone.
- Require positive post-cost expectancy, acceptable drawdown, adequate sample size, and stable results across direction/regime buckets.
- A data source or feature that does not change the signal decision, invalidation, risk, or evaluation quality stays out of the main terminal.
