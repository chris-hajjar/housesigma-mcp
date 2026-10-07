// bundle.js — read the live web bundle for the values that drift on deploys (client version, api salt,
// signed/encrypted path lists). Cached 24h in data/bundle.json; falls back to config defaults and flags it.
'use strict';
const fs = require('fs');
const { paths, defaults } = require('../config');

let mem = null;

function loadCache() {
  try {
    const j = JSON.parse(fs.readFileSync(paths.bundle, 'utf8'));
    if (j && j.fetched_at && Date.now() - Date.parse(j.fetched_at) < defaults.bundleCacheMs) return j;
  } catch { /* none */ }
  return null;
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': defaults.userAgent }, signal: AbortSignal.timeout(defaults.timeoutMs) });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.text();
}

function parseBundle(js) {
  const out = {};
  const ver = js.match(/"HS-Client-Version":"([0-9.]+)"/);
  if (ver) out.clientVersion = ver[1];
  // et={...,apiSalt:c_,...} then c_="..." somewhere in the file.
  const saltVar = js.match(/apiSalt:([A-Za-z_$][\w$]*)[,}]/);
  if (saltVar) {
    const v = js.match(new RegExp(`[,;\\s]${saltVar[1].replace(/\$/g, '\\$')}="([^"]{8,64})"`));
    if (v) out.apiSalt = v[1];
  }
  const sign = js.match(/needSignApi:\[([^\]]*)\]/);
  if (sign) out.needSignApi = sign[1].split(',').map(s => s.replace(/"/g, '').trim()).filter(Boolean);
  const enc = js.match(/const [\w$]+=\[("\/listing\/info\/detail_v2"[^\]]*)\]/);
  if (enc) out.encryptPaths = enc[1].split(',').map(s => s.replace(/"/g, '').trim()).filter(Boolean);
  const pem = js.match(/"(-----BEGIN PUBLIC KEY----- [^"]+-----END PUBLIC KEY-----)"/);
  if (pem) out.rsaPublicKeyPem = pem[1].replace(/ /g, '\n').replace(/BEGIN\nPUBLIC\nKEY/, 'BEGIN PUBLIC KEY').replace(/END\nPUBLIC\nKEY/, 'END PUBLIC KEY');
  return out;
}

async function refresh() {
  const home = await fetchText(`${defaults.base.replace('/bkv2', '')}/on/`);
  const m = home.match(/src="(\/assets\/index\.[a-z0-9]+\.js)"/);
  if (!m) throw new Error('index bundle not found on homepage');
  const js = await fetchText(`https://housesigma.com${m[1]}`);
  const parsed = parseBundle(js);
  if (!parsed.clientVersion || !parsed.apiSalt) throw new Error('bundle parse failed (version/salt)');
  const rec = { ...parsed, bundle_path: m[1], fetched_at: new Date().toISOString() };
  fs.writeFileSync(paths.bundle, JSON.stringify(rec, null, 2));
  return rec;
}

/** Returns { clientVersion, apiSalt, signPaths, encryptPaths, rsaPublicKeyPem, stale:boolean, source }. */
async function getBundle({ force = false } = {}) {
  if (mem && !force) return mem;
  let rec = force ? null : loadCache();
  let source = 'cache';
  if (!rec) {
    try { rec = await refresh(); source = 'live'; }
    catch (e) {
      console.error(`⚠ bundle refresh failed (${e.message}); using captured defaults`);
      rec = null;
    }
  }
  const signPaths = rec?.needSignApi
    ? defaults.signPaths.concat(rec.needSignApi.map(s => s.startsWith('/') ? s : null).filter(Boolean))
    : defaults.signPaths;
  mem = {
    clientVersion: rec?.clientVersion || defaults.clientVersion,
    apiSalt: rec?.apiSalt || defaults.apiSalt,
    // needSignApi holds fragments ("detail_v2"); keep the fragment semantics: a path is signed if it includes any.
    signFragments: rec?.needSignApi || defaults.signPaths,
    signPaths,
    encryptPaths: rec?.encryptPaths || defaults.encryptPaths,
    rsaPublicKeyPem: rec?.rsaPublicKeyPem || defaults.rsaPublicKeyPem,
    stale: !rec,
    source: rec ? source : 'defaults',
    fetched_at: rec?.fetched_at || null,
  };
  return mem;
}

module.exports = { getBundle, parseBundle };
