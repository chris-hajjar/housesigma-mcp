// Runs Toronto-wide leased pulls sequentially using the MCP's own modules (same signing, tiling, pacing).
process.chdir(process.env.HOME + '/Desktop/housesigma-mcp');
const R = p => require(process.env.HOME + '/Desktop/housesigma-mcp/src/' + p);
const { post } = R('hs/client');
const { authProvider } = R('hs/session');
const pull = R('pull');
const { buildBody, filtersVocab } = R('tools/find');
const bounds = { lat1: 43.58, lon1: -79.64, lat2: 43.86, lon2: -79.11 };
const cols = ['id','address','area','type','status','price','sold_price','vs_asking_pct','beds','baths','parking','sqft','listed','days_on_market','ended','ended_days_ago','mls','lat','lon','postal','estimate','url'];
(async () => {
  await authProvider.get();
  const api = { post: (p, b) => post(p, b, authProvider) };
  const vocab = await filtersVocab(api).catch(() => null);
  for (const period of (process.argv[2] || 'ytd,2025').split(',')) {
    const query = { mode: 'leased', period, beds_min: 1, beds_max: 2, where: 'toronto-' + period };
    const j = await pull.startPull({ api, query, bounds, area: 'Toronto box ' + period, buildBody, filters: vocab, columns: cols });
    console.log('started', JSON.stringify(j));
    while (true) {
      await new Promise(r => setTimeout(r, 30000));
      const s = pull.status(j.id);
      console.log(new Date().toISOString(), s.status, s.rows_written, '/', s.expected_rows, 'tiles', s.tiles_pending, 'eta', s.eta_s);
      if (s.status !== 'running') { console.log('DONE', JSON.stringify(s)); break; }
    }
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
