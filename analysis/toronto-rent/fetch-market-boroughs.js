// Extend market.json with the former boroughs (separate HouseSigma municipalities): Etobicoke, North York, Scarborough, East York, York.
process.chdir(process.env.HOME + '/Desktop/housesigma-mcp');
const R = p => require(process.env.HOME + '/Desktop/housesigma-mcp/src/' + p);
const fs = require('fs');
const { post } = R('hs/client'); const { authProvider } = R('hs/session'); const { resolvePlace } = R('tools/find');
(async () => {
  const api = { post: (p, b) => post(p, b, authProvider) };
  const out = JSON.parse(fs.readFileSync('analysis/toronto-rent/market.json'));
  out.boroughs = out.boroughs || {};
  for (const name of ['Etobicoke', 'North York', 'Scarborough', 'East York', 'York']) {
    const { best, candidates } = await resolvePlace(api, name, 'ON');
    const city = candidates.find(c => c.kind === 'city' && c.name === name) || (best && best.id_municipality ? best : null);
    if (!city?.id_municipality) { console.error('no municipality id for', name); continue; }
    const s = await api.post('/stats/trend/summary', { municipality: city.id_municipality, house_type: 'C.' });
    const c = await api.post('/stats/trend/chart', { municipality: city.id_municipality, house_type: 'C.' });
    out.boroughs[name] = { id: city.id_municipality, chart: c.chart, communities: {} };
    const comms = (s.community_filter || []).filter(x => x.id !== 'all');
    for (const cm of comms) {
      try { const ch = await api.post('/stats/trend/chart', { municipality: city.id_municipality, community: cm.id, house_type: 'C.' }); out.communities[cm.name] = { id: cm.id, municipality: name, chart: ch.chart, mix: ch.chart_house_type }; }
      catch (e) { out.communities[cm.name] = { id: cm.id, municipality: name, error: e.message }; }
    }
    console.error(name, city.id_municipality, comms.length, 'communities');
  }
  for (const k of Object.keys(out.communities)) if (!out.communities[k].municipality) out.communities[k].municipality = 'Toronto';
  fs.writeFileSync('analysis/toronto-rent/market.json', JSON.stringify(out));
  console.log('communities total', Object.keys(out.communities).length);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
