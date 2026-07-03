import { round2 } from '../utils/safe.js';

// 0.2.39: canonical product/shape matching.
// Keep specific product names before generic ones and support aliases so the app
// does not report false gaps such as Penrith Strawberry Nutella / Vanilla Slice
// or Caramel Iced across stores.
export const PROTECTED_SKUS = [
  { canonical: 'Vanilla Slice', aliases: ['VANILLA SLICE'], expectedStores: ['Beverly Hills', 'Penrith', 'Taren Point'] },
  { canonical: 'Strawberry Nutella', aliases: ['STRAWBERRY NUTELLA', 'STRAWBERRY NUTELLA CREAM'], expectedStores: ['Beverly Hills', 'Penrith', 'Taren Point'] },
  { canonical: 'Caramel', aliases: ['CARAMEL', 'CARAMEL ICED'], expectedStores: ['Beverly Hills', 'Penrith', 'Taren Point'] }
];

export const DEFAULT_SHAPE_MAP = [
  ['Strawberry Nutella', 0, 1, 0, 0, 0, ['STRAWBERRY NUTELLA CREAM']],
  ['Nutella Biscoff', 0, 1, 0, 0, 0, ['NUTELLA BISCOFF']],
  ['Biscoff Cream', 0, 1, 0, 0, 0, ['BISCOFF CREAM']],
  ['Vanilla Slice', 0, 0, 1, 0, 0, ['VANILLA SLICE']],
  ['Cream Finger Bun', 0, 0, 1, 0, 0, ['CREAM FINGER BUN']],
  ['Chocolate Eclair', 0, 0, 1, 0, 0, ['CHOCOLATE ECLAIR', 'ECLAIR', 'ECLAIRS']],
  ['Apple Fritter', 0, 0, 0, 0, 1, ['APPLE FRITTER']],
  ['Cinnamon Scroll', 0, 0, 0, 1, 0, ['CINNAMON SCROLL']],
  ['Homer', 1, 0, 0, 0, 0, ['HOMER']],
  ['Glaze', 1, 0, 0, 0, 0, ['GLAZED', 'GLAZE']],
  ['Chocolate Iced', 1, 0, 0, 0, 0, ['CHOCOLATE ICED', 'CHOC']],
  ['Cinnamon', 1, 0, 0, 0, 0, ['CINNAMON']],
  ['Caramel', 1, 0, 0, 0, 0, ['CARAMEL ICED', 'CARAMEL']],
  ['Fairy Bread', 1, 0, 0, 0, 0, ['FAIRY BREAD', 'FAIRY']],
  ['Passionfruit', 1, 0, 0, 0, 0, ['PASSIONFRUIT', 'PASSION']],
  ['Pineapple', 1, 0, 0, 0, 0, ['PINEAPPLE']],
  ['M&M', 1, 0, 0, 0, 0, ['MNMS', 'M&M', 'MMS']],
  ['Nutella', 0, 1, 0, 0, 0, ['NUTELLA']],
  ['Oreo', 0, 1, 0, 0, 0, ['OREO COOKIES N CREAM', 'OREO']],
  ['Creme Brulee', 0, 1, 0, 0, 0, ['CREME BRUILEE', 'BRULEE']],
  ['Boston Creme', 0, 1, 0, 0, 0, ['BOSTON CREME', 'BOSTON CREAM', 'BOSTON']],
  ['Raspberry Filled', 0, 1, 0, 0, 0, ['RASPBERRY FILLED', 'RASPBERRY']],
  ['Banana Custard', 0, 1, 0, 0, 0, ['BANANA CUSTARD', 'BANANA']],
  ['Specials Total', 0.55, 0.30, 0.05, 0.05, 0.05, ['SPECIAL', 'SPECIALS']],
  ['Unknown Special', 0.25, 0.65, 0.03, 0.04, 0.03, ['LIMITED', 'WEEKLY', 'FILLED']]
].map(([product, ring, ball, long, scroll, apple, aliases = []]) => ({ product, ring, ball, long, scroll, apple, aliases }));

const SHAPE_TO_WEIGHTS = {
  RING: { ring: 1, ball: 0, long: 0, scroll: 0, apple: 0 },
  BALL: { ring: 0, ball: 1, long: 0, scroll: 0, apple: 0 },
  LONG: { ring: 0, ball: 0, long: 1, scroll: 0, apple: 0 },
  SCROLL: { ring: 0, ball: 0, long: 0, scroll: 1, apple: 0 },
  APPLE: { ring: 0, ball: 0, long: 0, scroll: 0, apple: 1 }
};

export function normaliseShapeMap(shapeMap = DEFAULT_SHAPE_MAP) {
  return (shapeMap || []).filter(Boolean).map(row => ({
    product: row.product || row.name || 'Unknown',
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    ring: pct(row.ring ?? row.RING),
    ball: pct(row.ball ?? row.BALL),
    long: pct(row.long ?? row.LONG),
    scroll: pct(row.scroll ?? row.SCROLL),
    apple: pct(row.apple ?? row.APPLE)
  }));
}

export function analyseProductionMix(live = {}) {
  const baseMap = normaliseShapeMap(live.productionShapeMap || live.productRules?.shapeMap || DEFAULT_SHAPE_MAP);
  const importedMap = shapeRowsToShapeMap(live.productionPlan?.shapeRows || []);
  const map = mergeShapeMaps(baseMap, importedMap);

  const salesRows = Object.values(live.reportingPOS || {}).flatMap(store => (store.productRows || []).map(row => ({ ...row, store: store.store })));
  const plan = live.productionPlan || {};
  const plannedCookTotals = plan.shapeTotals || {};
  const selectedCookRows = plan.selectedCookRows || [];
  const selectedProductRows = plan.selectedProductRows || [];
  const totals = { ring: 0, ball: 0, long: 0, scroll: 0, apple: 0, unknown: 0 };
  const drivers = [];
  for (const row of salesRows) {
    const qty = Number(row.qty) || 0;
    const match = findShapeMatch(row.product, map);
    if (!match) {
      totals.unknown += qty;
      drivers.push({ product: row.product, qty, shape: 'unknown', store: row.store });
      continue;
    }
    for (const shape of ['ring', 'ball', 'long', 'scroll', 'apple']) totals[shape] += qty * (Number(match[shape]) || 0);
    drivers.push({ product: row.product, qty, store: row.store, matchedProduct: match.product, ring: round2(qty * match.ring), ball: round2(qty * match.ball), long: round2(qty * match.long), scroll: round2(qty * match.scroll), apple: round2(qty * match.apple) });
  }
  const ballShare = sumShapes(totals) ? round2(totals.ball / sumShapes(totals)) : null;
  const warnings = [];
  if (ballShare != null && ballShare >= 0.45) warnings.push('Ball-heavy product mix. Specials/fills may need more balls than old cook sheet assumptions.');
  if (totals.unknown > 0) warnings.push('Some sold products do not match the shape map. Categorise specials/unknowns before production planning.');
  const protectedProducts = buildProtectedSkuCoverage(selectedProductRows, salesRows, map);
  const protectedGaps = protectedProducts.filter(r => r.status === 'missing_from_plan_but_selling');
  if (protectedGaps.length) warnings.push(`Protected SKU plan gap detected: ${protectedGaps.map(r => `${r.store} ${r.product}`).join(', ')}.`);
  return {
    shapeMap: map,
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round2(v)])),
    ballShare,
    warnings: [...warnings, ...(plan.warnings || [])],
    drivers: drivers.sort((a, b) => (b.qty || 0) - (a.qty || 0)).slice(0, 30),
    protectedProducts,
    importedPlan: {
      source: plan.source || 'none',
      weekStart: plan.weekStart || null,
      weekEnd: plan.weekEnd || null,
      storeTotals: plan.storeTotals || {},
      dayTotals: plan.dayTotals || {},
      shapeTotals: plannedCookTotals,
      selectedCookRows,
      selectedProductRows: selectedProductRows.slice ? selectedProductRows.slice(0, 120) : [],
      shapeRows: plan.shapeRows || []
    }
  };
}

function pct(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

function canonicalKey(product = '') {
  return String(product || '').toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\bCREAM\b/g, 'CREME')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliasesForProduct(row = {}) {
  const aliases = [row.product, ...(row.aliases || [])].filter(Boolean);
  if (/CARAMEL/i.test(row.product || '')) aliases.push('CARAMEL ICED');
  if (/STRAWBERRY\s+NUTELLA/i.test(row.product || '')) aliases.push('STRAWBERRY NUTELLA CREAM');
  return [...new Set(aliases.map(canonicalKey).filter(Boolean))];
}

function findShapeMatch(product = '', map = []) {
  const p = canonicalKey(product);
  if (!p) return null;
  const ranked = [...map].sort((a, b) => Math.max(...aliasesForProduct(b).map(x => x.length), 0) - Math.max(...aliasesForProduct(a).map(x => x.length), 0));
  let match = ranked.find(row => aliasesForProduct(row).some(a => p === a));
  if (match) return match;
  match = ranked.find(row => aliasesForProduct(row).some(a => a.length > 2 && (p.includes(a) || a.includes(p))));
  if (match) return match;
  if (/SPECIAL|LIMITED|WEEKLY|FILLED/.test(p)) return ranked.find(row => /UNKNOWN SPECIAL|SPECIALS TOTAL/i.test(row.product));
  return null;
}

function shapeRowsToShapeMap(shapeRows = []) {
  const rows = [];
  for (const r of shapeRows || []) {
    const product = r.product || r.Product;
    const shape = String(r.shape || r['Cook Shape'] || '').toUpperCase().trim();
    const weights = SHAPE_TO_WEIGHTS[shape];
    if (!product || !weights) continue;
    rows.push({ product, ...weights, aliases: productAliases(product) });
  }
  return normaliseShapeMap(rows);
}

function productAliases(product = '') {
  const p = String(product || '').toUpperCase();
  const aliases = [];
  if (p.includes('CARAMEL')) aliases.push('CARAMEL ICED');
  if (p.includes('STRAWBERRY') && p.includes('NUTELLA')) aliases.push('STRAWBERRY NUTELLA CREAM');
  if (p === 'GLAZE') aliases.push('GLAZED');
  if (p.includes('CHOC')) aliases.push('CHOCOLATE ICED');
  if (p.includes('M&M')) aliases.push('MNMS');
  return aliases;
}

function mergeShapeMaps(base = [], overrides = []) {
  const out = [];
  const seen = new Set();
  for (const row of [...overrides, ...base]) {
    const key = canonicalKey(row.product);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return normaliseShapeMap(out);
}

function buildProtectedSkuCoverage(selectedProductRows = [], salesRows = [], map = []) {
  const rows = [];
  for (const sku of PROTECTED_SKUS) {
    const aliases = [sku.canonical, ...(sku.aliases || [])].map(canonicalKey);
    for (const store of sku.expectedStores || []) {
      const planQty = (selectedProductRows || []).filter(r => cleanStore(r.store) === store && aliases.some(a => canonicalKey(r.product).includes(a) || a.includes(canonicalKey(r.product)))).reduce((s, r) => s + (Number(r.totalPlan) || 0), 0);
      const salesQty = (salesRows || []).filter(r => cleanStore(r.store) === store && aliases.some(a => canonicalKey(r.product).includes(a) || a.includes(canonicalKey(r.product)))).reduce((s, r) => s + (Number(r.qty) || 0), 0);
      let status = 'ok_or_not_applicable';
      if ((selectedProductRows || []).length && planQty <= 0 && salesQty > 0) status = 'missing_from_plan_but_selling';
      else if ((selectedProductRows || []).length && planQty > 0) status = 'planned';
      else if (!(selectedProductRows || []).length) status = 'no_product_plan_loaded';
      rows.push({ store, product: sku.canonical, planQty: round2(planQty), salesQty: round2(salesQty), status });
    }
  }
  return rows;
}

function cleanStore(v = '') {
  const s = String(v || '').trim().toLowerCase();
  if (s.includes('pen')) return 'Penrith';
  if (s.includes('taren') || s.includes('tp')) return 'Taren Point';
  if (s.includes('bev') || s.includes('bh')) return 'Beverly Hills';
  return String(v || '').trim();
}

function sumShapes(t) { return (t.ring || 0) + (t.ball || 0) + (t.long || 0) + (t.scroll || 0) + (t.apple || 0); }
