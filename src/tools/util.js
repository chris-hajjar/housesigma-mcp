// util.js — shared helpers for tools: result envelopes, auth resolution, row normalizer, csv option.
// Output rule: short, plain, no empty fields. Rows carry only what a person scanning a list needs.
'use strict';
const { post, HsError } = require('../hs/client');
const { authProvider, anonymousAuth } = require('../hs/session');
const { writeCsv } = require('../csv');
const { makeLink } = require('../hs/remote_login');

/** Recursively drop null / undefined / '' values so results stay short. Keeps empty arrays (they mean "none"). */
function compact(v) {
  if (Array.isArray(v)) return v.map(compact);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === null || val === undefined || val === '') continue;
      out[k] = compact(val);
    }
    return out;
  }
  return v;
}

const json = obj => ({ content: [{ type: 'text', text: JSON.stringify(compact(obj), null, 1) }] });
const jsonError = obj => ({ ...json(obj), isError: true });

let anon = null;
const anonProvider = {
  async get() { if (!anon) anon = await anonymousAuth(); return anon; },
  async refreshSecret() { anon = await anonymousAuth(); return anon; },
  invalidate() { anon = null; },
};

/** Run fn(api) where api.post(path, body) is authenticated. Errors become one plain sentence. */
async function withApi(fn) {
  let provider = authProvider;
  try { await authProvider.get(); }
  catch (e) {
    if (process.env.HS_ALLOW_ANON === '1') provider = anonProvider;
    else {
      const link = makeLink();
      return jsonError(link
        ? { error: 'Not signed in to HouseSigma.', link, tell_user: 'Open this link (good for 15 minutes), sign in on HouseSigma, then tap the "Send to MCP" bookmark. Then try again.' }
        : { error: 'Not signed in to HouseSigma. Run the login tool first.' });
    }
  }
  const api = { post: (path, body) => post(path, body, provider), anonymous: provider === anonProvider };
  try {
    const out = await fn(api);
    if (api.anonymous && out && typeof out === 'object' && !out.content) out.note = (out.note ? out.note + ' ' : '') + 'Not signed in: prices and dates may be hidden.';
    return out && out.content ? out : json(out);
  } catch (e) {
    if (e instanceof HsError) return jsonError({ error: `HouseSigma said: ${e.message}` });
    return jsonError({ error: e.message });
  }
}

function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && /\d/.test(String(v)) ? n : null;
}
const gated = v => typeof v === 'string' && /sign-?in required/i.test(v);
const clean = v => (gated(v) ? null : v);

function listingUrl(r) {
  const prov = String(r.province_abbr || r.province || 'ON').toLowerCase().slice(0, 2);
  if (r.seo_municipality && r.seo_address && r.id_address) {
    return `https://housesigma.com/${prov}/${r.seo_municipality}/${r.seo_address}/home/${r.id_address}?id_listing=${r.id_listing}`;
  }
  return `https://housesigma.com/bkv2/landing/rootpage/listing?id_listing=${r.id_listing}`;
}

/** Map-search / nearby / preview row -> short row. */
function normRow(r) {
  if (!r || !r.id_listing) return r;
  const status = r.list_status?.text || null;
  const closed = !!r.date_end || /sold|leased|expired|terminated|suspended|de-?listed/i.test(status || '');
  const sold = /sold|leased/i.test(status || '');
  const asking = r.price_int ?? num(clean(r.price));
  const finalPrice = sold ? (r.price_sold_int ?? num(clean(r.price_sold))) : null;
  const vsAsking = sold && asking && finalPrice ? Math.round((finalPrice - asking) / asking * 1000) / 10 : (sold && r.sold_diff_percent != null ? r.sold_diff_percent : undefined);
  return {
    id: r.id_listing,
    address: r.address || null,
    area: [r.community_name, r.municipality_name].filter(Boolean).join(', ') || null,
    type: r.house_type_name || null,
    status,
    price: asking,
    sold_price: sold ? finalPrice : undefined,
    vs_asking_pct: vsAsking,
    beds: r.bedroom_string || (r.bedroom ?? null),
    baths: r.washroom ?? null,
    parking: r.parking?.total ?? (typeof r.parking === 'number' ? r.parking : null),
    sqft: r.house_area?.display_area || r.house_area?.area || null,
    listed: clean(r.date_start) || null,
    days_on_market: r.list_days ?? (closed ? null : r.date_added_days ?? null),
    ended: closed ? (clean(r.date_end) || null) : undefined,
    ended_days_ago: closed ? (r.date_end_days ?? null) : undefined,
    mls: r.ml_num_merge || r.ml_num || null,
    lat: r.map?.lat ?? undefined,
    lon: r.map?.lon ?? undefined,
    postal: r.postal_code || undefined,
    estimate: num(clean(r.analytics?.estimate_price)) ?? undefined,
    url: listingUrl(r),
  };
}

/** The "+1" (den) part of a beds string like "1+1". */
const hasDen = row => /\+\s*[1-9]/.test(String(row.beds ?? ''));

/** Client-side filters: den (HouseSigma has no filter for it) and guards for what the pins endpoint applies loosely. */
function passesFilters(row, p) {
  if (p.den === 'yes' && !hasDen(row)) return false;
  if (p.den === 'no' && hasDen(row)) return false;
  if (p.price_min != null && row.price != null && row.price < p.price_min) return false;
  if (p.price_max != null && row.price != null && row.price > p.price_max) return false;
  if (p.beds_min != null && row.beds != null && parseInt(row.beds) < p.beds_min) return false;
  if (p.beds_max != null && row.beds != null && parseInt(row.beds) > p.beds_max) return false;
  if (p.baths_min != null && row.baths != null && row.baths < p.baths_min) return false;
  return true;
}

/** If params.csv, write rows and add { csv: path } to the result. */
function maybeCsv(result, rows, params, tool, slug) {
  if (!params?.csv) return result;
  if (!rows?.length) return { ...result, csv: 'nothing to export' };
  return { ...result, csv: writeCsv(rows, tool, slug).path };
}

module.exports = { json, jsonError, withApi, normRow, listingUrl, num, clean, gated, maybeCsv, compact, passesFilters, hasDen };
