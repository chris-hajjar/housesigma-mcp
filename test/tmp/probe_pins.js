const { post } = require('../../src/hs/client'); const { authProvider } = require('../../src/hs/session');
(async () => {
  const bounds = { lat1: 43.63434, lon1: -79.4286157, lat2: 43.6423101, lon2: -79.4105379 };
  const body = { ...bounds, zoom: 15, list_type: [2], house_type: ['all'], price: [0, 3000], bedroom_range: [1], bathroom_min: 0, garage_min: 0, basement: [], square_footage: [0, 4000], open_house_date: 0, front_feet: [0, 100], max_maintenance_fee: 0, description: '', listing_type: ['all'], listing_days: 0, de_list_days: 90, sold_days: 90, rent_list_type: [2] };
  const P = (p, b) => post(p, b, authProvider);
  const pins = await P('/search/mapsearchv3/listing', body);
  const ids = [].concat(...(pins.list || []).map(c => c.ids || []));
  console.log('pins clusters', (pins.list || []).length, 'ids', ids.length, 'unique', new Set(ids).size, 'sample cluster', JSON.stringify(pins.list?.[0]).slice(0, 300));
  const pins2 = await P('/search/mapsearchv3/listing', body);
  const ids2 = [].concat(...(pins2.list || []).map(c => c.ids || []));
  console.log('second call ids', ids2.length, 'same set?', ids.length === ids2.length && ids.every(i => ids2.includes(i)));
  const list = await P('/search/mapsearchv3/list', { ...body, page: 1 });
  console.log('list total', list.total, 'rowCount', list.rowCount);
  const many = await P('/listing/preview/many', { id_listing: ids.slice(0, 60) });
  console.log('preview/many asked', Math.min(60, ids.length), 'got', (many.houseList || []).length, 'keys', Object.keys(many.houseList?.[0] || {}).slice(0, 12).join(','));
  const many2 = await P('/listing/preview/many', { id_listing: ids.slice(0, 200) });
  console.log('preview/many asked', Math.min(200, ids.length), 'got', (many2.houseList || []).length);
})().catch(e => console.error('ERR', e.message));
