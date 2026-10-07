// find.js — suggest_places, search_listings, lookup_filters. Exports the search building blocks for tracking.
'use strict';
const { z } = require('zod');
const { paths, defaults } = require('../config');
const { readJson, writeJson } = require('../store');
const { withApi, normRow, maybeCsv, json, passesFilters } = require('./util');
const pull = require('../pull');

const MODES = { rent: [2], sale: [1], sold: [3], leased: [4], delisted: [5, 6] };
const HOUSE_TYPES = { all: 'all', detached: 'D.', semi: 'S.', 'semi-detached': 'S.', townhouse: 'A.', 'freehold townhouse': 'A.', 'condo townhouse': 'T.', condo: 'C.', 'condo apt': 'C.', apartment: 'C.', link: 'L.', multiplex: 'M.', land: 'V.', 'vacant land': 'V.', other: 'O.' };
const PROVINCE_NAMES = { ON: 'Ontario', BC: 'British Columbia', AB: 'Alberta' };
const PREVIEW_BATCH = 30; // /listing/preview/many returns at most 30

async function filtersVocab(api) {
  const cached = readJson(paths.filters, null);
  if (cached?.fetched_at && Date.now() - Date.parse(cached.fetched_at) < 7 * 86400e3) return cached.data;
  const data = await api.post('/search/mapsearchv2/mapfilter', {});
  writeJson(paths.filters, { fetched_at: new Date().toISOString(), data });
  return data;
}

function snapDays(v, buckets) {
  if (!v) return 0;
  const ids = (buckets || []).map(b => b.id).filter(x => typeof x === 'number').sort((a, b) => a - b);
  if (!ids.length) return v;
  return ids.find(id => id >= v) ?? ids[ids.length - 1];
}

function typeCode(t) {
  if (!t) return null;
  const s = String(t).trim();
  if (/^[A-Z]\.$/.test(s)) return s;
  return HOUSE_TYPES[s.toLowerCase()] || null;
}

function bboxAround(lat, lon, km) {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos(lat * Math.PI / 180));
  return { lat1: lat - dLat, lon1: lon - dLon, lat2: lat + dLat, lon2: lon + dLon };
}
function zoomFor(b) {
  const span = Math.max(Math.abs(b.lat2 - b.lat1), Math.abs(b.lon2 - b.lon1) * 0.72);
  if (span < 0.02) return 15; if (span < 0.05) return 14; if (span < 0.12) return 13; if (span < 0.3) return 12; return 11;
}

/** OpenStreetMap fallback for names HouseSigma's suggest does not know (e.g. "Liberty Village"). */
async function geocode(query, province) {
  const q = /,/.test(query) ? query : `${query}, ${PROVINCE_NAMES[province] || province}`;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=ca&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'housesigma-mcp/0.1 (personal; node)' }, signal: AbortSignal.timeout(defaults.timeoutMs) });
  if (!r.ok) return null;
  const hit = (await r.json())[0];
  if (!hit) return null;
  const bb = (hit.boundingbox || []).map(Number); // [south, north, west, east]
  const bounds = bb.length === 4 ? { lat1: bb[0], lon1: bb[2], lat2: bb[1], lon2: bb[3] } : null;
  const spanKm = bounds ? Math.max((bounds.lat2 - bounds.lat1) * 111, (bounds.lon2 - bounds.lon1) * 80) / 2 : null;
  return { kind: 'geocoded', name: hit.display_name, lat: Number(hit.lat), lon: Number(hit.lon), bounds: spanKm && spanKm < 12 ? bounds : null, radius_km: spanKm && spanKm < 12 ? Math.max(0.6, spanKm) : 2 };
}

const norm = s => String(s || '').toLowerCase().trim();
const wordsMatch = (name, q) => { const n = norm(name); return norm(q).split(/\s+/).filter(Boolean).every(w => n.includes(w)); };

/** Suggest -> best match (community / city / place / listing, else geocoded) plus HouseSigma's candidates. */
async function resolvePlace(api, query, province) {
  const d = await api.post('/search/address_v2/suggest', { province, search_term: query });
  const cands = [];
  for (const c of d.community_list || []) cands.push({ kind: 'community', name: `${c.community_name}, ${c.municipality_name}`, municipality: c.municipality_name, lat: c.coordinate?.lat, lon: c.coordinate?.lon, id_community: c.id_community, id_municipality: c.id_municipality, radius_km: 1.5 });
  for (const c of d.community_suggest || []) cands.push({ kind: 'community', name: `${c.community_name || c.name}, ${c.municipality_name || ''}`.replace(/, $/, ''), lat: c.coordinate?.lat ?? c.lat, lon: c.coordinate?.lon ?? c.lon, id_community: c.id_community, id_municipality: c.id_municipality, radius_km: 1.5 });
  for (const c of d.city_list || []) cands.push({ kind: 'city', name: c.municipality_name || c.name, lat: c.coordinate?.lat ?? c.lat, lon: c.coordinate?.lon ?? c.lon, id_municipality: c.id_municipality || c.id, radius_km: 6 });
  // An address: a one-block box around it (its own building's listings, any status the mode allows).
  for (const c of d.place_list || []) cands.push({ kind: 'address', name: c.name || c.address || c.text, lat: c.coordinate?.lat ?? c.lat ?? c.location?.lat, lon: c.coordinate?.lon ?? c.lon ?? c.lng ?? c.location?.lon ?? c.location?.lng, id_municipality: c.id_municipality, radius_km: 0.15 });
  for (const h of d.house_list || []) cands.push({ kind: 'listing', name: h.address || h.address_navigation, id_listing: h.id_listing, lat: h.map?.lat ?? h.location?.lat ?? h.lat, lon: h.map?.lon ?? h.location?.lon ?? h.lon, id_municipality: h.id_municipality, id_community: h.id_community });
  // Exact name beats prefix beats contains; a city beats a community with the same words ("Mississauga" vs "Mississauga Valleys").
  const q = norm(query);
  const score = c => {
    const full = norm(c.name), first = norm(String(c.name).split(',')[0]);
    let s = 0;
    if (first === q || full === q) s += 4; else if (first.startsWith(q)) s += 2; else if (wordsMatch(c.name, query)) s += 1; else return 0;
    if (c.kind === 'city') s += 0.5;
    if (c.kind === 'address') s += 0.4; // prefer the address over one listing at it
    return s;
  };
  const strong = cands.map(c => ({ c, s: score(c) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.c);
  let best = strong[0] || null;
  // "Mississauga" with no city candidate but communities inside Mississauga: treat it as the city (geocoded box + its id).
  const cityOf = cands.find(c => c.kind === 'community' && norm(c.municipality) === q);
  if (cityOf && !(best && best.kind === 'city')) {
    const g = await geocode(query, province).catch(() => null);
    if (g) best = { ...g, kind: 'city', name: cityOf.municipality, id_municipality: cityOf.id_municipality, radius_km: g.bounds ? g.radius_km : 6 };
  }
  if (!best) best = await geocode(query, province).catch(() => null);
  return { best, candidates: cands.slice(0, 15) };
}

function polygonBbox(obj) {
  const pts = [];
  (function walk(o) {
    if (!o) return;
    if (Array.isArray(o)) {
      if (o.length === 2 && typeof o[0] === 'number' && typeof o[1] === 'number') { const [a, b] = o; pts.push(Math.abs(a) > 90 ? [b, a] : [a, b]); return; }
      o.forEach(walk); return;
    }
    if (typeof o === 'object') {
      if (typeof o.lat === 'number' && typeof (o.lon ?? o.lng) === 'number') { pts.push([o.lat, o.lon ?? o.lng]); return; }
      Object.values(o).forEach(walk);
    }
  })(obj);
  if (!pts.length) return null;
  const lats = pts.map(p => p[0]), lons = pts.map(p => p[1]);
  return { lat1: Math.min(...lats), lon1: Math.min(...lons), lat2: Math.max(...lats), lon2: Math.max(...lons) };
}

/** Turn where / bounds / polygon_id into a map box. Returns { bounds, resolved, listing? }. */
async function resolveBounds(api, p, province) {
  if (p.bounds) return { bounds: p.bounds, resolved: { kind: 'bounds' } };
  if (p.polygon_id) {
    const poly = await api.post('/user/watch_polygon/get', { id: p.polygon_id });
    const bounds = polygonBbox(poly);
    if (!bounds) throw new Error(`Could not read watched area ${p.polygon_id}.`);
    return { bounds, resolved: { kind: 'polygon', id: p.polygon_id, name: poly?.name || poly?.title || null } };
  }
  if (p.where) {
    const { best } = await resolvePlace(api, p.where, province);
    if (!best) throw new Error(`No place matched "${p.where}". Try suggest_places.`);
    if (best.kind === 'listing' && best.id_listing && typeof best.lat !== 'number') return { bounds: null, resolved: best, listing: best.id_listing };
    if (typeof best.lat !== 'number') throw new Error(`"${best.name}" has no map position. Pass bounds instead.`);
    const bounds = (!p.radius_km && best.bounds) ? best.bounds : bboxAround(best.lat, best.lon, p.radius_km || best.radius_km || 1.5);
    return { bounds, resolved: best };
  }
  throw new Error('Give a place (where), a map box (bounds) or a watched area (polygon_id).');
}

/** The filter body HouseSigma's map expects, from our friendly params. */
function buildBody(p, bounds, vocab) {
  const mode = p.mode || 'rent';
  const isRent = mode === 'rent' || mode === 'leased';
  const body = {
    ...bounds, zoom: zoomFor(bounds),
    list_type: MODES[mode],
    house_type: p.house_types?.length ? p.house_types.map(t => typeCode(t) || t) : ['all'],
    price: [p.price_min ?? 0, p.price_max ?? (isRent ? 10000 : 6000000)],
    bedroom_range: bedroomRange(p),
    bathroom_min: p.baths_min ?? 0, garage_min: p.parking_min ?? 0,
    basement: p.basement || [], square_footage: [p.sqft_min ?? 0, p.sqft_max ?? 4000],
    open_house_date: 0, front_feet: [0, 100], max_maintenance_fee: p.max_maintenance_fee ?? 0,
    description: p.keywords || '', listing_type: ['all'],
    listing_days: 0, de_list_days: 90, sold_days: 90, rent_list_type: [2],
  };
  // Time window. period: "ytd" | 2025 | "30d" ... ; listed_within_days / listed_over_days for active listings.
  const bucket = periodBucket(p);
  if (mode === 'rent' || mode === 'sale') {
    if (p.listed_over_days) body.listing_days = -[15, 30, 60, 90].reduce((a, b) => (Math.abs(b - p.listed_over_days) < Math.abs(a - p.listed_over_days) ? b : a));
    else body.listing_days = typeof bucket === 'number' ? snapDays(bucket, vocab?.days_filter_all?.listing) : 0;
  } else if (mode === 'sold' || mode === 'leased') body.sold_days = bucket ?? 90;
  else body.de_list_days = bucket ?? 90;
  return body;
}

/** -> a HouseSigma days bucket: number of days (snapped later) or "Y2026" style year. */
function periodBucket(p) {
  if (p.period) {
    const v = String(p.period).toLowerCase();
    if (v === 'ytd' || v === 'this year') return `Y${new Date().getFullYear()}`;
    if (/^(19|20)\d\d$/.test(v)) return `Y${v}`;
    const m = v.match(/^(\d+)\s*d(ays?)?$/); if (m) return Number(m[1]);
    if (/^\d+$/.test(v)) return Number(v);
    throw new Error(`period must be "ytd", a year like 2025, or days like "90d".`);
  }
  if (p.listed_within_days) return [1, 3, 7, 30, 90, 180, 360].find(d => d >= p.listed_within_days) ?? 360;
  return undefined;
}

/** HouseSigma's bedroom filter is a list of EXACT main-bedroom counts (a den, the "+1", is not counted); 0 is -10, 5 means 5+. */
function bedroomRange(p) {
  if (p.beds_min === undefined && p.beds_max === undefined) return [0];
  const lo = Math.max(0, Math.min(5, p.beds_min ?? 0)), hi = Math.max(lo, Math.min(5, p.beds_max ?? 5));
  const out = []; for (let n = lo; n <= hi; n++) out.push(n === 0 ? -10 : n);
  return out;
}

/** Every listing id in the box (map pins). Stable across calls, unlike paged lists. */
async function fetchIds(api, body) {
  const d = await api.post('/search/mapsearchv3/listing', body);
  return Array.from(new Set([].concat(...(d.list || []).map(c => c.ids || []))));
}

/** Short rows for a set of ids, 30 per call. */
async function fetchRowsByIds(api, ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += PREVIEW_BATCH) {
    const d = await api.post('/listing/preview/many', { id_listing: ids.slice(i, i + PREVIEW_BATCH) });
    rows.push(...(d.houseList || []).map(normRow));
  }
  return rows;
}

const sqftMid = r => { const m = String(r.sqft || '').match(/(\d+)\s*-\s*(\d+)/); return m ? (Number(m[1]) + Number(m[2])) / 2 : parseInt(r.sqft) || null; };
const ppsf = r => (r.price && sqftMid(r) ? r.price / sqftMid(r) : null);
const SORTS = {
  newest: (a, b) => (a.days_on_market ?? 9e9) - (b.days_on_market ?? 9e9),
  longest_listed: (a, b) => (b.days_on_market ?? -1) - (a.days_on_market ?? -1),
  recently_ended: (a, b) => (a.ended_days_ago ?? 9e9) - (b.ended_days_ago ?? 9e9),
  price_asc: (a, b) => (a.price ?? 9e12) - (b.price ?? 9e12),
  price_desc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
  sqft_desc: (a, b) => (sqftMid(b) || 0) - (sqftMid(a) || 0),
  price_per_sqft: (a, b) => (ppsf(a) ?? 9e12) - (ppsf(b) ?? 9e12),
  biggest_discount: (a, b) => (a.vs_asking_pct ?? 9e9) - (b.vs_asking_pct ?? 9e9),
};

/** Paged search. Returns { rows, total, bounds, resolved, mode, note? }. */
async function runSearch(api, p, province) {
  const mode = p.mode || 'rent';
  const { bounds, resolved, listing } = await resolveBounds(api, p, province);
  if (listing) return { rows: await fetchRowsByIds(api, [listing]), total: 1, bounds: null, resolved, mode };
  if (mode === 'precon') return precon(api, bounds, p, resolved);
  const vocab = await filtersVocab(api).catch(() => null);
  const body = buildBody(p, bounds, vocab);
  const limit = p.limit || 50;
  let rows = [], total = 0;
  for (let pg = p.page || 1, pages = 0; rows.length < limit && pages < 50; pg++, pages++) {
    const d = await api.post('/search/mapsearchv3/list', { ...body, page: pg });
    const list = d.houseList || [];
    total = d.total ?? total;
    rows.push(...list.map(normRow).filter(r => !p.den || p.den === 'any' || passesFilters(r, { den: p.den })));
    if (!list.length || pg * 20 >= total) break;
  }
  const seen = new Set();
  rows = rows.filter(r => !r.id || (!seen.has(r.id) && seen.add(r.id))).slice(0, limit);
  rows.sort(SORTS[p.sort || 'newest']);
  return { rows, total, bounds, resolved, mode };
}

/** Complete, stable result set for a box (pins + previews), filtered client-side. Used by whats_new. */
async function runSearchStable(api, p, province) {
  const { bounds, resolved } = await resolveBounds(api, p, province);
  const vocab = await filtersVocab(api).catch(() => null);
  const body = buildBody(p, bounds, vocab);
  const ids = await fetchIds(api, body);
  const rows = (await fetchRowsByIds(api, ids)).filter(r => passesFilters(r, p));
  rows.sort(SORTS[p.sort || 'newest']);
  return { rows, total: rows.length, bounds, resolved, mode: p.mode || 'rent' };
}

async function precon(api, bounds, p, resolved) {
  const body = { ...bounds, zoom: zoomFor(bounds), project_status: [1], property_type: ['all'], construction_status: ['all'], est_completion_year: ['all'], price: [p.price_min ?? 0, p.price_max ?? 6000000], bedroom_range: p.beds_min ? [p.beds_min] : [0], bathroom_min: p.baths_min ?? 0, garage_min: 0, description: p.keywords || '', square_footage: [p.sqft_min ?? 0, p.sqft_max ?? 4000] };
  const clusters = await api.post('/search/preconmap/projects', body);
  const ids = [].concat(...(Array.isArray(clusters) ? clusters : Object.values(clusters || {})).map(c => c.ids || []));
  let rows = [];
  if (ids.length) {
    try {
      const d = await api.post('/listing/preview/precon_many', { id_project: ids.slice(0, p.limit || 50) });
      rows = (d.houseList || d.list || d).map(x => ({ id_project: x.id_project, name: x.project_name, address: x.addr, price_from: x.price_int ?? x.price, beds: x.bedroom_text, sqft: x.sqft_text, type: x.property_type_text, status: x.project_status_text }));
    } catch { rows = ids.map(id => ({ id_project: id })); }
  }
  return { rows, total: ids.length, bounds, resolved, mode: 'precon', note: 'Pre-construction projects. For one project use call_api /listing/info/precon_detail with {id_project}.' };
}

function describeArea(r, p) {
  const res = r.resolved;
  if (p.bounds) return 'custom map box';
  if (!res) return null;
  if (res.kind === 'polygon') return `watched area ${res.name || res.id}`;
  if (res.kind === 'listing') return res.name;
  if (res.kind === 'geocoded') return `${String(res.name).split(',').slice(0, 2).join(',')} (map box ~${(res.radius_km || 1.5).toFixed(1)} km)`;
  if (res.kind === 'address') return `${res.name} (that address, ~${Math.round((p.radius_km || res.radius_km) * 1000)} m around it)`;
  return `${res.name} (${res.kind}, map box ~${(p.radius_km || res.radius_km || 1.5).toFixed(1)} km${res.kind === 'city' && !p.radius_km ? ', whole city' : ''})`;
}

const searchInput = {
  where: z.string().optional().describe('Place name: neighbourhood ("Liberty Village"), city ("Mississauga") or an address.'),
  bounds: z.object({ lat1: z.number(), lon1: z.number(), lat2: z.number(), lon2: z.number() }).optional().describe('Map box: SW corner lat1/lon1, NE corner lat2/lon2.'),
  polygon_id: z.union([z.string(), z.number()]).optional().describe('One of your watched areas (see my_saved).'),
  radius_km: z.number().min(0.2).max(30).optional().describe('Half-size of the box around a place. Default 1.5 (neighbourhood) or 6 (city).'),
  mode: z.enum(['rent', 'sale', 'sold', 'leased', 'delisted', 'precon']).optional().describe('Default rent.'),
  house_types: z.array(z.string()).optional().describe('detached, semi, townhouse, condo townhouse, condo, link, multiplex, land, other (or the app codes D. S. A. T. C. L. M. V. O.). Default all.'),
  price_min: z.number().optional(), price_max: z.number().optional(),
  beds_min: z.number().int().min(0).max(5).optional().describe('Minimum bedrooms, not counting a den. 0 = studio, 5 = 5+.'),
  beds_max: z.number().int().min(0).max(5).optional().describe('Maximum bedrooms. Set equal to beds_min for an exact count.'),
  den: z.enum(['yes', 'no', 'any']).optional().describe('The "+1" in 1+1. yes = must have a den, no = must not. HouseSigma has no den filter, so this is applied to the results; matches shows the count before it.'),
  baths_min: z.number().int().min(0).max(5).optional().describe('Minimum bathrooms (1 = 1+).'),
  parking_min: z.number().int().min(0).max(5).optional(),
  sqft_min: z.number().optional(), sqft_max: z.number().optional(),
  max_maintenance_fee: z.number().optional(),
  basement: z.array(z.enum(['finished', 'separate', 'walkout'])).optional(),
  period: z.string().optional().describe('Time window: "ytd", a year like "2025", or days like "90d". For rent/sale: listed within. For sold/leased/delisted: happened within (default 90d).'),
  listed_within_days: z.number().int().optional().describe('Same as period in days.'),
  listed_over_days: z.number().int().optional().describe('rent/sale only: still listed after 15, 30, 60 or 90+ days (stale listings, room to negotiate).'),
  keywords: z.string().optional().describe('Words that must appear in the description.'),
  sort: z.enum(['newest', 'longest_listed', 'recently_ended', 'price_asc', 'price_desc', 'sqft_desc', 'price_per_sqft', 'biggest_discount']).optional().describe('Default newest. biggest_discount = sold/leased furthest under asking.'),
  limit: z.number().int().min(1).max(1000).optional().describe('How many to return in the reply. Default 50, max 1000 (HouseSigma pages 20 at a time, ~0.6 s each).'),
  all: z.boolean().optional().describe('Pull EVERYTHING in the area to a CSV in the background, no limit (HouseSigma caps each map box at 4,000 rows, so the area is tiled). Returns a pull id; check progress with the pulls tool.'),
  page: z.number().int().min(1).optional().describe('Start page (20 per page). Default 1.'),
  csv: z.boolean().optional().describe('Also write the results to a CSV file.'),
};

function register(server, province) {
  server.registerTool('suggest_places', {
    title: 'Suggest places',
    description: 'Look up a neighbourhood, city or address. Use when a place name is ambiguous; search_listings resolves names itself.',
    inputSchema: { query: z.string().min(3), province: z.string().length(2).optional() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ query, province: prov }) => withApi(async api => {
    const { best, candidates } = await resolvePlace(api, query, (prov || province).toUpperCase());
    const slim = c => ({ kind: c.kind, name: c.name, id_municipality: c.id_municipality, id_community: c.id_community, id_listing: c.id_listing });
    return { best: best ? slim(best) : null, others: candidates.filter(c => c !== best).slice(0, 8).map(slim) };
  }));

  server.registerTool('search_listings', {
    title: 'Search listings',
    description: 'Search listings by place name, map box or one of your watched areas. Rentals by default; mode sale / sold / leased / delisted / precon. csv:true also writes a CSV file.',
    inputSchema: searchInput,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (p) => withApi(async api => {
    if (p.all) {
      if ((p.mode || 'rent') === 'precon') throw new Error('all is not available for precon; use limit.');
      const { bounds, resolved } = await resolveBounds(api, p, province);
      const vocab = await filtersVocab(api).catch(() => null);
      const area = describeArea({ resolved }, p);
      const columns = ['id', 'address', 'area', 'type', 'status', 'price', 'sold_price', 'vs_asking_pct', 'beds', 'baths', 'parking', 'sqft', 'listed', 'days_on_market', 'ended', 'ended_days_ago', 'mls', 'lat', 'lon', 'postal', 'estimate', 'url'];
      const j = await pull.startPull({ api, query: { ...p, all: undefined, csv: undefined, limit: undefined, page: undefined }, bounds, area, buildBody, filters: vocab, columns });
      const mins = j.expected_rows ? Math.max(1, Math.ceil(j.expected_rows / 30 * 0.7 / 60)) : null;
      return { pull: j.id, area, mode: j.mode, expected_rows: j.expected_rows, estimated_minutes: mins, csv: j.csv, note: 'Running in the background; the CSV grows as it goes. Ask for pull status to check. Large pulls are heavy on your account, keep them occasional.' };
    }
    const r = await runSearch(api, p, province);
    const out = { mode: r.mode, area: describeArea(r, p), matches: r.total >= pull.CAP ? `${r.total}+ (HouseSigma shows at most 4,000 per box; use all:true for everything)` : r.total, showing: r.rows.length, listings: r.rows, note: r.note };
    if (p.den && p.den !== 'any') out.matches = `${out.matches} before the den filter`;
    return maybeCsv(out, r.rows, p, 'search_listings', p.where || (p.polygon_id ? `polygon-${p.polygon_id}` : 'bounds'));
  }));

  server.registerTool('pulls', {
    title: 'Pulls',
    description: 'Progress of background pulls started with search_listings all:true: rows written so far, ETA, CSV path. Actions: status (default), cancel.',
    inputSchema: { id: z.string().optional().describe('A pull id. Default: all pulls.'), action: z.enum(['status', 'cancel']).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id, action }) => {
    if (action === 'cancel') { if (!id) return json({ error: 'Give the pull id to cancel.' }); const j = pull.cancel(id); return json(j ? { cancelled: j.id, rows_written: j.rows_written, csv: j.csv } : { error: `No running pull ${id} in this session.` }); }
    const st = pull.status(id);
    if (!st) return json({ error: `No pull ${id}.` });
    return json(Array.isArray(st) ? { pulls: st.slice(0, 10) } : st);
  });

  server.registerTool('lookup_filters', {
    title: 'Lookup filters',
    description: 'The filter options search_listings accepts: property types, statuses, day ranges.',
    inputSchema: { search: z.string().optional().describe('Filter by word.'), precon: z.boolean().optional().describe('Pre-construction filters instead.') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ search, precon: pc }) => withApi(async api => {
    const v = pc ? await api.post('/search/preconmap/filter', {}) : await filtersVocab(api);
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (['message', 'meta', 'filter_tip', 'default_filter'].includes(k) || !val) continue;
      if (search && !JSON.stringify(val).toLowerCase().includes(search.toLowerCase())) continue;
      out[k.replace(/_filter(_all)?$/, '')] = val;
    }
    if (!pc) out.modes = Object.keys(MODES).concat('precon');
    return out;
  }));
}

module.exports = { register, runSearch, runSearchStable, resolvePlace, resolveBounds, buildBody, fetchIds, fetchRowsByIds, filtersVocab, describeArea };
