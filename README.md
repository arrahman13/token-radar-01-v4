# Token Radar v4 — Launch Radar

[![Competition](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/arrahman13/token-radar-01-v4/rank.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/arrahman13/token-radar-01-v4/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token launch radar over the sealed DefiLlama snapshot of 758 protocols.
It ranks 198 protocols that record no token by an implied value — TVL × a
fitted value multiple × fitted launch odds — and gives every one a costed
farm plan. Entry for the make.fun bounty
[token-radar-01](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01).

## The models, and how they are kept honest

- **Value model.** A regression of ln(market cap / TVL) on the 87 traded
  peers with a market cap of at least $5M: a log-TVL size curve plus
  category effects shrunk toward the whole-field mean.
- **Odds model.** A logistic fit on the 645 dated protocols (327 record a
  token by the snapshot date, base rate 0.507), built on a log-age curve.
- **Admission search.** Every candidate term is tried as a single, as part
  of every pair, and as an addition on top of the admitted set. A term is
  kept only if it lowers **both** out-of-sample scores — leave-one-out and
  walk-forward for value, 10-fold cross-validation and walk-forward for
  odds. The full search table, kept and rejected alike, is printed on the
  dashboard's evidence rail.
- **Integrity by recompute.** The dashboard embeds the snapshot and the
  same model code (`lib/model.js`, copied to `dashboard/model.js`), rebuilds
  the board in the browser, and prints the checksum beside board.json's.

## Run it

```
mkdir -p /input /output   # or point --input / MAKEFUN_OUTPUT_DIR elsewhere
node main.ts              # reads /input/snapshot.json, writes /output
```

Node 22.18+, standard library only. The program runs twice and writes the
same bytes: `board.json`, `dashboard/` (with the generated
`zz-snapshot-data.js`), `screenshots/`, and `dossier.json` built with the
kit's `vendor/makefun-board.ts`.

## Layout

- `main.ts` — entrypoint: analysis, outputs, dossier.
- `lib/model.js` — the whole model: data prep, both fits, the admission
  search, farm economics, the board. Written once, used by Node and the page.
- `dashboard/` — the page: board, evidence rail, per-protocol detail,
  filters, sorting, CSV/JSON export, basket builder.
- `screenshots/` — the board, a protocol detail view, a filtered view.
