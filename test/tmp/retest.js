const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
(async () => {
  const t = new StdioClientTransport({ command: 'node', args: [path.join(__dirname, '..', '..', 'bin', 'stdio.js')], env: { ...process.env, HS_ALLOW_ANON: '1' }, stderr: 'pipe' });
  const c = new Client({ name: 'retest', version: '0' }); await c.connect(t);
  const call = async (n, a) => JSON.parse((await c.callTool({ name: n, arguments: a })).content[0].text);
  let j = await call('market_stats', { kind: 'trend', place: 'Liberty Village', months: 3 });
  console.log('trend:', j.place ? `${j.place.municipality_name} / ${j.place.house_type_name}` : j.message, '| current median', j.current?.price_sold, '| series', j.series?.length);
  j = await call('market_stats', { kind: 'trend', place: 'Oakwood Village Toronto', months: 2 });
  console.log('community trend:', j.place ? `${j.place.municipality_name} > ${j.place.community_name}` : j.message);
  j = await call('search_listings', { where: 'Liberty Village', mode: 'rent', limit: 200 });
  const ids = j.rows.map(r => r.id_listing); console.log('search rows', j.returned, 'unique', new Set(ids).size, 'total_in_area', j.total_in_area);
  await c.close();
})().catch(e => { console.error(e); process.exit(1); });
