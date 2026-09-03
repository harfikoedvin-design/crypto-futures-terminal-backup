# Walk-forward Parameter Matrix

Generated: 2026-08-23T12:59:13.910Z  
History requested: 210 days  
Split: first two-thirds of the evaluation window for exploratory selection; final third held out for test.

| Variant | Strategy | Train N | Train Exp. | Train PF | Test N | Test Exp. | Test PF |
|---|---|---:|---:|---:|---:|---:|---:|
| matrix-baseline | BREAKOUT CONTINUATION | 206 | -0.19R | 0.79 | 77 | 0.07R | 1.09 |
| matrix-baseline | RETEST CONTINUATION | 80 | -0.29R | 0.66 | 24 | -0.33R | 0.63 |
| matrix-baseline | LIQUIDITY SWEEP REVERSAL | 126 | -0.43R | 0.53 | 74 | -0.48R | 0.49 |
| matrix-strict | BREAKOUT CONTINUATION | 196 | -0.19R | 0.79 | 74 | 0.06R | 1.08 |
| matrix-strict | RETEST CONTINUATION | 74 | -0.31R | 0.65 | 22 | -0.26R | 0.70 |
| matrix-strict | LIQUIDITY SWEEP REVERSAL | 51 | -0.43R | 0.53 | 20 | -0.25R | 0.70 |
| matrix-quality-3r | BREAKOUT CONTINUATION | 125 | -0.13R | 0.85 | 37 | -0.01R | 0.99 |
| matrix-quality-3r | RETEST CONTINUATION | 39 | -0.42R | 0.54 | 10 | 0.03R | 1.04 |
| matrix-quality-3r | LIQUIDITY SWEEP REVERSAL | 39 | -0.40R | 0.56 | 13 | 0.04R | 1.05 |
| matrix-volume-18 | BREAKOUT CONTINUATION | 92 | -0.02R | 0.97 | 24 | -0.20R | 0.77 |
| matrix-volume-18 | RETEST CONTINUATION | 32 | -0.46R | 0.50 | 7 | -0.05R | 0.94 |
| matrix-volume-18 | LIQUIDITY SWEEP REVERSAL | 29 | -0.42R | 0.54 | 10 | 0.39R | 1.58 |
| matrix-quality-25r | BREAKOUT CONTINUATION | 126 | -0.17R | 0.79 | 37 | -0.15R | 0.82 |
| matrix-quality-25r | RETEST CONTINUATION | 40 | -0.31R | 0.64 | 10 | -0.12R | 0.85 |
| matrix-quality-25r | LIQUIDITY SWEEP REVERSAL | 39 | -0.40R | 0.54 | 13 | -0.09R | 0.89 |
| matrix-quality-2r | BREAKOUT CONTINUATION | 126 | -0.20R | 0.75 | 38 | -0.33R | 0.61 |
| matrix-quality-2r | RETEST CONTINUATION | 40 | -0.17R | 0.78 | 11 | -0.07R | 0.90 |
| matrix-quality-2r | LIQUIDITY SWEEP REVERSAL | 39 | -0.35R | 0.58 | 13 | 0.45R | 1.86 |
| matrix-quality-3r-48h | BREAKOUT CONTINUATION | 124 | -0.11R | 0.88 | 37 | -0.01R | 0.99 |
| matrix-quality-3r-48h | RETEST CONTINUATION | 39 | -0.39R | 0.57 | 10 | 0.03R | 1.04 |
| matrix-quality-3r-48h | LIQUIDITY SWEEP REVERSAL | 39 | -0.44R | 0.53 | 13 | 0.07R | 1.09 |
| matrix-quality-breakeven | BREAKOUT CONTINUATION | 125 | -0.08R | 0.87 | 37 | -0.11R | 0.84 |
| matrix-quality-breakeven | RETEST CONTINUATION | 39 | -0.18R | 0.68 | 10 | 0.03R | 1.04 |
| matrix-quality-breakeven | LIQUIDITY SWEEP REVERSAL | 4 | -0.12R | 0.86 | 3 | -0.86R | 0.00 |
| matrix-quality-btc | BREAKOUT CONTINUATION | 115 | -0.07R | 0.92 | 17 | 0.46R | 1.67 |
| matrix-quality-btc | RETEST CONTINUATION | 33 | -0.52R | 0.45 | 5 | 0.43R | 1.63 |
| matrix-quality-btc | LIQUIDITY SWEEP REVERSAL | 1 | -1.11R | 0.00 | 0 | 0.00R | 0.00 |
| matrix-quality-btc-breakeven | BREAKOUT CONTINUATION | 115 | -0.08R | 0.87 | 17 | 0.22R | 1.39 |
| matrix-quality-btc-breakeven | RETEST CONTINUATION | 33 | -0.30R | 0.50 | 5 | 0.43R | 1.63 |
| matrix-quality-btc-breakeven | LIQUIDITY SWEEP REVERSAL | 1 | -1.11R | 0.00 | 0 | 0.00R | 0.00 |
| matrix-retest-fast | BREAKOUT CONTINUATION | 115 | -0.07R | 0.92 | 17 | 0.46R | 1.67 |
| matrix-retest-fast | RETEST CONTINUATION | 45 | -0.61R | 0.38 | 6 | 0.18R | 1.24 |
| matrix-retest-fast | LIQUIDITY SWEEP REVERSAL | 1 | -1.11R | 0.00 | 0 | 0.00R | 0.00 |
| matrix-active-session | BREAKOUT CONTINUATION | 79 | -0.04R | 0.96 | 8 | -0.28R | 0.69 |
| matrix-active-session | RETEST CONTINUATION | 24 | -0.46R | 0.50 | 3 | 0.12R | 1.15 |
| matrix-active-session | LIQUIDITY SWEEP REVERSAL | 0 | 0.00R | 0.00 | 0 | 0.00R | 0.00 |

## Selection check

- BREAKOUT_CONTINUATION: matrix-volume-18 was best on train; test -0.20R expectancy / PF 0.77 — fail or inconclusive.
- RETEST_CONTINUATION: matrix-quality-2r was best on train; test -0.07R expectancy / PF 0.90 — fail or inconclusive.
- LIQUIDITY_SWEEP_REVERSAL: matrix-quality-2r was best on train; test 0.45R expectancy / PF 1.86 — fail or inconclusive.

## Guardrail

These are predefined sensitivity variants, not permission to deploy. A positive held-out slice still requires enough trades, stability across pairs/regimes, and live shadow confirmation with OI, funding, spread, and taker data.
