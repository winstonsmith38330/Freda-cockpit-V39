import { round2 } from '../utils/safe.js';

const OPS_STORES = ['Beverly Hills', 'Penrith', 'Taren Point'];

export function buildBriefing(live = {}, analysis = {}, production = {}) {
  const date = live.reportingDate || analysis.reportingDate;
  const red = (analysis.storeStatus || []).filter(s => s.status === 'Red');
  const amber = (analysis.storeStatus || []).filter(s => s.status === 'Amber');
  const priorities = [];
  const actions = [];

  const syncGap = buildSyncPriority(live, date);
  if (syncGap) { priorities.push(syncGap.summary); actions.push(...syncGap.actions); }

  const sales = buildSalesPriority(live, date);
  if (sales) { priorities.push(sales.summary); actions.push(...sales.actions); }

  const mix = buildMixPriority(live, production);
  if (mix) { priorities.push(mix.summary); actions.push(...mix.actions); }

  const prod = buildProductionVsSalesPriority(live, production);
  if (prod) { priorities.push(prod.summary); actions.push(...prod.actions); }

  const protectedSku = buildProtectedSkuPriority(production);
  if (protectedSku) { priorities.push(protectedSku.summary); actions.push(...protectedSku.actions); }

  if (red.length) priorities.push(`Fix data gaps before judging performance: ${red.map(s => s.store).join(', ')}.`);
  if (amber.length) priorities.push(`Review incomplete sources: ${amber.map(s => s.store).join(', ')}.`);

  priorities.push('Keep admin follow-up off Freda: managers own store checks; Nicolas owns sync/data issues; Freda only reviews exceptions.');

  const fallbackActions = (analysis.openActions || []).slice(0, 6);
  const mergedActions = [...actions, ...fallbackActions].slice(0, 10);

  return {
    title: `Priority briefing for ${date}`,
    statusLine: statusLine(live, red, amber),
    storeStatus: analysis.storeStatus || [],
    priorities: priorities.filter(Boolean).slice(0, 6),
    actions: mergedActions,
    generatedAt: new Date().toISOString()
  };
}

function statusLine(live, red, amber) {
  const posStores = OPS_STORES.filter(store => daySales(live.reportingPOS?.[store]) > 0).length;
  const uberStores = OPS_STORES.filter(store => daySales(live.uberEats?.[store]) > 0).length;
  if (red.length) return `Red: ${red.length} store(s) still have data gaps; sync before taking commercial decisions.`;
  if (posStores && !uberStores) return `POS is live for ${posStores}/3 stores; Uber online is not synced yet, so WTD total is incomplete.`;
  if (amber.length) return `Amber: core POS is available, but some external/prod checks still need action.`;
  return 'Green: primary POS data is synced; review mix and production actions next.';
}

function buildSyncPriority(live, date) {
  const missingPos = OPS_STORES.filter(store => daySales(live.reportingPOS?.[store]) <= 0);
  const missingUber = OPS_STORES.filter(store => daySales(live.uberEats?.[store]) <= 0);
  const actions = [];
  if (missingPos.length) actions.push({ owner: 'Nicolas/Ops', store: missingPos.join(', '), priority: 'High', title: 'Run POS current + last days', body: `Selected date ${date}: POS missing for ${missingPos.join(', ')}. Tap Sync current + last days before reviewing WTD/hourly.` });
  if (missingUber.length) actions.push({ owner: 'Nicolas/Ops', store: missingUber.join(', '), priority: 'High', title: 'Run Uber online sync', body: `Uber Manager online sales are missing for ${missingUber.join(', ')}. Tap Sync Uber online; do not rely on the old Uber workbook.` });
  if (!actions.length) return null;
  return { summary: actions.map(a => a.title).join(' + ') + '.', actions };
}

function buildSalesPriority(live, date) {
  const rows = OPS_STORES.map(store => {
    const pos = daySales(live.reportingPOS?.[store]);
    const uber = daySales(live.uberEats?.[store]);
    return { store, pos, uber, total: pos + uber, uberShare: pos + uber ? round2(uber / (pos + uber) * 100) : null };
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total);
  if (!rows.length) return null;
  const top = rows[0];
  const needsUber = rows.some(r => r.uber <= 0);
  const summary = needsUber
    ? `${top.store} leads at $${fmt(top.total)} POS/known sales, but Uber is missing for ${rows.filter(r => r.uber <= 0).map(r => r.store).join(', ')}; total sales are understated until Uber online sync runs.`
    : `${top.store} leads at $${fmt(top.total)} incl. Uber; check whether mix and production support the demand before the next peak.`;
  return { summary, actions: needsUber ? [{ owner: 'Nicolas/Ops', store: 'All stores', priority: 'High', title: 'Complete Uber before WTD review', body: 'Run Sync Uber online for selected date and WTD days, then refresh Today/WTD.' }] : [] };
}

function buildMixPriority(live, production) {
  const byCategory = new Map();
  const drivers = [];
  for (const [store, pos] of Object.entries(live.reportingPOS || {})) {
    for (const row of pos.productRows || []) {
      const category = row.category || 'Other';
      const qty = Number(row.qty) || 0;
      const sales = Number(row.sales) || 0;
      const c = byCategory.get(category) || { category, qty: 0, sales: 0 };
      c.qty += qty; c.sales += sales; byCategory.set(category, c);
      if (qty > 0 || sales > 0) drivers.push({ store, product: row.product, category, qty, sales });
    }
  }
  const cats = [...byCategory.values()].sort((a, b) => b.sales - a.sales);
  if (!cats.length) return null;
  const top = cats[0];
  const totalSales = cats.reduce((s, c) => s + c.sales, 0);
  const topShare = totalSales ? round2(top.sales / totalSales * 100) : null;
  const topProducts = drivers.sort((a, b) => b.sales - a.sales).slice(0, 4).map(r => `${r.product} (${r.store})`).join(', ');
  const ballShare = production.ballShare != null ? round2(production.ballShare * 100) : null;
  const summary = `${top.category} is the leading mix at ${topShare}% of POS product sales; top drivers: ${topProducts}. ${ballShare != null ? `Mapped ball demand is ${ballShare}% of units.` : 'Shape map needs sales data to estimate ball/ring demand.'}`;
  return { summary, actions: [{ owner: 'Manager', store: 'All stores', priority: 'Medium', title: 'Protect top mix before peak', body: `Check display depth for ${top.category} and top drivers: ${topProducts}. Rebalance production if filled/ball-heavy items are moving faster than rings.` }] };
}

function buildProductionVsSalesPriority(live, production) {
  const totals = production.totals || {};
  const soldShapeTotal = ['ring', 'ball', 'long', 'scroll', 'apple'].reduce((s, k) => s + (Number(totals[k]) || 0), 0);
  const soldBallShare = soldShapeTotal ? round2((Number(totals.ball) || 0) / soldShapeTotal * 100) : null;
  const planRows = production.importedPlan?.selectedCookRows || [];
  const planShape = {};
  for (const row of planRows) {
    const shape = String(row.shape || '').toUpperCase();
    planShape[shape] = (planShape[shape] || 0) + (Number(row.totalCook) || 0);
  }
  const planTotal = Object.values(planShape).reduce((a, b) => a + Number(b || 0), 0);
  const planBallShare = planTotal ? round2((planShape.BALL || 0) / planTotal * 100) : null;
  if (soldBallShare == null && planBallShare == null) return null;
  const diff = soldBallShare != null && planBallShare != null ? round2(soldBallShare - planBallShare) : null;
  let summary = `Production vs sales mix: sold/mapped BALL share ${soldBallShare ?? 'n/a'}% vs cook plan BALL share ${planBallShare ?? 'n/a'}%.`;
  const actions = [];
  if (diff != null && diff >= 5) {
    summary += ` Ball-heavy demand is running ${diff} pts above plan.`;
    actions.push({ owner: 'Production', store: 'All stores', priority: 'High', title: 'Shift production toward balls/fills', body: 'Before tomorrow’s peak, move some capacity from slower ring lines into balls/fills and confirm SPECIAL/NUTELLA/BISCOFF/CREAM items have enough buffer.' });
  } else if (diff != null && diff <= -5) {
    summary += ` Ring/other demand is running ${Math.abs(diff)} pts above ball plan.`;
    actions.push({ owner: 'Production', store: 'All stores', priority: 'Medium', title: 'Avoid over-cooking balls', body: 'Keep balls controlled and protect rings/fast traditional lines unless later sales shift back to filled/specials.' });
  } else {
    summary += ' Shape mix is close to plan; monitor top specials rather than changing the whole cook.';
    actions.push({ owner: 'Manager', store: 'All stores', priority: 'Medium', title: 'Monitor mix, no major cook change yet', body: 'Keep current shape split, but check top filled/special products before the next production adjustment.' });
  }
  return { summary, actions };
}

function buildProtectedSkuPriority(production) {
  const rows = production.protectedProducts || [];
  if (!rows.length) return null;
  const missing = rows.filter(r => r.status === 'missing_from_plan_but_selling');
  if (!missing.length) return null;
  const byStore = new Map();
  for (const r of missing) {
    const arr = byStore.get(r.store) || [];
    arr.push(`${r.product} (sold ${r.salesQty}, planned ${r.planQty})`);
    byStore.set(r.store, arr);
  }
  const text = [...byStore.entries()].map(([store, items]) => `${store}: ${items.join(', ')}`).join('; ');
  return {
    summary: `Protected SKU check: production plan may be missing high-demand items: ${text}.`,
    actions: [{ owner: 'Production', store: [...byStore.keys()].join(', '), priority: 'High', title: 'Review protected SKU plan', body: `Before changing the cook, verify product-level plan quantities for ${text}. Do not remove Penrith Vanilla Slice / Strawberry Nutella or Caramel Iced without manager confirmation.` }]
  };
}

function daySales(obj) {
  const n = Number(obj?.sales ?? obj?.totalSales ?? obj?.netSales ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n) { return Number(n || 0).toLocaleString('en-AU', { maximumFractionDigits: 1 }); }
