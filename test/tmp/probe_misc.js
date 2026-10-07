const { rawPost } = require('../../src/hs/client');
const { anonymousAuth } = require('../../src/hs/session');
const fs = require('fs'); const S = process.env.SCRATCH;
const ID = 'B5bO3x88dxg3kWVP'; // 125 Blue Jays Way parking, for lease (from mapsearch probe)
const probes = [
  ['/listing/info/photos', { id_listing: ID }],
  ['/listing/nearby/rent', { id_listing: ID }],
  ['/listing/nearby/sale', { id_listing: ID }],
  ['/listing/nearby/sold', { id_listing: ID }],
  ['/listing/info/popularity', { id_listing: ID }],
  ['/listing/info/analytics', { id_listing: ID }],
  ['/listing/preview/many', { id_listing: [ID, '10QqypNg9W53LGlV'] }],
  ['/search/mapsearchv3/listing', { lat1: 43.63, lon1: -79.43, lat2: 43.66, lon2: -79.39, zoom: 14, list_type: [2], house_type: ['all'], price: [0, 10000], bedroom_range: [0], bathroom_min: 0, garage_min: 0, basement: [], square_footage: [0, 4000], listing_days: 0, description: '', open_house_date: 0, front_feet: [0, 100], max_maintenance_fee: 0, de_list_days: 90, sold_days: 90, listing_type: ['all'] }],
  ['/stats/trend/summary', { municipality: 10343, house_type: 'all' }],
  ['/stats/trend/chart', { municipality: 10343, house_type: 'all' }],
  ['/stats/trend/citysummary', { slug: 'toronto-real-estate', list_type: [1] }],
  ['/stats/rentratio', {}],
  ['/stats/pricegrowth', {}],
  ['/stats/demographic', { id_listing: ID }],
  ['/stats/report', {}],
  ['/search/preconmap/filter', {}],
  ['/search/preconmap/projects', { lat1: 43.63, lon1: -79.43, lat2: 43.66, lon2: -79.39, zoom: 14, project_status: [1], property_type: ['all'], construction_status: ['all'], est_completion_year: ['all'], price: [0, 6000000], bedroom_range: [0], bathroom_min: 0, garage_min: 0, description: '', square_footage: [0, 4000] }],
  ['/community/list/init', {}],
];
(async () => {
  const auth = await anonymousAuth();
  const out = {};
  for (const [p, b] of probes) {
    try {
      const env = await rawPost(p, b, auth);
      out[p] = env;
      const d = env.data;
      const shape = d && typeof d === 'object' ? Object.entries(d).map(([k, v]) => `${k}:${Array.isArray(v) ? `[${v.length}]` + (v[0] && typeof v[0] === 'object' ? '{' + Object.keys(v[0]).slice(0, 14).join(',') + '}' : '') : (v && typeof v === 'object' ? '{' + Object.keys(v).slice(0, 14).join(',') + '}' : typeof v)}`).join(' | ') : String(d);
      console.log(`\n${p} -> ${env.status} ${env.error?.message || ''}\n   ${shape.slice(0, 700)}`);
    } catch (e) { console.log(`\n${p} -> THREW ${e.message}`); }
  }
  fs.writeFileSync(S + '/misc_probes.json', JSON.stringify(out, null, 1));
})();
