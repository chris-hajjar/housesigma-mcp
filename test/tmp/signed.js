const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const short = (o, n = 500) => String(JSON.stringify(o) ?? 'undefined').slice(0, n);
(async () => {
  const t = new StdioClientTransport({ command: 'node', args: [path.join(__dirname, '..', '..', 'bin', 'stdio.js')], env: { ...process.env, HS_ALLOW_ANON: '0' }, stderr: 'pipe' });
  const c = new Client({ name: 'signed', version: '0' }); await c.connect(t);
  const call = async (n, a = {}) => { const r = await c.callTool({ name: n, arguments: a }); let j; try { j = JSON.parse(r.content[0].text); } catch { j = r.content[0].text; } console.log(`\n== ${n} ${short(a, 100)} -> ${r.isError ? 'ERROR' : 'ok'}`); return j; };
  let j = await call('login'); console.log(short({ status: j.status, source: j.source, user: j.user, secret: j.secret_expires_at, ver: j.client_version }, 400));
  j = await call('my_saved', { kind: 'all' });
  for (const [k, v] of Object.entries(j)) { if (k === 'csv') continue; const arr = Array.isArray(v) ? v : (v?.list || v?.data || v); console.log(`  ${k}:`, Array.isArray(arr) ? `${arr.length} items; first=${short(arr[0], 350)}` : short(v, 350)); }
  const polys = Array.isArray(j.polygons) ? j.polygons : (j.polygons?.list || []);
  const pid = polys[0]?.id || polys[0]?.id_polygon || polys[0]?.id_user_watch_polygon;
  if (pid) { const s = await call('search_listings', { polygon_id: pid, mode: 'rent', limit: 10 }); console.log('  polygon search:', s.total_in_area, s.returned, short(s.resolved, 200), short(s.rows?.[0], 300), s.message || ''); }
  else console.log('  (no watched areas on this account; skipping polygon search)');
  const s = await call('search_listings', { where: 'Liberty Village', mode: 'rent', beds_min: 1, price_max: 3000, limit: 5 });
  console.log('  rows:', s.returned, 'of', s.total_in_area); console.log('  row0:', short(s.rows?.[0], 500));
  const id = s.rows?.[0]?.id_listing;
  j = await call('get_listing', { id, fresh: true }); console.log('  listing:', short({ address: j.listing?.address, price: j.listing?.price, listed_on: j.listing?.listed_on, dom: j.listing?.days_on_market, maint: j.listing?.maintenance, sqft: j.listing?.sqft }, 400)); console.log('  history:', short(j.history, 700)); console.log('  estimate rent:', short({ rent: j.estimate?.rent, price: j.estimate?.price }, 200));
  j = await call('get_comparables', { id, kind: 'rent' }); console.log('  comps:', j.count, short(j.rows?.[0], 300));
  const sold = await call('search_listings', { where: 'Mississauga', mode: 'sold', house_types: ['condo'], listed_within_days: 30, limit: 3 }); console.log('  sold row0:', short(sold.rows?.[0], 350));
  j = await call('update_watchlist', { action: 'watch', id }); console.log('  watch:', short(j, 300));
  j = await call('my_saved', { kind: 'watched' }); const w = Array.isArray(j.watched) ? j.watched : (j.watched?.list || j.watched?.houseList || []); console.log('  watched now:', Array.isArray(w) ? w.length : short(j.watched, 200), Array.isArray(w) && w.some(x => x.id_listing === id) ? '(contains test listing)' : '');
  j = await call('update_watchlist', { action: 'unwatch', id }); console.log('  unwatch:', short(j, 300));
  await c.close();
})().catch(e => { console.error(e); process.exit(1); });
