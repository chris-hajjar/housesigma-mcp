// Background pull: every 1-2 bedroom lease in the City of Toronto (former boroughs included) for calendar 2025.
process.chdir(process.env.HOME + '/Desktop/housesigma-mcp');
const R = p => require(process.env.HOME + '/Desktop/housesigma-mcp/src/' + p);
const { post } = R('hs/client'); const { authProvider } = R('hs/session'); const pull = R('pull');
const { buildBody, filtersVocab } = R('tools/find');
const bounds = { lat1: 43.58, lon1: -79.64, lat2: 43.855, lon2: -79.115 };
const cols = ['id','address','area','type','status','price','sold_price','vs_asking_pct','beds','baths','parking','sqft','listed','days_on_market','ended','ended_days_ago','mls','lat','lon','postal','estimate','url'];
(async () => {
  await authProvider.get();
  const api = { post: (p, b) => post(p, b, authProvider) };
  const vocab = await filtersVocab(api).catch(() => null);
  const query = { mode: 'leased', period: '2025', beds_min: 1, beds_max: 2, where: 'toronto-2025' };
  const j = await pull.startPull({ api, query, bounds, area: 'City of Toronto 2025', buildBody, filters: vocab, columns: cols });
  console.log(new Date().toISOString(), 'started', j.id, 'expected', j.expected_rows);
  while (true) {
    await new Promise(r => setTimeout(r, 60000));
    const s = pull.status(j.id);
    console.log(new Date().toISOString(), s.status, s.rows_written, '/', s.expected_rows, 'tiles', s.tiles_pending, 'req', s.requests, 'eta_s', s.eta_s);
    if (s.status !== 'running') { console.log('DONE', JSON.stringify(s)); break; }
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
