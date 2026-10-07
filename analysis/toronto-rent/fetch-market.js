// Pull HouseSigma's own monthly market series for every Toronto community (24 months, condo apts + all types).
// ~70 requests. Output: analysis/toronto-rent/market.json
process.chdir(process.env.HOME + '/Desktop/housesigma-mcp');
const R = p => require(process.env.HOME + '/Desktop/housesigma-mcp/src/' + p);
const fs = require('fs');
const { post } = R('hs/client'); const { authProvider } = R('hs/session');
(async () => {
  const api = { post: (p, b) => post(p, b, authProvider) };
  const out = { fetched_at: new Date().toISOString(), municipality: 10343, communities: {}, city: {} };
  const s = await api.post('/stats/trend/summary', { municipality: 10343, house_type: 'C.' });
  const comms = (s.community_filter || []).filter(c => c.id !== 'all');
  for (const ht of ['C.', 'all']) {
    const c = await api.post('/stats/trend/chart', { municipality: 10343, house_type: ht });
    out.city[ht] = c.chart;
  }
  let n = 0;
  for (const c of comms) {
    try {
      const ch = await api.post('/stats/trend/chart', { municipality: 10343, community: c.id, house_type: 'C.' });
      out.communities[c.name] = { id: c.id, chart: ch.chart, mix: ch.chart_house_type };
    } catch (e) { out.communities[c.name] = { id: c.id, error: e.message }; }
    if (++n % 10 === 0) console.error(n, '/', comms.length);
  }
  fs.writeFileSync('analysis/toronto-rent/market.json', JSON.stringify(out));
  console.log('communities', Object.keys(out.communities).length, 'months', out.city['C.'].length, out.city['C.'][0].period, '->', out.city['C.'].at(-1).period);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
