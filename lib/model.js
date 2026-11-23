/* Token Radar model: one file, two homes.
   main.ts imports it under Node; the dashboard loads the identical copy in
   the browser and recomputes the whole board from the sealed snapshot, so
   the page can prove its board.json is the one this code writes. */
(function (root) {
'use strict';

/* ---------------- numeric helpers (all deterministic) ---------------- */
function mean(a) { let s = 0; for (const v of a) s += v; return a.length ? s / a.length : 0; }
function median(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(a, q) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i);
  return lo + 1 < s.length ? s[lo] + (s[lo + 1] - s[lo]) * (i - lo) : s[lo];
}
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function solveLin(A, b) { /* Gaussian elimination, partial pivoting, copies A */
  const n = b.length, M = A.map((r, i) => r.concat(b[i]));
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) M[piv][c] = 1e-12;
    const t = M[c]; M[c] = M[piv]; M[piv] = t;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / M[i][i]);
}
function ols(X, y, pen) { /* ridge-penalised least squares via normal equations */
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const xi = X[i], yi = y[i];
    for (let a = 0; a < p; a++) {
      if (xi[a] === 0) continue;
      b[a] += xi[a] * yi;
      for (let c = 0; c < p; c++) A[a][c] += xi[a] * xi[c];
    }
  }
  for (let a = 0; a < p; a++) A[a][a] += (pen ? pen[a] : 0) + 1e-9;
  return solveLin(A, b);
}
function fnv1a(str) { /* board checksum: FNV-1a 32-bit, 8 hex chars */
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('0000000' + h.toString(16)).slice(-8);
}

/* ---------------- snapshot preparation ---------------- */
const DAY_MS = 86400000;
function dayNum(s) { const p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY_MS; }
function recordsToken(p) { return p.gecko_id != null || p.symbol != null; }
function catKey(p) { return p.category == null ? 'Uncategorised' : p.category; }

const EXCHANGE_PREFIX = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;
/* Why a pre-token protocol is not ranked: the house's own watchlist rule. */
function exclusionClass(p) {
  const c = p.category;
  if (c === 'Bridge' || c === 'Canonical Bridge') return 'bridge';
  if (c === 'Liquid Staking' || c === 'Liquid Restaking' || c === 'Restaked BTC') return 'liqstake';
  if (c === 'CEX' || EXCHANGE_PREFIX.some(e => p.name.indexOf(e) === 0)) return 'exchange';
  if (VERSION_RE.test(p.name)) return 'versioned';
  if (WRAPPED_RE.test(p.name)) return 'wrappedname';
  return null;
}
const EXCLUSION_LABEL = {
  bridge: 'Bridge products', liqstake: 'Liquid staking / restaking',
  exchange: 'Exchange products', versioned: 'Versioned successors',
  wrappedname: 'Wrapped / staked by name'
};

function prepare(snapshot) {
  const asOf = dayNum(snapshot.as_of);
  const protocols = snapshot.protocols.map(p => ({
    slug: p.slug, name: p.name, category: p.category, chains: p.chains,
    tvl: p.tvl_usd, change7d: p.change_7d, mcap: p.mcap_usd,
    listedDays: p.listed_at == null ? null : dayNum(p.listed_at),
    ageYears: p.listed_at == null ? null : (asOf - dayNum(p.listed_at)) / 365.25,
    token: recordsToken(p)
  }));
  const bySlug = {};
  protocols.forEach(p => { bySlug[p.slug] = p; });
  return { asOf: snapshot.as_of, floor: snapshot.floor_usd, protocols, bySlug,
           watchlist: snapshot.watchlist.slice(), watchSet: new Set(snapshot.watchlist) };
}

/* ---------------- farm economics ----------------
   Stated assumptions, printed on the page: a launch gives 5% of the implied
   value to farmers; competing farm capital is 8% of TVL; a plan earns the
   share of the farmer pool its capital is of all farm capital. */
const FARM_SHARE = 0.05, COMPETE_FRAC = 0.08;
const SCENARIOS = [
  { id: 'tvl', label: '0.02% of TVL', frac: 0.0002 },
  { id: 'f1k', label: '$1,000 flat', flat: 1000 },
  { id: 'f5k', label: '$5,000 flat', flat: 5000 },
  { id: 'f25k', label: '$25,000 flat', flat: 25000 }
];
function planSize(p, scenario, override) {
  if (override != null) return Math.round(override);
  return scenario.flat != null ? scenario.flat : Math.max(50, Math.round(p.tvl * scenario.frac));
}
function farmFamily(p) {
  const c = p.category || '';
  if (c === 'Lending' || c === 'CDP') return 'lending';
  if (c === 'Dexs') return 'dex';
  if (c === 'Derivatives') return 'derivatives';
  if (c === 'RWA') return 'rwa';
  if (c === 'Staking Pool' || c === 'Restaking') return 'staking';
  return 'yield';
}
const FAMILY_VERBS = {
  lending: ['Supply the plan as collateral in the main lending market', 'Borrow stablecoins against it at a conservative ratio and re-supply them', 'Vote in governance and claim every supply-side incentive on schedule'],
  dex: ['Seed the plan into the deepest core pair as liquidity', 'Route a steady share of your own swaps through your position to build volume history', 'Claim fee and incentive rewards weekly and re-add them to the position'],
  derivatives: ['Post the plan as margin collateral on the main venue', 'Trade small, hedged size on a fixed weekly schedule to build a volume record', 'Keep utilisation low and claim every fee rebate the venue publishes'],
  rwa: ['Deposit the plan into the flagship real-world-asset vault', 'Hold the vault share through each reporting cycle without redeeming early', 'Complete every accreditation and attestation step the issuer opens to depositors'],
  staking: ['Stake the plan with two reputable validators or pools', 'Restake the receipt into the protocol\'s own points program if it opens one', 'Compound rewards monthly and keep the stake unbonded only when a launch is announced'],
  yield: ['Deposit the plan into the flagship vault or pool', 'Rotate a small share through the protocol\'s newer pools as they open, keeping the core in place', 'Claim and compound every reward the vault pays, on a fixed weekly schedule']
};
function farmSteps(p, plan, months) {
  const v = FAMILY_VERBS[farmFamily(p)], chain = p.chains[0] || 'its main chain';
  const season = Math.min(months, 10);
  const c1 = 6 + plan * 0.0004, c2 = 4 + plan * 0.001, c3 = 4 + plan * 0.001,
        c4 = plan * 0.0015, c5 = 12 + plan * 0.0002, c6 = 2, c7 = plan * 0.001;
  const h5 = Math.round(0.35 * season * 10) / 10;
  const steps = [
    'Fund a fresh wallet and bridge the $' + plan.toLocaleString('en-US') + ' plan to ' + chain + ', the chain where ' + p.name + ' holds most of its TVL. About $' + c1.toFixed(0) + ' in bridge and gas fees, 0.5 h.',
    v[0] + '. About $' + c2.toFixed(0) + ' in swap and gas fees, 1 h.',
    v[1] + '. About $' + c3.toFixed(0) + ' in fees, 1.5 h spread over the first week.',
    'Work the public activity record: regular small transactions, governance votes and any points program ' + p.name + ' runs, on a weekly rhythm. About $' + c4.toFixed(0) + ' in fees across the season, 2 h in total.',
    'Hold the position for the season (about ' + season + ' months at the peers\' median wait) and rebalance monthly; do not chase short-lived bonus pools. About $' + c5.toFixed(0) + ' in gas, ' + h5 + ' h in total.',
    v[2] + '. About $' + c6.toFixed(0) + ' in gas, 1 h.',
    'On any launch announcement, unwind within a week and record the realised cost basis. About $' + c7.toFixed(0) + ' in exit fees, 0.75 h.'
  ];
  const costs = [c1, c2, c3, c4, c5, c6, c7], hours = [0.5, 1, 1.5, 2, h5, 1, 0.75];
  return { steps, cost: costs.reduce((a, b) => a + b, 0), hours: hours.reduce((a, b) => a + b, 0) };
}
function farmFor(p, implied, scenario, months, override) {
  const plan = planSize(p, scenario, override);
  const gross = implied * FARM_SHARE * (plan / (plan + COMPETE_FRAC * p.tvl));
  const f = farmSteps(p, plan, months);
  const net = gross - f.cost, perHour = net / f.hours;
  const verdict = net >= 75 && perHour >= 25 ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  return { plan, gross, cost: f.cost, hours: f.hours, net, perHour, verdict, steps: f.steps };
}
/* Months-to-token: among dated peers that launched and have been listed at
   least as long as this protocol, the median listing age; the estimate is
   the gap to this protocol's own age. Same-category peers when there are 5+. */
function monthsToToken(p, launched, medAgeYears) {
  const aM = (p.ageYears == null ? medAgeYears : p.ageYears) * 12;
  let pool = launched.filter(q => q.ageYears * 12 >= aM - 1e-9);
  const sameCat = pool.filter(q => q.category === p.category);
  if (sameCat.length >= 5) pool = sameCat;
  if (!pool.length) return 12;
  return clamp(Math.round(median(pool.map(q => q.ageYears * 12)) - aM), 1, 60);
}

/* ---------------- the value model ----------------
   Response: ln(market cap / TVL) of the traded peers (mcap >= $5M).
   Base fit: a log-TVL size curve plus category effects shrunk toward the
   whole-field mean (k = 6). A term is admitted only if it lowers BOTH the
   leave-one-out miss and the walk-forward miss; the search tries singles,
   then pairs, then single additions on top of what was admitted. */
const VALUE_CANDIDATES = [
  { id: 'size2', label: 'size curve, squared' },
  { id: 'size3', label: 'size curve, cubed' },
  { id: 'growth', label: '7-day growth, clipped' },
  { id: 'age', label: 'no-token age' },
  { id: 'ageB', label: 'age buckets' },
  { id: 'chains', label: 'chain count' },
  { id: 'sizeGrowth', label: 'size x growth' },
  { id: 'sizeAge', label: 'size x age' }
];
function valueCtx(rows) {
  const medAge = median(rows.map(r => r.ageYears).filter(v => v != null));
  const ages = rows.map(r => r.ageYears == null ? medAge : r.ageYears);
  return {
    meanLnTvl: mean(rows.map(r => Math.log(r.tvl))),
    medAge, meanAge: mean(ages),
    medGrowth: median(rows.map(r => r.change7d).filter(v => v != null))
  };
}
function valueFeatures(p, ctx) {
  const s = Math.log(p.tvl) - ctx.meanLnTvl;
  const g = clamp(p.change7d == null ? ctx.medGrowth : p.change7d, -30, 30) / 30;
  const a = p.ageYears == null ? ctx.medAge : p.ageYears, az = a - ctx.meanAge;
  return {
    size: s, size2: s * s, size3: s * s * s, growth: g, age: az,
    ageB1: a >= 1 && a < 3 ? 1 : 0, ageB2: a >= 3 && a < 6 ? 1 : 0, ageB3: a >= 6 ? 1 : 0,
    chains: p.chains.length / 3, sizeGrowth: s * g, sizeAge: s * az
  };
}
function valueCols(termIds) {
  const cols = ['const', 'size'];
  termIds.forEach(t => { if (t === 'ageB') cols.push('ageB1', 'ageB2', 'ageB3'); else cols.push(t); });
  return cols;
}
function shrunkCatEffects(rows, resid, k) {
  const sums = {}, ns = {};
  rows.forEach((r, i) => { const c = catKey(r); sums[c] = (sums[c] || 0) + resid[i]; ns[c] = (ns[c] || 0) + 1; });
  const eff = {};
  Object.keys(sums).forEach(c => { eff[c] = (ns[c] / (ns[c] + k)) * (sums[c] / ns[c]); });
  return eff;
}
function fitValue(rows, termIds) {
  const ctx = valueCtx(rows), cols = valueCols(termIds);
  const X = rows.map(r => { const f = valueFeatures(r, ctx); return cols.map(c => c === 'const' ? 1 : f[c]); });
  const y = rows.map(r => Math.log(r.mcap / r.tvl));
  let catEff = {}, beta = null;
  for (let it = 0; it < 3; it++) {
    beta = ols(X, y.map((v, i) => v - (catEff[catKey(rows[i])] || 0)), null);
    catEff = shrunkCatEffects(rows, y.map((v, i) => v - dot(X[i], beta)), 6);
  }
  const model = { beta, cols, catEff, ctx, termIds: termIds.slice() };
  model.predict = function (p) {
    const f = valueFeatures(p, ctx);
    return dot(cols.map(c => c === 'const' ? 1 : f[c]), beta) + (catEff[catKey(p)] || 0);
  };
  model.resid = rows.map((r, i) => y[i] - model.predict(r));
  return model;
}
function foldMiss(errs) { return Math.exp(mean(errs)); }
function evalValue(peers, termIds) { /* termIds null = flat median multiple */
  const yOf = p => Math.log(p.mcap / p.tvl);
  const errs = [];
  for (let i = 0; i < peers.length; i++) {
    const tr = peers.filter((_, j) => j !== i);
    const pred = termIds === null ? median(tr.map(yOf)) : fitValue(tr, termIds).predict(peers[i]);
    errs.push(Math.abs(pred - yOf(peers[i])));
  }
  const dp = peers.filter(p => p.listedDays != null)
                  .sort((a, b) => a.listedDays - b.listedDays || (a.slug < b.slug ? -1 : 1));
  const n = dp.length, bounds = [Math.floor(n * 0.4), Math.floor(n * 0.6), Math.floor(n * 0.8), n];
  const werrs = [];
  for (let k = 0; k < 3; k++) {
    const tr = dp.slice(0, bounds[k]), te = dp.slice(bounds[k], bounds[k + 1]);
    const m = termIds === null ? null : fitValue(tr, termIds);
    const med = termIds === null ? median(tr.map(yOf)) : 0;
    te.forEach(p => werrs.push(Math.abs((termIds === null ? med : m.predict(p)) - yOf(p))));
  }
  return { m1: foldMiss(errs), m2: foldMiss(werrs) };
}

/* ---------------- the odds model ----------------
   Logistic fit on the dated protocols; the outcome is "records a token by
   the snapshot date" (327 of 645, base rate 0.507). Base fit: a log-age
   curve. Same admission rule, scored by 10-fold cross-validated Brier and
   walk-forward Brier. Category effects enter as ridge-shrunk dummies. */
const ODDS_CANDIDATES = [
  { id: 'size', label: 'log TVL' },
  { id: 'size2', label: 'log TVL, squared' },
  { id: 'age2', label: 'age curve, squared' },
  { id: 'ageB', label: 'age buckets' },
  { id: 'growth', label: '7-day growth, clipped' },
  { id: 'chains', label: 'chain count' },
  { id: 'ageSize', label: 'age x size' },
  { id: 'catFX', label: 'category effects (shrunk)' }
];
function oddsCtx(rows) {
  const medAge = median(rows.map(r => r.ageYears).filter(v => v != null));
  const curves = rows.map(r => Math.log(1 + (r.ageYears == null ? medAge : r.ageYears)));
  return {
    meanLnTvl: mean(rows.map(r => Math.log(r.tvl))), medAge,
    meanAgeCurve: mean(curves),
    medGrowth: median(rows.map(r => r.change7d).filter(v => v != null))
  };
}
function oddsFeatures(p, ctx) {
  const a = p.ageYears == null ? ctx.medAge : p.ageYears;
  const ac = Math.log(1 + a) - ctx.meanAgeCurve, s = Math.log(p.tvl) - ctx.meanLnTvl;
  const g = clamp(p.change7d == null ? ctx.medGrowth : p.change7d, -30, 30) / 30;
  return {
    ageCurve: ac, size: s, size2: s * s, age2: ac * ac, growth: g,
    chains: p.chains.length / 3, ageSize: ac * s,
    ageB1: a >= 0.5 && a < 1 ? 1 : 0, ageB2: a >= 1 && a < 2 ? 1 : 0,
    ageB3: a >= 2 && a < 3 ? 1 : 0, ageB4: a >= 3 && a < 5 ? 1 : 0, ageB5: a >= 5 ? 1 : 0
  };
}
function fitLogit(rows, termIds) {
  const ctx = oddsCtx(rows);
  const cats = termIds.indexOf('catFX') >= 0
    ? Object.keys(rows.reduce((m, r) => { m[catKey(r)] = (m[catKey(r)] || 0) + 1; return m; }, {}))
        .filter(c => rows.filter(r => catKey(r) === c).length >= 8).sort()
    : [];
  const cols = ['const', 'ageCurve'];
  termIds.forEach(t => {
    if (t === 'ageB') cols.push('ageB1', 'ageB2', 'ageB3', 'ageB4', 'ageB5');
    else if (t !== 'catFX') cols.push(t);
  });
  cats.forEach(c => cols.push('cat:' + c));
  const pen = cols.map(c => c === 'const' ? 0 : c.indexOf('cat:') === 0 ? 6 : 1e-4);
  const X = rows.map(r => {
    const f = oddsFeatures(r, ctx);
    return cols.map(c => c === 'const' ? 1 : c.indexOf('cat:') === 0 ? (catKey(r) === c.slice(4) ? 1 : 0) : f[c]);
  });
  const y = rows.map(r => r.token ? 1 : 0);
  let beta = new Array(cols.length).fill(0);
  for (let it = 0; it < 20; it++) {
    const A = Array.from({ length: cols.length }, () => new Array(cols.length).fill(0));
    const b = new Array(cols.length).fill(0);
    let dev = 0;
    for (let i = 0; i < rows.length; i++) {
      const eta = dot(X[i], beta), pr = 1 / (1 + Math.exp(-clamp(eta, -30, 30)));
      const w = Math.max(pr * (1 - pr), 1e-6), z = eta + (y[i] - pr) / w;
      dev += y[i] ? -Math.log(Math.max(pr, 1e-12)) : -Math.log(Math.max(1 - pr, 1e-12));
      for (let a = 0; a < cols.length; a++) {
        if (X[i][a] === 0) continue;
        b[a] += X[i][a] * w * z;
        for (let c = 0; c < cols.length; c++) A[a][c] += X[i][a] * w * X[i][c];
      }
    }
    for (let a = 0; a < cols.length; a++) A[a][a] += pen[a] + 1e-9;
    const next = solveLin(A, b);
    const shift = Math.max.apply(null, next.map((v, i) => Math.abs(v - beta[i])));
    beta = next;
    if (it > 3 && shift < 1e-7) break;
  }
  const model = { beta, cols, ctx, termIds: termIds.slice() };
  model.predict = function (p) {
    const f = oddsFeatures(p, ctx);
    const eta = dot(cols.map(c => c === 'const' ? 1 : c.indexOf('cat:') === 0 ? (catKey(p) === c.slice(4) ? 1 : 0) : f[c]), beta);
    return clamp(1 / (1 + Math.exp(-clamp(eta, -30, 30))), 0.02, 0.98);
  };
  return model;
}
function evalOdds(rows, termIds) { /* termIds null = constant base rate */
  const brier = (preds, ys) => mean(preds.map((p, i) => (p - ys[i]) * (p - ys[i])));
  const cvPred = new Array(rows.length);
  for (let f = 0; f < 10; f++) {
    const tr = rows.filter((_, i) => i % 10 !== f), te = rows.filter((_, i) => i % 10 === f);
    const m = termIds === null ? null : fitLogit(tr, termIds);
    const rate = mean(tr.map(r => r.token ? 1 : 0));
    te.forEach(r => { cvPred[rows.indexOf(r)] = termIds === null ? rate : m.predict(r); });
  }
  const dp = rows.slice().sort((a, b) => a.listedDays - b.listedDays || (a.slug < b.slug ? -1 : 1));
  const n = dp.length, bounds = [Math.floor(n * 0.4), Math.floor(n * 0.6), Math.floor(n * 0.8), n];
  const wp = [], wy = [];
  for (let k = 0; k < 3; k++) {
    const tr = dp.slice(0, bounds[k]), te = dp.slice(bounds[k], bounds[k + 1]);
    const m = termIds === null ? null : fitLogit(tr, termIds);
    const rate = mean(tr.map(r => r.token ? 1 : 0));
    te.forEach(p => { wp.push(termIds === null ? rate : m.predict(p)); wy.push(p.token ? 1 : 0); });
  }
  return { m1: brier(cvPred, rows.map(r => r.token ? 1 : 0)), m2: brier(wp, wy) };
}

/* ---------------- the admission search ----------------
   Tries the base fit, every single, every pair, then single additions on
   top of the admitted set. A candidate is admitted only when it lowers
   BOTH metrics; among those that pass, the lowest product of the two
   metrics wins. Every trial is kept for the evidence rail. */
function runSearch(evalFn, candIds) {
  const base = evalFn([]);
  const singles = candIds.map(id => ({ add: [id], r: evalFn([id]) }));
  const pairs = [];
  for (let i = 0; i < candIds.length; i++)
    for (let j = i + 1; j < candIds.length; j++)
      pairs.push({ add: [candIds[i], candIds[j]], r: evalFn([candIds[i], candIds[j]]) });
  let champTerms = [], champ = base;
  const adds = [];
  const round1 = singles.concat(pairs).filter(t => t.r.m1 < champ.m1 && t.r.m2 < champ.m2);
  if (round1.length) {
    round1.sort((x, y) => x.r.m1 * x.r.m2 - y.r.m1 * y.r.m2);
    champTerms = round1[0].add.slice(); champ = round1[0].r;
    adds.push({ onTopOf: 'base fit', add: round1[0].add.slice(), r: champ, kept: true });
  }
  for (let round = 0; round < 2; round++) {
    const rest = candIds.filter(id => champTerms.indexOf(id) < 0);
    if (!rest.length) break;
    const trials = rest.map(id => ({ add: [id], r: evalFn(champTerms.concat([id])) }));
    const pass = trials.filter(t => t.r.m1 < champ.m1 && t.r.m2 < champ.m2);
    trials.forEach(t => adds.push({ onTopOf: champTerms.join(' + ') || 'base fit', add: t.add.slice(), r: t.r, kept: false }));
    if (!pass.length) break;
    pass.sort((x, y) => x.r.m1 * x.r.m2 - y.r.m1 * y.r.m2);
    const win = adds.filter(t => t.add[0] === pass[0].add[0] && t.onTopOf === (champTerms.join(' + ') || 'base fit'))[0];
    if (win) win.kept = true;
    champTerms = champTerms.concat(pass[0].add); champ = pass[0].r;
  }
  const admittedKey = adds.filter(a => a.kept && a.onTopOf === 'base fit').map(a => a.add.slice().sort().join('+'))[0];
  singles.concat(pairs).forEach(t => { t.kept = admittedKey != null && t.add.slice().sort().join('+') === admittedKey; });
  return { base, singles, pairs, adds, finalTerms: champTerms, final: champ };
}

/* ---------------- the whole analysis ---------------- */
function analyze(snapshot) {
  const S = prepare(snapshot);
  const peers = S.protocols.filter(p => p.mcap != null && p.mcap >= 5000000);
  const dated = S.protocols.filter(p => p.listedDays != null);
  const launched = dated.filter(p => p.token);
  const medAgeDated = median(dated.map(p => p.ageYears));

  const flatV = evalValue(peers, null);
  const vSearch = runSearch(t => evalValue(peers, t), VALUE_CANDIDATES.map(c => c.id));
  const vModel = fitValue(peers, vSearch.finalTerms);
  const vFinal = vSearch.final;

  const baseO = evalOdds(dated, null);
  const oSearch = runSearch(t => evalOdds(dated, t), ODDS_CANDIDATES.map(c => c.id));
  const oModel = fitLogit(dated, oSearch.finalTerms);
  const oFinal = oSearch.final;

  /* range honesty: the bands are quantiles of the final value model's
     leave-one-out residuals (the honest spread for pricing a protocol the
     model has never seen). Coverage is cross-fitted, never tautological:
     each half of the peers is scored against bands drawn from the other
     half's out-of-fold residuals. Board rows use all peers' residuals. */
  const looResid = peers.map((p, i) => {
    const tr = peers.filter((_, j) => j !== i);
    return Math.log(p.mcap / p.tvl) - fitValue(tr, vSearch.finalTerms).predict(p);
  });
  const q = { q10: quantile(looResid, 0.10), q25: quantile(looResid, 0.25),
              q75: quantile(looResid, 0.75), q90: quantile(looResid, 0.90) };
  let in75 = 0, in90 = 0;
  [[0, 1], [1, 0]].forEach(([half, other]) => {
    const src = looResid.filter((_, i) => i % 2 === other);
    const b = { q10: quantile(src, 0.10), q25: quantile(src, 0.25),
                q75: quantile(src, 0.75), q90: quantile(src, 0.90) };
    looResid.forEach((r, i) => {
      if (i % 2 !== half) return;
      if (r >= b.q25 && r <= b.q75) in75++;
      if (r >= b.q10 && r <= b.q90) in90++;
    });
  });

  /* odds calibration on the final model's out-of-fold predictions */
  const cvPred = new Array(dated.length);
  for (let f = 0; f < 10; f++) {
    const tr = dated.filter((_, i) => i % 10 !== f), m = fitLogit(tr, oSearch.finalTerms);
    dated.forEach((r, i) => { if (i % 10 === f) cvPred[i] = m.predict(r); });
  }
  const BANDS = [[0, 0.5], [0.5, 1], [1, 2], [2, 3], [3, 5], [5, 1e9]];
  const calibration = BANDS.map(([lo, hi]) => {
    const idx = dated.map((r, i) => i).filter(i => dated[i].ageYears >= lo && dated[i].ageYears < hi);
    return { band: hi > 100 ? lo + '+y' : lo + '-' + hi + 'y', n: idx.length,
             pred: idx.length ? mean(idx.map(i => cvPred[i])) : 0,
             actual: idx.length ? mean(idx.map(i => dated[i].token ? 1 : 0)) : 0 };
  }).filter(b => b.n > 0);

  /* the board: every pre-token protocol the watchlist rule leaves eligible */
  const accounting = { ranked: 0, token: 0, bridge: 0, liqstake: 0, exchange: 0, versioned: 0, wrappedname: 0 };
  S.protocols.forEach(p => { if (p.token) accounting.token++; });
  const rows = [];
  S.protocols.forEach(p => {
    if (p.token) return;
    const ex = exclusionClass(p);
    if (ex) { accounting[ex]++; return; }
    const mult = Math.exp(vModel.predict(p)), odds = oModel.predict(p);
    const implied = Math.max(1, Math.round(p.tvl * mult * odds));
    const months = monthsToToken(p, launched, medAgeDated);
    const farm = farmFor(p, implied, SCENARIOS[0], months);
    rows.push({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl: p.tvl,
      change7d: p.change7d, ageYears: p.ageYears, watch: S.watchSet.has(p.slug),
      mult, odds, implied,
      lo75: Math.round(p.tvl * Math.exp(vModel.predict(p) + q.q25) * odds),
      hi75: Math.round(p.tvl * Math.exp(vModel.predict(p) + q.q75) * odds),
      months, plan: farm.plan, net: farm.net, perHour: farm.perHour,
      hours: farm.hours, cost: farm.cost, verdict: farm.verdict, steps: farm.steps
    });
  });
  rows.sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  accounting.ranked = rows.length;
  const checksum = fnv1a(rows.map(r => r.slug + ':' + r.rank + ':' + r.implied).join('|'));
  const verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  rows.forEach(r => { verdicts[r.verdict]++; });

  return {
    asOf: S.asOf, floor: S.floor, nProtocols: S.protocols.length,
    nPeers: peers.length, nDated: dated.length,
    baseRate: mean(dated.map(p => p.token ? 1 : 0)),
    watchlist: S.watchlist, accounting, rows, checksum, verdicts,
    totalImplied: rows.reduce((a, r) => a + r.implied, 0),
    quantiles: q,
    stats: {
      flatLoo: flatV.m1, flatWf: flatV.m2, loo: vFinal.m1, wf: vFinal.m2,
      brierBaseCv: baseO.m1, brierBaseWf: baseO.m2, brierCv: oFinal.m1, brierWf: oFinal.m2,
      range75: in75 / peers.length, range90: in90 / peers.length
    },
    valueSearch: vSearch, oddsSearch: oSearch,
    valueTerms: vSearch.finalTerms, oddsTerms: oSearch.finalTerms,
    calibration,
    peers: peers.map(p => ({ slug: p.slug, name: p.name, category: p.category, tvl: p.tvl, mcap: p.mcap }))
  };
}

const api = { analyze, prepare, farmFor, SCENARIOS, FARM_SHARE, COMPETE_FRAC,
              VALUE_CANDIDATES, ODDS_CANDIDATES, EXCLUSION_LABEL, recordsToken };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.TokenModel = api;
})(typeof self !== 'undefined' ? self : globalThis);
