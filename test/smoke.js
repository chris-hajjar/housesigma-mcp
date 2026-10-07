#!/usr/bin/env node
// smoke.js — drives the stdio server through a real MCP client. HS_ALLOW_ANON=1 lets read tools run without login.
//   node test/smoke.js            anonymous smoke over every read tool
//   node test/smoke.js --signed   also my_saved (needs a session)
'use strict';
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const short = (o, n = 500) => String(JSON.stringify(o) ?? 'undefined').slice(0, n);
async function main() {
  const t = new StdioClientTransport({ command: 'node', args: [path.join(__dirname, '..', 'bin', 'stdio.js')], env: { ...process.env, HS_ALLOW_ANON: process.argv.includes('--signed') ? '0' : '1' }, stderr: 'pipe' });
  const c = new Client({ name: 'smoke', version: '0.0.0' });
  await c.connect(t);
  const tools = await c.listTools();
  console.log('tools:', tools.tools.map(x => x.name).join(', '), `(${tools.tools.length})`);
  const call = async (name, args = {}) => {
    const t0 = Date.now();
    const r = await c.callTool({ name, arguments: args });
    const txt = r.content?.[0]?.text || '';
    let j; try { j = JSON.parse(txt); } catch { j = txt; }
    console.log(`\n== ${name} ${short(args, 120)} -> ${r.isError ? 'ERROR' : 'ok'} in ${Date.now() - t0}ms`);
    return j;
  };
  let j;
  j = await call('lookup_filters', { search: 'condo' }); console.log(short(j, 300));
  j = await call('suggest_places', { query: 'Liberty Village' }); console.log('best:', short(j.best, 300));
  j = await call('search_listings', { where: 'Liberty Village', mode: 'rent', beds_min: 1, price_max: 3200, limit: 25, csv: true });
  console.log('total', j.total_in_area, 'returned', j.returned, 'resolved', short(j.resolved, 200), 'csv', j.csv?.path);
  const rows = j.rows || []; console.log('row0', short(rows[0], 600));
  const beds = rows.map(r => parseInt(r.beds)).filter(n => !isNaN(n)); console.log('beds min seen', Math.min(...beds), 'prices max seen', Math.max(...rows.map(r => r.price || 0)));
  const id = rows[0]?.id_listing;
  if (id) {
    j = await call('get_listing', { id, include: ['history', 'estimate', 'facts', 'rooms'] }); console.log('listing', short(j.listing, 700)); console.log('history', short(j.history, 400)); console.log('estimate', short(j.estimate, 300));
    j = await call('get_listing', { id: rows[0].url }); console.log('by url ok:', !!j.listing, 'cached_at', j.cached_at);
    j = await call('get_photos', { id }); console.log('photos', j.count, short(j.urls?.slice(0, 2), 300));
    j = await call('get_comparables', { id, kind: 'rent' }); console.log('comps', j.count, short(j.rows?.[0], 300));
  }
  j = await call('search_listings', { where: 'Mississauga', mode: 'sold', house_types: ['condo'], listed_within_days: 30, limit: 5 }); console.log('sold total', j.total_in_area, short(j.rows?.[0], 300), j.error || j.message || '');
  j = await call('search_listings', { bounds: { lat1: 43.63, lon1: -79.43, lat2: 43.66, lon2: -79.39 }, mode: 'precon', limit: 5 }); console.log('precon total', j.total_in_area, short(j.rows?.[0], 300), j.message || '');
  j = await call('market_stats', { kind: 'trend', place: 'Liberty Village', months: 3, csv: true }); console.log('trend', short(j.place, 200), short(j.current, 300), 'series', j.series?.length, j.csv?.path, j.message || '');
  j = await call('market_stats', { kind: 'rent_ratio' }); console.log('rentratio', short(j.period, 100), j.tables?.length, short(j.tables?.[0]?.rows?.[0], 200), j.message || '');
  j = await call('track_search', { action: 'save', name: 'smoke-lv', query: { where: 'Liberty Village', mode: 'rent', price_max: 3200 } }); console.log(short(j, 200));
  j = await call('whats_new', { name: 'smoke-lv' }); console.log('baseline', j.results?.['smoke-lv']?.baseline, 'now', j.results?.['smoke-lv']?.total_now);
  j = await call('whats_new', { name: 'smoke-lv', csv: true }); console.log('2nd: new', j.results?.['smoke-lv']?.new?.length, 'unchanged', j.results?.['smoke-lv']?.unchanged, 'csv', j.csv);
  j = await call('track_search', { action: 'list' }); console.log(short(j, 300));
  j = await call('track_search', { action: 'delete', name: 'smoke-lv' }); console.log(short(j, 100));
  j = await call('call_api', { path: '/listing/nearby/sold', body: { id_listing: id } }); console.log('call_api', short(j.data?.nearby?.[0], 200));
  j = await call('call_api', { path: '/auth/user/signout' }); console.log(short(j, 200));
  if (process.argv.includes('--signed')) { j = await call('login'); console.log(short(j, 400)); j = await call('my_saved', { kind: 'polygons' }); console.log(short(j, 600)); }
  await c.close();
}
main().catch(e => { console.error('✗', e); process.exit(1); });
