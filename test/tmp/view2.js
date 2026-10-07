const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
(async () => {
  const t = new StdioClientTransport({ command: 'node', args: [path.join(__dirname, '..', '..', 'bin', 'stdio.js')], env: { ...process.env }, stderr: 'pipe' });
  const c = new Client({ name: 'view', version: '0' }); await c.connect(t);
  const show = async (n, a = {}, max = 900) => { const t0 = Date.now(); const r = await c.callTool({ name: n, arguments: a }); const txt = r.content[0].text; console.log(`\n### ${n} ${JSON.stringify(a)} ${r.isError ? '[ERROR]' : ''} (${txt.length} chars, ${Date.now() - t0}ms)\n${txt.slice(0, max)}${txt.length > max ? '\n…' : ''}`); return JSON.parse(txt); };
  await show('track_search', { action: 'save', name: 'lv', query: { where: 'Liberty Village', beds_min: 1, price_max: 3000 } }, 400);
  await show('whats_new', { name: 'lv' }, 400);
  await show('whats_new', { name: 'lv' }, 600);
  await show('whats_new', { name: 'lv', dry_run: true }, 600);
  await show('track_search', { action: 'list' }, 400);
  await show('track_search', { action: 'delete', name: 'lv' }, 200);
  await show('lookup_filters', { search: 'lease' }, 500);
  await show('search_listings', { where: 'Mississauga', mode: 'precon', limit: 3 }, 700);
  await show('get_listing', { id: 'xLkv3V1WGOZ7DBNr' }, 600);
  await c.close();
})().catch(e => { console.error(e); process.exit(1); });
