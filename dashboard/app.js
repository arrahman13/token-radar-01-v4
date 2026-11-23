/* Token Radar dashboard. Paints from the data file main.ts wrote beside
   this page, then recomputes the whole board from the sealed snapshot with
   the same model code and checks the checksum against board.json's. */
(function () {
'use strict';
var D = window.RADAR_DATA, M = window.TokenModel;
var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function money(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
}
function miss(v) { return 'x' + v.toFixed(2); }
function pct(v, dp) { return (v * 100).toFixed(dp == null ? 0 : dp) + '%'; }

/* rebuild the snapshot object the model expects from the compact data */
var snap = { as_of: D.snap.as_of, floor_usd: D.snap.floor_usd, watchlist: D.snap.watchlist,
  protocols: D.snap.protocols.map(function (a) {
    return { slug: a[0], name: a[1], category: a[2], chains: a[3], tvl_usd: a[4],
             change_7d: a[5], mcap_usd: a[6], listed_at: a[7], gecko_id: a[8], symbol: a[9] };
  }) };
var S = M.prepare(snap);
var scenario = M.SCENARIOS[0];
var state = { q: '', cat: '', chain: '', tab: 'all', sortK: 'rank', sortD: 1 };

/* ---------- header stats and the 758 ledger ---------- */
$('asOf').textContent = D.asOf;
$('stats').innerHTML = [
  [miss(D.stats.loo), 'Value miss, leave-one-out', 'flat multiple ' + miss(D.stats.flatLoo)],
  [miss(D.stats.wf), 'Value miss, walk-forward', 'flat multiple ' + miss(D.stats.flatWf)],
  [pct(D.stats.range75), 'Range honesty P25-P75', 'stated 50% · P10-P90 ' + pct(D.stats.range90) + ' vs 80%'],
  [D.stats.brierCv.toFixed(3), 'Odds model, 10-fold CV Brier', 'base rate ' + D.baseRate.toFixed(3) + ' · WF ' + D.stats.brierWf.toFixed(3)],
  [D.verdicts.FARM + ' FARM', 'Worth farming at 0.02% plan', 'of ' + D.rows.length + ' ranked protocols'],
  ['40/40', 'Watchlist covered', 'plus ' + (D.rows.length - 40) + ' early finds']
].map(function (c) { return '<div class="stat"><b>' + c[0] + '</b><span>' + c[1] + '</span><small>' + c[2] + '</small></div>'; }).join('');

var ACCT = [['ranked', 'Ranked on this board', '#2dd4bf'], ['token', 'Already record a token', '#c97b2d'],
  ['bridge', 'Bridge products', '#5b7fa6'], ['liqstake', 'Liquid staking / restaking', '#7a6fd0'],
  ['exchange', 'Exchange products', '#a65b7f'], ['versioned', 'Versioned successors', '#6f8f5a'],
  ['wrappedname', 'Wrapped / staked by name', '#8a8f5a']];
$('acctBar').innerHTML = ACCT.map(function (a) {
  return '<i style="background:' + a[2] + ';width:' + (D.accounting[a[0]] / D.nProtocols * 100) + '%"></i>';
}).join('');
$('acctLegend').innerHTML = '<span>Full accounting of the snapshot\'s <b>' + D.nProtocols + '</b> protocols:</span>' +
  ACCT.map(function (a) { return '<span><b>' + D.accounting[a[0]] + '</b> ' + a[1] + '</span>'; }).join('');

/* ---------- controls ---------- */
var cats = {}, chains = {};
D.rows.forEach(function (r) {
  cats[r.category || 'Uncategorised'] = 1;
  r.chains.forEach(function (c) { chains[c] = 1; });
});
$('fCat').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
  return '<option>' + esc(c) + '</option>'; }).join('');
$('fChain').innerHTML = '<option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) {
  return '<option>' + esc(c) + '</option>'; }).join('');
$('fPlan').innerHTML = M.SCENARIOS.map(function (s) { return '<option value="' + s.id + '">' + s.label + '</option>'; }).join('');

function farmOf(r) { return M.farmFor(S.bySlug[r.slug], r.implied, scenario, r.months); }
function visibleRows() {
  var out = D.rows.filter(function (r) {
    if (state.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(state.q) < 0) return false;
    if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
    if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
    if (state.tab === 'watch' && !r.watch) return false;
    if (state.tab === 'early' && r.watch) return false;
    if (state.tab === 'farm' && farmOf(r).verdict !== 'FARM') return false;
    return true;
  });
  var k = state.sortK, d = state.sortD;
  out.sort(function (a, b) {
    var x, y;
    if (k === 'perHour') { x = farmOf(a).perHour; y = farmOf(b).perHour; }
    else if (k === 'verdict') { x = farmOf(a).net; y = farmOf(b).net; }
    else if (k === 'name') { x = a.name; y = b.name; return (x < y ? -1 : x > y ? 1 : 0) * d; }
    else { x = a[k] == null ? -1e18 : a[k]; y = b[k] == null ? -1e18 : b[k]; }
    return (x - y) * d;
  });
  return out;
}
function renderTable() {
  var rows = visibleRows();
  $('countLine').innerHTML = '<b>' + rows.length + '</b> of ' + D.rows.length + ' protocols · plan size ' +
    esc(scenario.label) + ' · total implied on board <b>' + money(D.totalImplied) + '</b>';
  $('tbody').innerHTML = rows.map(function (r) {
    var f = farmOf(r);
    var chg = r.change7d == null ? '—' : '<span class="' + (r.change7d >= 0 ? 'pos' : 'neg') + '">' +
      (r.change7d >= 0 ? '+' : '') + r.change7d.toFixed(1) + '</span>';
    return '<tr data-slug="' + esc(r.slug) + '"><td class="n">' + r.rank + '</td>' +
      '<td><span class="pname">' + esc(r.name) + '</span><span class="ptag ' + (r.watch ? 'w' : 'e') + '">' +
      (r.watch ? 'WATCHLIST' : 'EARLY') + '</span><span class="pcat">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</span></td>' +
      '<td class="n">' + money(r.tvl) + '</td><td class="n">' + chg + '</td>' +
      '<td class="n">' + (r.ageYears == null ? '—' : r.ageYears.toFixed(1) + 'y') + '</td>' +
      '<td class="n"><span class="oddsbar"><i style="width:' + Math.round(r.odds * 100) + '%"></i></span>' + pct(r.odds) + '</td>' +
      '<td class="n nw">&asymp; ' + r.months + ' mo</td>' +
      '<td class="n"><b>' + money(r.implied) + '</b><span class="range">' + money(r.lo75) + ' – ' + money(r.hi75) + '</span></td>' +
      '<td class="n">' + money(f.perHour) + '</td>' +
      '<td><span class="verdict ' + f.verdict + '">' + f.verdict + '</span></td></tr>';
  }).join('');
  var byCat = {}, byChain = {};
  D.rows.forEach(function (r) {
    var c = r.category || 'Uncategorised';
    byCat[c] = byCat[c] || { n: 0, v: 0 }; byCat[c].n++; byCat[c].v += r.implied;
    r.chains.forEach(function (ch) { byChain[ch] = byChain[ch] || { n: 0, v: 0 }; byChain[ch].n++; byChain[ch].v += r.implied; });
  });
  var top = function (o, n) { return Object.keys(o).map(function (k) { return [k, o[k]]; })
    .sort(function (a, b) { return b[1].v - a[1].v; }).slice(0, n); };
  $('rollups').innerHTML = top(byCat, 5).map(function (e) {
      return '<span class="rollup">' + esc(e[0]) + ' · <b>' + e[1].n + '</b> · ' + money(e[1].v) + '</span>'; }).join('') +
    top(byChain, 4).map(function (e) {
      return '<span class="rollup">' + esc(e[0]) + ' · <b>' + e[1].n + '</b> · ' + money(e[1].v) + '</span>'; }).join('');
}
$('q').addEventListener('input', function () { state.q = this.value.toLowerCase(); renderTable(); });
$('fCat').addEventListener('change', function () { state.cat = this.value; renderTable(); });
$('fChain').addEventListener('change', function () { state.chain = this.value; renderTable(); });
$('fPlan').addEventListener('change', function () {
  scenario = M.SCENARIOS.filter(function (s) { return s.id === this.value; }.bind(this))[0] || M.SCENARIOS[0];
  renderTable();
});
Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
  b.addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { x.classList.remove('on'); });
    b.classList.add('on'); state.tab = b.getAttribute('data-tab'); renderTable();
  });
});
Array.prototype.forEach.call(document.querySelectorAll('#board th'), function (th) {
  th.addEventListener('click', function () {
    var k = th.getAttribute('data-k');
    if (state.sortK === k) state.sortD = -state.sortD; else { state.sortK = k; state.sortD = k === 'name' ? 1 : -1; }
    if (k === 'rank') state.sortD = 1;
    renderTable();
  });
});
function download(name, text, type) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name; a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
}
$('expCsv').addEventListener('click', function () {
  var lines = ['rank,slug,name,tvl_usd,launch_odds,implied_value_usd,verdict,expected_net_usd,farm_usd_per_hour'];
  visibleRows().forEach(function (r) { var f = farmOf(r);
    lines.push([r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', r.tvl, r.odds.toFixed(3), r.implied, f.verdict, Math.round(f.net), Math.round(f.perHour)].join(',')); });
  download('token-radar-board.csv', lines.join('\n'), 'text/csv');
});
$('expJson').addEventListener('click', function () {
  download('token-radar-board.json', JSON.stringify(visibleRows(), null, 1), 'application/json');
});
$('tbody').addEventListener('click', function (ev) {
  var tr = ev.target.closest('tr'); if (tr) showDetail(tr.getAttribute('data-slug'));
});

/* ---------- detail view ---------- */
function showDetail(slug) {
  var r = D.rows.filter(function (x) { return x.slug === slug; })[0];
  if (!r) return;
  var f = farmOf(r);
  var peers = D.peers.filter(function (p) { return p.category === r.category; })
    .sort(function (a, b) { return Math.abs(Math.log(a.tvl) - Math.log(r.tvl)) - Math.abs(Math.log(b.tvl) - Math.log(r.tvl)); }).slice(0, 4);
  var scen = M.SCENARIOS.map(function (s) {
    var g = M.farmFor(S.bySlug[r.slug], r.implied, s, r.months);
    return '<tr><td>' + s.label + '</td><td class="n">' + money(g.plan) + '</td><td class="n">' + money(g.net) +
      '</td><td class="n">' + money(g.perHour) + '</td><td><span class="verdict ' + g.verdict + '">' + g.verdict + '</span></td></tr>';
  }).join('');
  $('detail').innerHTML = '<button class="backbtn" id="backBtn">&larr; Back to the board</button>' +
    '<h2>' + esc(r.name) + ' <span class="ptag ' + (r.watch ? 'w' : 'e') + '">' + (r.watch ? 'WATCHLIST' : 'EARLY') + '</span></h2>' +
    '<div class="sub">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
    ' · TVL ' + money(r.tvl) + ' · records no token · listed ' + (r.ageYears == null ? 'date not reported' : r.ageYears.toFixed(1) + ' years ago') + '</div>' +
    '<div class="dgrid">' +
    '<div class="dbox"><h3>Value decomposition</h3><table>' +
    '<tr><td>TVL</td><td class="n">' + money(r.tvl) + '</td></tr>' +
    '<tr><td>Fitted multiple (median)</td><td class="n">x' + r.mult.toFixed(2) + '</td></tr>' +
    '<tr><td>Launch odds from the peers\' record</td><td class="n">' + pct(r.odds, 1) + '</td></tr>' +
    '<tr><td>Implied value</td><td class="n"><b>' + money(r.implied) + '</b></td></tr>' +
    '<tr><td>Middle-half range (P25-P75)</td><td class="n">' + money(r.lo75) + ' – ' + money(r.hi75) + '</td></tr>' +
    '<tr><td>Months to token, peers\' median gap</td><td class="n">&asymp; ' + r.months + '</td></tr></table></div>' +
    '<div class="dbox"><h3>Farm at the default plan (' + esc(M.SCENARIOS[0].label) + ')</h3><table>' +
    '<tr><td>Plan size</td><td class="n">' + money(f.plan) + '</td></tr>' +
    '<tr><td>Expected gross (5% farmer share)</td><td class="n">' + money(f.gross) + '</td></tr>' +
    '<tr><td>Step costs</td><td class="n">' + money(f.cost) + '</td></tr>' +
    '<tr><td>Time</td><td class="n">' + f.hours.toFixed(1) + ' h</td></tr>' +
    '<tr><td>Expected net</td><td class="n"><b>' + money(f.net) + '</b></td></tr>' +
    '<tr><td>Per hour</td><td class="n">' + money(f.perHour) + '</td></tr>' +
    '<tr><td>Verdict</td><td class="n"><span class="verdict ' + f.verdict + '">' + f.verdict + '</span></td></tr></table></div>' +
    '<div class="dbox"><h3>Farm steps, costed</h3><ol>' + r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>' +
    '<div class="dbox"><h3>Every plan size</h3><table><tr><th>Scenario</th><th>Plan</th><th>Net</th><th>$/h</th><th>Verdict</th></tr>' + scen + '</table>' +
    '<h3 style="margin-top:10px">Nearest priced peers, same category</h3><table>' +
    (peers.length ? peers.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td class="n">TVL ' + money(p.tvl) + '</td><td class="n">mcap ' + money(p.mcap) + '</td><td class="n">x' + (p.mcap / p.tvl).toFixed(2) + '</td></tr>'; }).join('') : '<tr><td>No traded peer in this category at $5M+ market cap.</td></tr>') +
    '</table></div></div>';
  $('detail').hidden = false;
  $('boardView').hidden = true;
  $('backBtn').addEventListener('click', function () { $('detail').hidden = true; $('boardView').hidden = false; });
  window.scrollTo(0, 0);
}

/* ---------- the evidence rail ---------- */
function termLabel(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label;
  return id;
}
var SHORT = { size2: 'size²', size3: 'size³', growth: 'growth', age: 'age', ageB: 'age buckets',
  chains: 'chains', sizeGrowth: 'size×growth', sizeAge: 'size×age', size: 'log TVL', age2: 'age²',
  ageSize: 'age×size', catFX: 'category fx' };
function searchBlock(S, cands, fmt, baseLabel, fittedLabel) {
  var h = '<table><tr><th style="text-align:left">Term</th><th>' + baseLabel + '</th><th>' + fittedLabel + '</th><th></th></tr>';
  h += '<tr><td>base fit</td><td class="n">' + fmt(S.base.m1) + '</td><td class="n">' + fmt(S.base.m2) + '</td><td></td></tr>';
  S.singles.forEach(function (t) {
    h += '<tr><td>+ ' + esc(termLabel(cands, t.add[0])) + '</td><td class="n">' + fmt(t.r.m1) + '</td><td class="n">' +
      fmt(t.r.m2) + '</td><td class="' + (t.kept ? 'kept' : 'rej') + '">' + (t.kept ? 'KEPT' : 'rejected') + '</td></tr>';
  });
  h += '</table><div class="pairs">';
  S.pairs.forEach(function (t) {
    h += '<div class="' + (t.kept ? 'kept' : '') + '">' + esc(SHORT[t.add[0]] || t.add[0]) + ' + ' +
      esc(SHORT[t.add[1]] || t.add[1]) + ' · ' + fmt(t.r.m1) + '/' + fmt(t.r.m2) + (t.kept ? ' KEPT' : '') + '</div>';
  });
  h += '</div>';
  S.adds.forEach(function (a) {
    if (a.onTopOf === 'base fit') return;
    h += '<p>On top of ' + esc(a.onTopOf) + ': + ' + esc(termLabel(cands, a.add[0])) + ' → ' + fmt(a.r.m1) + ' / ' +
      fmt(a.r.m2) + ' — <span class="' + (a.kept ? 'kept' : 'rej') + '">' + (a.kept ? 'KEPT' : 'rejected') + '</span></p>';
  });
  return h;
}
function renderRail() {
  var vs = D.valueSearch, os = D.oddsSearch;
  var keptV = vs.finalTerms.map(function (t) { return termLabel(M.VALUE_CANDIDATES, t); }).join(', ') || 'none beyond the base fit';
  var keptO = os.finalTerms.map(function (t) { return termLabel(M.ODDS_CANDIDATES, t); }).join(', ') || 'none beyond the base fit';
  $('rail').innerHTML =
    '<h2>OUT-OF-SAMPLE CHECK</h2>' +
    '<p>Leave-one-out: each peer is priced by a model fitted without it. Walk-forward: fit on peers listed earlier, tested on peers listed later, three expanding windows.</p>' +
    '<p><b style="color:var(--ink)">' + miss(D.stats.flatLoo) + ' → ' + miss(D.stats.loo) + '</b> value miss, leave-one-out &nbsp; <b style="color:var(--ink)">' +
    miss(D.stats.flatWf) + ' → ' + miss(D.stats.wf) + '</b> walk-forward</p>' +
    '<h3>Value model — term by term (' + D.nPeers + ' traded peers)</h3>' +
    '<p>Admitted only if a term lowers BOTH misses. Kept beyond the base fit: <b style="color:var(--ink)">' + esc(keptV) + '</b>.</p>' +
    searchBlock(vs, M.VALUE_CANDIDATES, miss, 'LOO', 'WF') +
    '<p>Range honesty: the middle-half band held <b style="color:var(--ink)">' + pct(D.stats.range75, 1) + '</b> of leave-one-out prices (stated 50%); the P10-P90 band held <b style="color:var(--ink)">' + pct(D.stats.range90, 1) + '</b> (stated 80%).</p>' +
    '<h3>Launch odds — logistic on ' + D.nDated + ' dated protocols</h3>' +
    '<p>Base rate ' + D.baseRate.toFixed(3) + ' (' + Math.round(D.baseRate * D.nDated) + ' of ' + D.nDated + ' record a token). Constant-rate Brier ' +
    D.stats.brierBaseCv.toFixed(3) + ' CV / ' + D.stats.brierBaseWf.toFixed(3) + ' WF → fitted <b style="color:var(--ink)">' +
    D.stats.brierCv.toFixed(3) + ' / ' + D.stats.brierWf.toFixed(3) + '</b>. Kept: <b style="color:var(--ink)">' + esc(keptO) + '</b>.</p>' +
    searchBlock(os, M.ODDS_CANDIDATES, function (v) { return v.toFixed(3); }, 'CV', 'WF') +
    '<h3>Odds calibration — out-of-fold, by age band</h3><table><tr><th style="text-align:left">Band</th><th>n</th><th>Predicted</th><th>Actual</th></tr>' +
    D.calibration.map(function (c) {
      return '<tr><td>' + c.band + '</td><td class="n">' + c.n + '</td><td class="n">' + pct(c.pred) + '</td><td class="n">' + pct(c.actual) + '</td></tr>';
    }).join('') + '</table>' +
    '<p>Undated protocols are priced with the peer-median age and the median growth where unreported; both medians are refit inside every training fold, so no test row leaks into its own price.</p>';
}
renderTable();
renderRail();

/* ---------- basket builder ----------
   Greedy by expected net per hour: walk the board in $/h order, take each
   plan whose full size still fits the remaining capital and whose season
   hours fit the weekly time budget over a 26-week season. A plan is sized
   by its protocol, so an oversized plan is skipped, never shrunk. Only
   plans with positive expected net play. */
function renderBasket() {
  var budget = parseFloat($('bkBudget').value) || 25000;
  var hpw = parseFloat($('bkHours').value) || 5;
  var cands = D.rows.map(function (r) { return { r: r, f: farmOf(r) }; })
    .filter(function (x) { return x.f.net > 0; })
    .sort(function (a, b) { return b.f.perHour - a.f.perHour; });
  var picks = [], capLeft = budget, hrsLeft = hpw;
  cands.forEach(function (x) {
    if (capLeft < 250 || hrsLeft <= 0.05) return;
    var plan = x.f.plan, f = x.f;
    if (plan > capLeft) return;
    var weekly = f.hours / 26;
    if (f.net <= 0 || weekly > hrsLeft) return;
    picks.push({ r: x.r, f: f, weekly: weekly });
    capLeft -= plan; hrsLeft -= weekly;
  });
  var totNet = picks.reduce(function (a, x) { return a + x.f.net; }, 0);
  var totCap = picks.reduce(function (a, x) { return a + x.f.plan; }, 0);
  var totHrs = picks.reduce(function (a, x) { return a + x.weekly; }, 0);
  $('bkOut').innerHTML = picks.length
    ? '<table><tr><th style="text-align:left">Protocol</th><th>Plan</th><th>Expected net</th><th>$/h</th><th>h/week</th></tr>' +
      picks.map(function (x) {
        return '<tr><td>' + esc(x.r.name) + '</td><td class="n">' + money(x.f.plan) + '</td><td class="n">' + money(x.f.net) +
          '</td><td class="n">' + money(x.f.perHour) + '</td><td class="n">' + x.weekly.toFixed(2) + '</td></tr>';
      }).join('') +
      '<tr><td><b>' + picks.length + ' plans</b></td><td class="n"><b>' + money(totCap) + '</b></td><td class="n"><b>' +
      money(totNet) + '</b></td><td class="n"></td><td class="n"><b>' + totHrs.toFixed(1) + '</b></td></tr></table>'
    : '<p style="color:var(--dim);font-size:11px;margin:6px 0 0">No positive-net plan fits that budget and time.</p>';
}
$('basketSlot').innerHTML = '<div class="basket"><h3>Basket builder — best expected net per hour, fitted to your capital and week</h3>' +
  '<label>Budget $<input id="bkBudget" type="number" value="25000" min="250" step="250"></label>' +
  '<label>Hours / week<input id="bkHours" type="number" value="5" min="0.5" step="0.5"></label>' +
  '<button id="bkGo">Build basket</button><div id="bkOut"></div></div>';
$('bkGo').addEventListener('click', renderBasket);
renderBasket();

/* ---------- view presets for the judged screenshots ---------- */
var params = new URLSearchParams(location.search);
if (params.get('view') === 'filtered') {
  state.cat = params.get('cat') || 'Lending';
  $('fCat').value = state.cat;
  if (params.get('tab')) {
    state.tab = params.get('tab');
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) {
      x.classList.toggle('on', x.getAttribute('data-tab') === state.tab);
    });
  }
  renderTable();
}
if (params.get('view') === 'detail') {
  var top = D.rows.filter(function (r) { return r.watch; })[0] || D.rows[0];
  showDetail(top.slug);
}

/* ---------- integrity: recompute the board from the snapshot ---------- */
setTimeout(function () {
  try {
    var A = M.analyze(snap);
    var ok = A.checksum === D.checksum;
    $('integrity').textContent = (ok ? 'integrity ✓ recomputed board matches board.json' : 'integrity ✗ recomputed ' + A.checksum + ' vs board ' + D.checksum) +
      '\nchecksum ' + D.checksum + ' · watchlist ' + A.rows.filter(function (r) { return r.watch; }).length + '/40 · ledger ' + D.nProtocols + '/' + D.nProtocols;
  } catch (e) {
    $('integrity').textContent = 'integrity: recompute failed in this browser (' + e.message + ')';
  }
}, 40);
})();
