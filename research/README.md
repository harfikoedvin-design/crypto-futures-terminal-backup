# Research Harness

This directory contains offline, research-only validation for the terminal rules. It does not alter the live scanner or user interface.

## Commands

```bash
npm run research:backtest -- --days=150
npm run research:matrix -- --days=210
```

The backtest downloads closed Binance 15-minute candles, aggregates them without look-ahead, enters on the next candle open, applies conservative intrabar ordering, includes estimated round-trip costs, and writes reports to `research/results`.

Use `decision-summary.md` as the human review document. Detailed JSON trade logs are supporting research data and should not be interpreted as trading recommendations.
