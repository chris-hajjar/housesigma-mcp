const { rawPost } = require('../../src/hs/client');
const { anonymousAuth } = require('../../src/hs/session');
(async () => {
  const auth = await anonymousAuth();
  const env = await rawPost('/listing/info/detail_v2', { id_listing: '10QqypNg9W53LGlV', id_address: '', event_source: '' }, auth);
  require('fs').writeFileSync(process.env.SCRATCH + '/detail_v2.json', JSON.stringify(env, null, 2));
  const d = env.data;
  const shape = (o, depth = 0) => {
    if (Array.isArray(o)) return `[${o.length}]` + (o[0] && typeof o[0] === 'object' && depth < 2 ? '{' + Object.keys(o[0]).slice(0, 25).join(',') + '}' : '');
    if (o && typeof o === 'object') return depth < 1 ? '{' + Object.entries(o).map(([k, v]) => k + ':' + shape(v, depth + 1)).join(', ') + '}' : '{' + Object.keys(o).slice(0, 30).join(',') + '}';
    return typeof o;
  };
  for (const [k, v] of Object.entries(d)) console.log(k, '=>', shape(v).slice(0, 700));
})().catch(e => { console.error(e); process.exit(1); });
