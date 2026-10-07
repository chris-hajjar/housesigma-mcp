const { rawPost } = require('../../src/hs/client');
const { anonymousAuth } = require('../../src/hs/session');
const S = process.env.SCRATCH;
(async () => {
  const auth = await anonymousAuth();
  let env = await rawPost('/search/address_v2/suggest', { province: 'ON', search_term: 'liberty village' }, auth);
  require('fs').writeFileSync(S + '/suggest.json', JSON.stringify(env, null, 2));
  for (const [k, v] of Object.entries(env.data)) if (Array.isArray(v)) console.log('suggest', k, v.length, v[0] ? JSON.stringify(v[0]).slice(0, 500) : '');
  // Toronto downtown-west bounds, rentals, defaults from the bundle's Ai()
  const body = {
    lat1: 43.6300, lon1: -79.4300, lat2: 43.6600, lon2: -79.3900, zoom: 14, page: 1,
    list_type: [2], house_type: ['all'], price: [0, 10000], bedroom_range: [0], bathroom_min: 0, garage_min: 0,
    basement: [], square_footage: [0, 4000], open_house_date: 0, front_feet: [0, 100], max_maintenance_fee: 0,
    description: '', listing_days: 0, rent_list_type: [2], de_list_days: 90, sold_days: 90, listing_type: ['all'],
  };
  env = await rawPost('/search/mapsearchv3/list', body, auth);
  require('fs').writeFileSync(S + '/mapsearch.json', JSON.stringify(env, null, 2));
  console.log('\nmapsearch status', env.status, env.error);
  if (env.status) {
    console.log('keys', Object.keys(env.data));
    const list = env.data.list || env.data.houseList || [];
    console.log('count', list.length, 'total', env.data.total, 'page', env.data.page, 'pages', env.data.pages ?? env.data.total_page);
    if (list[0]) console.log('row keys', Object.keys(list[0]).join(','));
    if (list[0]) console.log(JSON.stringify(list[0]).slice(0, 900));
  } else console.log(JSON.stringify(env.data).slice(0, 500));
})().catch(e => { console.error(e); process.exit(1); });
