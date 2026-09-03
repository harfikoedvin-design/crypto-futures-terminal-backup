# Signal Engine Evaluation v83

Tanggal evaluasi: 2026-09-01 UTC  
Mode: read-only market data, paper/shadow only, tanpa order exchange.

## Bukti sebelum perubahan

- Execution cohort: 18 posisi, 16 resolved, 6 WIN dan 10 LOSE.
- AUTO PAPER: 8 posisi; 6 resolved dan seluruhnya LOSE. Estimasi net closed sekitar -20.01 USDT.
- Momentum Breakout AUTO PAPER: 5 resolved, 0 WIN, 5 LOSE; rata-rata rule score 91.6 tetapi estimasi net sekitar -17.92 USDT.
- Manual/custom: 10 resolved, 6 WIN, 4 LOSE; estimasi net sekitar +17.22 USDT.
- Learning monitor: 13 resolved, 2 WIN, 11 LOSE; expectancy nominal sekitar -0.54R.
- Hot Volume evidence V1 pernah menghasilkan verdict `REVERT`, tetapi jalur Hot Volume dan Early masih dapat melewati promotion gate.
- `/pnl` memilih 20 row monitor campuran sebelum memfilter execution. Akibatnya hanya 13 dari 18 execution terhitung dan sekitar +11.67 USDT PNL terlewat.

## Diagnosis

1. Rule score tinggi mengukur banyaknya kondisi yang terpenuhi, bukan probabilitas menang.
2. Momentum Breakout menentukan arah terutama dari perubahan 1H dan masuk dekat harga breakout tanpa menunggu retest tertutup.
3. Alignment 4H, exhaustion RSI, dan trigger Stochastic belum menjadi syarat wajib yang konsisten.
4. Early dan Hot Volume tidak memiliki promotion gate cohort yang benar-benar fail-closed.
5. Perbandingan Hot Volume V1 memakai RAW dan HARDENED identik pada pasangan yang sama, sehingga delta expectancy pasangan selalu nol dan `KEEP` praktis tidak mungkin.
6. Query `/pnl` membatasi row sebelum membedakan execution dan learning monitor.

## Kebijakan v83

- Hot Volume `BREAKOUT READY` membutuhkan breakout 1H, retest closed 15m yang touch + hold + rejection, regime 4H/24H dan EMA21 1H searah, Stochastic searah, RSI tidak exhaustion, spread/extension aman, serta quality gate 5/5.
- Hot Volume evidence di-reset ke schema V2. Promotion membandingkan cohort forward RAW dengan execution-eligible; `KEEP` memerlukan minimal 30 resolved di kedua cohort, expectancy eligible positif, delta minimal +0.15R, profit factor minimal 1.2, dan drawdown maksimal 10R.
- Early memakai schema V2 dan tetap `LEARNING_SHADOW` sampai 30 resolved. `KEEP` memerlukan expectancy positif, profit factor minimal 1.2, dan drawdown maksimal 10R.
- Shadow Early tidak memiliki execution evidence, tidak masuk AUTO PAPER, dan tidak dihitung oleh `/pnl`.
- Semua pesan memisahkan `RULE SCORE` dari `EVIDENCE CONFIDENCE`.
- `/pnl` memfilter execution di SQL tanpa batas row agregasi, memisahkan realized/running net, dan hanya membatasi detail tampilan.

## Guardrail tetap

- Modal simulasi awal: 1,000 USD.
- Maksimum risiko per trade: 2% dari realized balance, termasuk estimasi biaya.
- Maksimum risiko portfolio: 6%; maksimum arah yang sama: 4%.
- Tidak ada private exchange key dan tidak ada jalur order exchange.
- Existing execution tidak dihapus atau ditulis ulang; perubahan berlaku pada cohort baru dan pelaporan ledger.
