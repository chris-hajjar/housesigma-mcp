const { rawPost } = require('../../src/hs/client');
const { anonymousAuth } = require('../../src/hs/session');
(async () => {
  const auth = await anonymousAuth();
  const env = await rawPost('/search/address_v2/suggest', { province: 'ON', search_term: 'liberty village' }, auth);
  console.log('status', env.status, env.error);
  const d = env.data;
  console.log('keys', Object.keys(d));
  for (const [k, v] of Object.entries(d)) if (Array.isArray(v)) console.log(k, v.length, JSON.stringify(v[0]).slice(0, 600));
})().catch(e => { console.error(e); process.exit(1); });
