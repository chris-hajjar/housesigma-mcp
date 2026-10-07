// market.js — market_stats: trend (summary + monthly chart), rent ratio, price growth, demographics.
'use strict';
const { z } = require('zod');
const { withApi, maybeCsv } = require('./util');
const { resolvePlace } = require('./find');
const { parseId } = require('./listing');

async function placeIds(api, place, province) {
  if (!place) return {};
  if (/^\d+$/.test(String(place))) return { id_municipality: Number(place) };
  const { best } = await resolvePlace(api, String(place), province);
  if (!best) throw new Error(`No place matched "${place}"`);
  if (best.id_municipality) return { id_municipality: best.id_municipality, id_community: best.id_community, name: best.name, kind: best.kind };
  // Geocoded neighbourhood (e.g. "Liberty Village, Spadina—Fort York, Toronto, ..."): walk up its parents until HouseSigma knows one.
  for (const part of String(best.name).split(',').map(x => x.trim()).slice(1, 5)) {
    if (!part || /ontario|british columbia|alberta|canada|golden horseshoe/i.test(part)) continue;
    const r = await resolvePlace(api, part, province).catch(() => null);
    const hit = r?.candidates?.find(c => c.kind === 'city' && c.id_municipality && String(c.name).toLowerCase() === part.toLowerCase())
      || r?.candidates?.find(c => c.id_municipality && String(c.name).toLowerCase().includes(part.toLowerCase()));
    if (hit) return { id_municipality: hit.id_municipality, name: `${best.name.split(',')[0]} (stats for ${hit.name.split(',').pop().trim()})`, kind: 'geocoded->municipality' };
  }
  throw new Error(`"${place}" resolved to ${best.name} but no HouseSigma municipality matched; pass a city name or numeric id_municipality.`);
}

function register(server, province) {
  server.registerTool('market_stats', {
    title: 'Market stats',
    description: 'Market numbers for a city or neighbourhood: trend (median price, listings, days on market, monthly series), rent_ratio, price_growth, or demographic around a listing.',
    inputSchema: {
      kind: z.enum(['trend', 'rent_ratio', 'price_growth', 'demographic']).optional().describe('Default trend.'),
      place: z.string().optional().describe('City or community name (resolved via suggest), or a numeric id_municipality. Required for trend.'),
      house_type: z.string().optional().describe('Code like C. or D., or "all" (default).'),
      months: z.number().int().min(1).max(120).optional().describe('trend only: how many trailing months of chart to return. Default 24.'),
      id: z.string().optional().describe('demographic only: id_listing or URL.'),
      csv: z.boolean().optional().describe('Write the series/table rows to CSV.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (p) => withApi(async api => {
    const kind = p.kind || 'trend';
    const ht = p.house_type || 'all';
    if (kind === 'trend') {
      if (!p.place) throw new Error('trend needs place');
      const ids = await placeIds(api, p.place, province);
      if (!ids.id_municipality) throw new Error(`Could not resolve a municipality for "${p.place}"`);
      const body = { municipality: ids.id_municipality, house_type: ht };
      if (ids.id_community) body.community = ids.id_community;
      const summary = await api.post('/stats/trend/summary', body);
      const chart = await api.post('/stats/trend/chart', body);
      const series = (chart.chart || []).slice(-(p.months || 24));
      const fa = summary.filter_active || {};
      const numify = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, typeof v === 'string' && /^-?[\d,]+(\.\d+)?$/.test(v) ? Number(v.replace(/,/g, '')) : v]));
      const out = { kind, place: [fa.community_name, fa.municipality_name].filter(Boolean).join(', '), property_type: fa.house_type_name, as_of: summary.last_update, now: numify(summary.current), monthly: series.map(numify) };
      if (ids.kind === 'geocoded->municipality') out.note = `${p.place} is not a HouseSigma community; showing ${fa.municipality_name || 'the city'}.`;
      return maybeCsv(out, series, p, 'market_stats', `trend-${summary.filter_active?.municipality_name || ids.id_municipality}`);
    }
    if (kind === 'rent_ratio' || kind === 'price_growth') {
      const base = kind === 'rent_ratio' ? '/stats/rentratio' : '/stats/pricegrowth';
      const ids = await placeIds(api, p.place, province);
      const d = ids.id_municipality ? await api.post(`${base}/city`, { house_type: ht, id_municipality: ids.id_municipality }) : await api.post(base, { house_type: ht });
      const tables = (d.report_data || []).map(t => ({ title: t.title, public: t.public, rows: t.data }));
      const rows = tables.flatMap(t => (Array.isArray(t.rows) ? t.rows.map(r => ({ table: t.title, ...r })) : []));
      const out = { kind, scope: ids.id_municipality ? `communities of ${ids.name || ids.id_municipality}` : 'cities in province', period: d.report_period || null, house_type: d.filter_active, tables };
      return maybeCsv(out, rows, p, 'market_stats', `${kind}-${ids.name || 'province'}`);
    }
    if (!p.id) throw new Error('demographic needs id (a listing)');
    const pid = parseId(p.id);
    const d = await api.post('/stats/demographic', { id_listing: typeof pid === 'string' ? pid : '' });
    return { kind, dauid: d.dauid, demographic: d.demographic };
  }));
}

module.exports = { register };
