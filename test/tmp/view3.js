const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
(async () => {
  const t = new StdioClientTransport({ command: 'node', args: [path.join(__dirname, '..', '..', 'bin', 'stdio.js')], env: { ...process.env }, stderr: 'pipe' });
  const c = new Client({ name: 'view', version: '0' }); await c.connect(t);
  const show = async (n, a = {}, max = 700) => { const t0 = Date.now(); const r = await c.callTool({ name: n, arguments: a }); const txt = r.content[0].text; console.log(`\n### ${n} ${JSON.stringify(a)} ${r.isError ? '[ERROR]' : ''} (${txt.length} chars, ${Date.now() - t0}ms)\n${txt.slice(0, max)}${txt.length > max ? '\n…' : ''}`); return JSON.parse(txt); };
  await show('suggest_places', { query: 'Mississauga' }, 500);
  await show('search_listings', { where: 'Mississauga', mode: 'sold', house_types: ['condo'], listed_within_days: 7, limit: 2 }, 600);
  await show('search_listings', { where: 'Mississauga', mode: 'precon', limit: 2 }, 400);
  await show('suggest_places', { query: 'Leslieville' }, 300);
  await show('search_listings', { where: '1 Shaw Street', limit: 2 }, 500);
  await show('track_search', { action: 'save', name: 'lv', query: { where: 'Liberty Village', beds_min: 1, price_max: 3000 } }, 100);
  await show('whats_new', { name: 'lv' }, 300); await show('whats_new', { name: 'lv' }, 300);
  await show('track_search', { action: 'delete', name: 'lv' }, 100);
  await c.close();
})().catch(e => { console.error(e); process.exit(1); });
