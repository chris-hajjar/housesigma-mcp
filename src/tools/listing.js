// listing.js — get_listing, get_photos, get_comparables.
'use strict';
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { paths, defaults } = require('../config');
const { listings } = require('../store');
const { withApi, normRow, listingUrl, num, clean, maybeCsv } = require('./util');

function parseId(id) {
  const s = String(id).trim();
  const m = s.match(/[?&]id_listing=([A-Za-z0-9]+)/);
  if (m) return m[1];
  const h = s.match(/\/home\/([A-Za-z0-9]+)/);
  if (h && !s.includes('id_listing')) return { id_address: h[1] };
  return s;
}

async function fetchDetail(api, id, fresh) {
  const key = typeof id === 'string' ? id : id.id_address;
  if (!fresh) { const c = listings.get(key); if (c) return { detail: c.detail, cached_at: c.fetched_at }; }
  const body = typeof id === 'string' ? { id_listing: id, id_address: '', event_source: '' } : { id_listing: '', id_address: id.id_address, event_source: '' };
  const detail = await api.post('/listing/info/detail_v2', body);
  const realId = detail.house?.id_listing || key;
  listings.put(realId, detail);
  return { detail, cached_at: null };
}

const dash = v => (v === '-' || v === '$- / -' ? null : v);

function facts(kf) {
  const out = {};
  for (const [k, v] of Object.entries(kf || {})) if (v && typeof v === 'object' && 'value' in v) out[k] = v.value;
  return out;
}

function flatten(d, include) {
  const h = d.house || {};
  const kf = facts(d.key_facts_v2);
  const listing = {
    id: h.id_listing, mls: h.ml_num_merge || h.ml_num,
    address: h.address, area: [h.community_name, h.municipality_name].filter(Boolean).join(', '),
    type: h.house_type_name, status: h.list_status?.text,
    price: num(clean(h.price)) ?? clean(h.price), sold_price: num(clean(h.price_sold)) ?? clean(h.price_sold),
    beds: h.bedroom_string || h.bedroom, baths: h.washroom, parking: h.parking?.text || (typeof h.parking === 'number' ? h.parking : null),
    sqft: kf.size_with_area_note || kf.size_without_area_note || h.house_area?.display_area || null,
    maintenance: dash(kf.maintenance), tax: dash(kf.tax), utilities_included: kf.included_utility, build_year: dash(kf.build_year), lot_size: kf.lot_size, locker: kf.locker, exposure: kf.condo_exposure, basement: kf.basement,
    listed_on: kf.listed_on, days_on_market: kf.days_on_site_or_market, updated_on: kf.updated_on,
    description: kf.description1 || kf.description || null,
    brokerage: h.brokerage || null, agent: h.agent_user?.name || null,
    photos: d.picture?.photo_list?.length ?? null, virtual_tour: d.picture?.virtual_tour || null,
    url: listingUrl({ ...h, province_abbr: d.province_abbr }),
  };
  const out = { listing };
  if (include.has('history')) out.history = (d.listing_history || []).map(x => ({ status: x.status, listed: clean(x.date_start), ended: clean(x.date_end), asking: num(clean(x.price)) ?? clean(x.price), final: /sold|leased/i.test(x.status || '') ? (num(clean(x.price_sold)) ?? clean(x.price_sold)) : undefined, note: x.price_note || undefined, mls: x.ml_num && !/\*/.test(x.ml_num) ? x.ml_num : undefined }));
  if (include.has('history')) {
    // Price moves within the current listing, newest first: [{date, price, change_pct, event}]
    const pc = (d.listing_price_change || []).map(x => ({ date: x.date, price: num(x.price), change_pct: x.change && x.change !== 0 ? x.change : undefined, event: x.tag || (x.change < 0 ? 'Price drop' : x.change > 0 ? 'Price increase' : undefined) }));
    if (pc.length > 1) out.price_changes = pc;
    const first = pc[pc.length - 1]?.price, last = pc[0]?.price;
    if (first && last && first !== last) listing.original_price = first;
  }
  if (include.has('estimate')) {
    const a = d.analytics || {};
    out.estimate = { value: a.estimate_price_int ?? dash(a.estimate_price), range: a.estimate_price_range, confidence: a.estimate_price_confident, rent: a.estimate_rent_int ?? dash(a.estimate_rent), days_to_rent: a.estimate_rent_days, days_to_sell: a.estimate_dom, scores: a.scores };
  }
  if (include.has('facts')) out.key_facts = kf;
  if (include.has('rooms')) out.rooms = d.rooms || [];
  if (include.has('property_detail')) out.property_detail = Object.fromEntries(Object.entries(d.property_detail || {}).map(([k, v]) => [k, v?.value ?? v]));
  if (include.has('schools')) out.schools = d.school || [];
  if (include.has('stats')) out.community_stats = d.community_stats_all || d.community_stats || null;
  if (include.has('photos')) out.photos = d.picture?.photo_list || [];
  if (include.has('open_houses')) out.open_houses = { public: d.public_open_house || [], virtual: d.virtual_open_house || [] };
  if (include.has('raw')) out.raw = d;
  return out;
}

const INCLUDES = ['history', 'estimate', 'facts', 'rooms', 'property_detail', 'schools', 'stats', 'photos', 'open_houses', 'popularity', 'raw'];

function register(server) {
  server.registerTool('get_listing', {
    title: 'Get listing',
    description: 'One listing in full: facts, current price, price changes during the listing, every past sale or lease with asking and final prices, estimate. Takes an id or a HouseSigma URL.',
    inputSchema: {
      id: z.string().describe('id_listing (e.g. B5bO3x88dxg3kWVP) or a housesigma.com listing URL.'),
      include: z.array(z.enum(INCLUDES)).optional().describe('Extra sections. Default: history, estimate. Add facts for every key fact, rooms, schools, stats, photos, popularity.'),
      fresh: z.boolean().optional().describe('Skip the 24h cache.'),
      csv: z.boolean().optional().describe('Also write the history to a CSV file.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (p) => withApi(async api => {
    const include = new Set(p.include || ['history', 'estimate']);
    const { detail, cached_at } = await fetchDetail(api, parseId(p.id), p.fresh);
    const out = flatten(detail, include);
    if (include.has('popularity')) out.popularity = await api.post('/listing/info/popularity', { id_listing: out.listing.id_listing }).catch(e => ({ error: e.message }));
    if (cached_at) out.cached = cached_at.slice(0, 16).replace('T', ' ');
    return maybeCsv(out, out.history || [], p, 'get_listing', out.listing.mls || out.listing.id);
  }));

  server.registerTool('get_photos', {
    title: 'Get photos',
    description: 'Photo links for a listing. download:true saves them to a folder and returns the paths.',
    inputSchema: {
      id: z.string().describe('id_listing or listing URL.'),
      download: z.boolean().optional(),
      dir: z.string().optional().describe('Download folder. Default data/photos/<id>/.'),
      max: z.number().int().min(1).max(100).optional().describe('Max photos to download. Default 40.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (p) => withApi(async api => {
    const pid = parseId(p.id);
    const id = typeof pid === 'string' ? pid : (await fetchDetail(api, pid, false)).detail.house?.id_listing;
    const d = await api.post('/listing/info/photos', { id_listing: id });
    const urls = d.picture?.photo_list || [];
    const out = { id, address: d.address, photos: urls.length, virtual_tour: d.picture?.virtual_tour || null, urls };
    if (p.download) {
      const dir = p.dir ? path.resolve(p.dir) : path.join(paths.photos, id);
      fs.mkdirSync(dir, { recursive: true });
      const files = [];
      for (const [i, u] of urls.slice(0, p.max || 40).entries()) {
        const url = typeof u === 'string' ? u : (u.url || u.photo_url);
        if (!url) continue;
        const ext = (url.match(/\.(webp|jpe?g|png)(\?|$)/i) || [, 'jpg'])[1];
        const file = path.join(dir, `${String(i + 1).padStart(2, '0')}.${ext}`);
        const r = await fetch(url, { headers: { 'User-Agent': defaults.userAgent, Referer: 'https://housesigma.com/' } });
        if (!r.ok) { files.push({ url, error: `HTTP ${r.status}` }); continue; }
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
        files.push(file);
      }
      out.saved_to = dir; out.files = files.length; out.failed = files.filter(f => typeof f !== 'string');
    }
    return out;
  }));

  server.registerTool('get_comparables', {
    title: 'Get comparables',
    description: 'Nearby comparables for a listing: recently leased (rent), similar for sale (sale), or recently sold (sold).',
    inputSchema: {
      id: z.string().describe('id_listing or listing URL.'),
      kind: z.enum(['rent', 'sale', 'sold']).optional().describe('Default rent.'),
      csv: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (p) => withApi(async api => {
    const pid = parseId(p.id);
    const id = typeof pid === 'string' ? pid : (await fetchDetail(api, pid, false)).detail.house?.id_listing;
    const kind = p.kind || 'rent';
    const d = await api.post(`/listing/nearby/${kind}`, { id_listing: id });
    const rows = (d.nearby || []).map(normRow);
    const out = { listing: d.house ? `${d.house.address} (${d.house.house_type_name}, ${d.house.bedroom_string} bed)` : id, kind, found: rows.length, comparables: rows, chart: (d.chart || []).length ? d.chart : undefined };
    if (!rows.length) out.note = `HouseSigma shows no ${kind} comparables for this listing. Try kind sold, or search around it.`;
    return maybeCsv(out, rows, p, 'get_comparables', `${kind}-${id}`);
  }));
}

module.exports = { register, fetchDetail, flatten, parseId };
