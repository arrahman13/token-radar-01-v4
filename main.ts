// Token Radar: reads the sealed snapshot, fits the value and odds models,
// ranks every eligible pre-token protocol, and writes the board, the
// dashboard and the dossier the judge reads.
import { readFileSync, writeFileSync, cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore - plain-JS module, the same file the dashboard loads
import model from './lib/model.js';
import { buildDossier } from './vendor/makefun-board.ts';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const inIdx = args.indexOf('--input');
const inputPath = inIdx >= 0 ? args[inIdx + 1] : '/input/snapshot.json';
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const snapshot = JSON.parse(readFileSync(inputPath, 'utf8'));
const A = model.analyze(snapshot);

mkdirSync(outDir, { recursive: true });

// The ranked board.
const board = {
  rows: A.rows.map((r: any) => ({
    slug: r.slug, name: r.name, rank: r.rank,
    implied_value_usd: r.implied, farm_steps: r.steps,
    tvl_usd: r.tvl, launch_odds: Math.round(r.odds * 10000) / 10000, verdict: r.verdict
  }))
};
writeFileSync(join(outDir, 'board.json'), JSON.stringify(board));

// The dashboard, its screenshots, and the data file the page recomputes from.
cpSync(join(here, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
cpSync(join(here, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
const compact = snapshot.protocols.map((p: any) => [
  p.slug, p.name, p.category, p.chains, p.tvl_usd, p.change_7d,
  p.mcap_usd, p.listed_at, p.gecko_id, p.symbol
]);
const data = {
  asOf: A.asOf, floor: A.floor, checksum: A.checksum,
  nProtocols: A.nProtocols, nPeers: A.nPeers, nDated: A.nDated, baseRate: A.baseRate,
  stats: A.stats, accounting: A.accounting, verdicts: A.verdicts,
  totalImplied: A.totalImplied, quantiles: A.quantiles,
  valueTerms: A.valueTerms, oddsTerms: A.oddsTerms,
  valueSearch: A.valueSearch, oddsSearch: A.oddsSearch, calibration: A.calibration,
  rows: A.rows, peers: A.peers,
  snap: { as_of: snapshot.as_of, floor_usd: snapshot.floor_usd, watchlist: snapshot.watchlist, protocols: compact }
};
writeFileSync(join(outDir, 'dashboard', 'zz-snapshot-data.js'),
  'window.RADAR_DATA = ' + JSON.stringify(data) + ';\n');

// The dossier, byte for byte what the kit library writes.
const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
writeFileSync(join(outDir, 'dossier.json'), dossier);

console.log('token-radar: ' + A.rows.length + ' rows, checksum ' + A.checksum +
  ', value miss LOO x' + A.stats.loo.toFixed(2) + ' / WF x' + A.stats.wf.toFixed(2) +
  ', odds Brier ' + A.stats.brierCv.toFixed(3) + ' / ' + A.stats.brierWf.toFixed(3));
