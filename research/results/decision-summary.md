# Framework Research Verdict

Generated from a 210-day historical study ending 2026-08-23, using twelve USDT perpetual pairs and closed 15-minute candles aggregated to 1H and 4H.

## What was tested

- The technical core of the current High Quality rule.
- Breakout Continuation.
- Retest Continuation with stored breakout state and multi-candle hold.
- Liquidity Sweep Reversal using previous-day levels, reclaim, and micro confirmation.
- RR sensitivity at 2R, 2.5R, and 3R.
- Volume thresholds at 1.3x, 1.5x, and 1.8x.
- Strict versus minimum H4 trend.
- 24-hour versus 48-hour outcome horizon.
- Break-even stop after +1R.
- BTC benchmark alignment.
- Active-session filtering.
- A final-third held-out time segment after exploratory selection on the first two-thirds.

All entries use the next 15-minute candle open. Same-candle stop/target collisions are treated conservatively as stop first. A 0.10% round-trip cost is included. Historical OI, taker ratio, funding, spread, news, and X data were not fabricated and are reserved for live shadow validation.

## Main results

| Rule | Representative result | Verdict |
|---|---:|---|
| Current technical core | 25 trades; -0.43R expectancy; PF 0.52 | Not validated; sample too small for a final rejection, but the High Quality label is unsupported |
| Baseline breakout | 283 trades; -0.12R expectancy; PF 0.86 | Reject as a live rule |
| Quality breakout (3R) | 162 trades; -0.10R expectancy; PF 0.88 | Reject as a live rule |
| Quality breakout + BTC alignment | 132 trades; approximately 0.00R aggregate | Shadow candidate only; held-out +0.46R on just 17 trades, while training remained negative |
| Retest continuation | All tested training variants negative | Reject pending a materially different trigger/entry model |
| Liquidity sweep reversal | Baseline -0.45R; strict versions produced too few signals | Early research only; do not alert or score as High Quality |

## Parameter findings

- Raising breakout volume to 1.8x reduced signal count and improved the training slice toward break-even, but the held-out slice fell to -0.20R. It is not a stable solution.
- The 3R target performed less poorly than 2.5R and 2R in the quality matrix. Lowering RR did not rescue the framework.
- Moving the stop to break-even after +1R did not create a stable edge.
- Extending the horizon from 24 to 48 hours did not materially fix the setup.
- Restricting alerts to an assumed active UTC session did not improve held-out results.
- BTC directional alignment was the only filter with a meaningful improvement in the newest held-out slice, but it was regime-dependent and not positive in the earlier training slice.

## Approved for the next shadow design

- Keep setup names separate: Breakout, Retest, and Sweep must never be inferred from one generic label.
- Remove all default/free score points.
- Use H4 for market regime, H1 for structure/setup, and M15 for trigger.
- Add BTC benchmark alignment as a recorded feature, not yet as an unquestioned hard gate.
- Keep RR around 3R for research, but require a real structural target before any execution-ready status.
- Store every rejected and accepted signal with raw component values so future weights can be calibrated from outcomes.
- Treat news and X as context/ranking only.
- Keep OI, taker, funding, spread, and early-accumulation logic for live shadow logging because reliable historical coverage is insufficient.

## Explicitly not approved

- Deploying any of the tested setup rules as High Quality.
- Calling the score a probability or confidence percentage.
- Liquidity Sweep Telegram alerts.
- Lowering RR to manufacture a higher win rate.
- Selecting rules by pair after seeing pair-level performance.
- Automatic orders or execution advice.

## Next evidence gate

Before live replacement, a shadow logger should record the full technical and derivatives snapshot on every scan without changing the user-facing candidate list. Review is allowed only after a predefined sample is reached. Proposed minimums: 100 resolved Breakout observations and at least 50 resolved observations for any other setup, with results reported by market regime and without changing weights mid-sample.
