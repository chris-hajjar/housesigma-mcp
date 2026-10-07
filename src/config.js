// config.js — paths and defaults. Everything lives inside the project folder (data/), nothing in hidden home dirs.
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.HS_DATA_DIR ? path.resolve(process.env.HS_DATA_DIR) : path.join(ROOT, 'data');

const paths = {
  root: ROOT,
  data: DATA_DIR,
  session: path.join(DATA_DIR, 'session.json'),
  bundle: path.join(DATA_DIR, 'bundle.json'),
  chromeProfile: path.join(DATA_DIR, 'chrome-profile'),
  listings: path.join(DATA_DIR, 'listings'),
  searches: path.join(DATA_DIR, 'searches.json'),
  snapshots: path.join(DATA_DIR, 'snapshots'),
  exports: process.env.HS_EXPORT_DIR ? path.resolve(process.env.HS_EXPORT_DIR) : path.join(DATA_DIR, 'exports'),
  photos: path.join(DATA_DIR, 'photos'),
  filters: path.join(DATA_DIR, 'filters.json'),
};

for (const p of [paths.data, paths.listings, paths.snapshots, paths.exports, paths.photos]) {
  fs.mkdirSync(p, { recursive: true });
}

const defaults = {
  province: (process.env.HS_PROVINCE || 'ON').toUpperCase(),
  lang: 'en_US',
  base: 'https://housesigma.com/bkv2',
  api: 'https://housesigma.com/bkv2/api',
  // Captured from the public web bundle 2026-09-23 (index.2aec82b5.js). bundle.js refreshes these live.
  clientType: 'desktop_v7',
  clientVersion: '7.22.40',
  apiSalt: 'ZckdTeV3kGyZd80q',
  rsaPublicKeyPem:
    '-----BEGIN PUBLIC KEY-----\n' +
    'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDQlOcjEbqprurl2xjoEP0QdjGI\n' +
    'rZhLVn5vzwCorG4+2AtSi4AAHjghSXM//ljqE5rA13gfTc58JvM6I75Dmqr5r5Vv\n' +
    'o57CAbxBXHsXu5ojtgvb5rOd2lrZeckwJL0Z7euvRsA/FjbFdGMcGeSJ8JoePq+H\n' +
    '0RFOt285bSb8hVq0LQIDAQAB\n' +
    '-----END PUBLIC KEY-----',
  // Endpoints the web client signs (md5) and encrypts (AES-CTR). Read from the bundle: needSignApi / ou[].
  signPaths: ['/listing/info/detail_v2', '/search/mapsearchv3/list', '/search/mapsearchv3/listing'],
  encryptPaths: [
    '/listing/info/detail_v2', '/listing/info/popularity', '/listing/preview/many',
    '/search/mapsearchv3/list', '/stats/trend/trendHouseList', '/search/homepage/recommendlist_v2',
  ],
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  minSpacingMs: 400,          // floor; actual gap is random between spacingMs[0] and spacingMs[1]
  spacingMs: [700, 1600],
  breakEvery: [120, 240],     // after this many requests, rest for breakMs
  breakMs: [20000, 60000],
  dailyCap: 3000,             // requests per local day; raise with HS_DAILY_CAP
  timeoutMs: 15000,
  listingCacheMs: 24 * 60 * 60 * 1000,
  searchCacheMs: 10 * 60 * 1000,
  bundleCacheMs: 24 * 60 * 60 * 1000,
  loginTimeoutMs: 5 * 60 * 1000,
};

module.exports = { paths, defaults };
