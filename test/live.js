#!/usr/bin/env node
// test/live.js — live probes against housesigma.com.
//   node test/live.js crypto            anonymous token -> signed+encrypted detail_v2 on a sitemap listing (step 0)
//   node test/live.js login             run the session flow (opens Chrome if needed), print who you are
//   node test/live.js search "Liberty Village"   signed-in map search, rentals
'use strict';
const { rawPost } = require('../src/hs/client');
const { anonymousAuth, getSession } = require('../src/hs/session');
const { getBundle } = require('../src/hs/bundle');

async function sitemapListing() {
  const xml = await (await fetch('https://housesigma.com/bkv2/sitemap/live-v3-0.xml')).text();
  const m = xml.match(/\/home\/([A-Za-z0-9]+)\//);
  if (!m) throw new Error('no listing in sitemap');
  return m[1];
}

async function crypto() {
  const b = await getBundle();
  console.log('bundle:', { version: b.clientVersion, salt: b.apiSalt.slice(0, 4) + '…', source: b.source, stale: b.stale });
  const auth = await anonymousAuth();
  console.log('anon token:', auth.token.slice(0, 10) + '…', 'encrypted:', auth.secret.is_encrypted);
  const id = await sitemapListing();
  console.log('listing:', id);
  const env = await rawPost('/listing/info/detail_v2', { id_listing: id, id_address: '', event_source: '' }, auth);
  console.log('status:', env.status, 'error:', env.error);
  if (env.status) {
    const h = env.data.house || {};
    console.log('house:', { address: h.address, municipality: h.municipality_name, price: h.price, status: h.list_status, type: h.house_type_name });
    console.log('top-level keys:', Object.keys(env.data));
    console.log('history rows:', (env.data.listing_history || []).length);
  } else {
    console.log('raw data:', JSON.stringify(env.data).slice(0, 400));
    process.exitCode = 1;
  }
}

async function login() {
  const s = await getSession({ force: process.argv.includes('--force'), interactive: true });
  console.log({ source: s.source, user: s.user, province: s.province, secret_expires: new Date(s.secret.expired_at * 1000).toISOString(), vow_agent: s.vow_agent });
}

async function main() {
  const [cmd] = process.argv.slice(2);
  if (cmd === 'crypto') return crypto();
  if (cmd === 'login') return login();
  console.log('usage: node test/live.js crypto | login [--force]');
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
