// client.js — the one door to housesigma.com/bkv2/api. post(path, body, auth) merges {lang, province}, signs,
// encrypts, sends with the browser-shaped headers, decrypts, checks the envelope. One request in flight,
// min spacing between requests, one retry on a stale secret (940) after refreshing it.
'use strict';
const { defaults } = require('../config');
const { getBundle } = require('./bundle');
const { ts10, sign, encryptBody, decryptData } = require('./crypto');

const CODES = { HTTP_ERROR: -100, COMMON: 0, SERVER_ERROR: 503, ACCESS_TOKEN_INVALID: 900, LOGIN_REQUIRED: 910, AUTH_TOKEN_INVALID: 920, SECRET_KEY_INVALID: 940 };

class HsError extends Error {
  constructor(message, { code, path, data } = {}) { super(message); this.code = code; this.path = path; this.data = data; }
}

// Guard rails so heavy use stays human-paced and stops at the first sign of pushback:
//   random gaps, periodic rests, a daily request cap, and a breaker that trips on 403/429/captcha/5xx and
//   stays tripped (data/guard.json) until cleared by hand.
const fs = require('fs');
const path = require('path');
const { paths } = require('../config');
const GUARD = path.join(paths.data, 'guard.json');
const rand = ([a, b]) => a + Math.random() * (b - a);
const today = () => new Date().toLocaleDateString('en-CA');
function readGuard() { try { return JSON.parse(fs.readFileSync(GUARD, 'utf8')); } catch { return {}; } }
function writeGuard(g) { try { fs.writeFileSync(GUARD, JSON.stringify(g, null, 2)); } catch {} }
function trip(reason) { const g = readGuard(); g.tripped = { at: new Date().toISOString(), reason }; writeGuard(g); }
function checkGuard() {
  const g = readGuard();
  if (g.tripped) throw new HsError(`Paused: HouseSigma pushed back (${g.tripped.reason}, ${g.tripped.at}). Wait a day, then delete data/guard.json to resume.`, { code: CODES.HTTP_ERROR });
  const cap = Number(process.env.HS_DAILY_CAP) || defaults.dailyCap;
  if (g.day !== today()) { g.day = today(); g.count = 0; }
  if (g.count >= cap) throw new HsError(`Daily limit of ${cap} HouseSigma requests reached. It resets tomorrow.`, { code: CODES.HTTP_ERROR });
  g.count = (g.count || 0) + 1; writeGuard(g);
}

let chain = Promise.resolve();
let lastAt = 0, sinceBreak = 0, nextBreak = rand(defaults.breakEvery);
function serialize(fn) {
  const run = chain.then(async () => {
    checkGuard();
    if (++sinceBreak >= nextBreak) { sinceBreak = 0; nextBreak = rand(defaults.breakEvery); await new Promise(r => setTimeout(r, rand(defaults.breakMs))); }
    const gap = Math.max(defaults.minSpacingMs, rand(defaults.spacingMs));
    const wait = gap - (Date.now() - lastAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try { return await fn(); } finally { lastAt = Date.now(); }
  });
  chain = run.catch(() => {});
  return run;
}

function headers(auth, bundle, extra = {}) {
  const h = {
    'Content-Type': 'application/json;charset=UTF-8',
    Accept: 'application/json, text/plain, */*',
    'HS-Client-Type': defaults.clientType,
    'HS-Client-Version': bundle.clientVersion,
    'User-Agent': defaults.userAgent,
    Origin: 'https://housesigma.com',
    Referer: 'https://housesigma.com/',
    ...extra,
  };
  if (auth?.token) h.Authorization = `Bearer ${auth.token}`;
  if (auth?.userId) h['HS-User-Id'] = String(auth.userId);
  return h;
}

/**
 * Raw POST. auth = { token, userId, secret:{secret_key,is_encrypted}, province }.
 * Returns the parsed envelope { status, data, error, debug } with data already decrypted when applicable.
 */
async function rawPost(path, body = {}, auth = null) {
  const bundle = await getBundle();
  const province = auth?.province || defaults.province;
  let data = { lang: defaults.lang, province, ...body };
  const extra = {};
  let crypt = null;

  const needSign = bundle.signFragments.some(f => path.includes(f.replace(/^\//, '')));
  if (needSign) {
    const ts = ts10();
    data.signature = sign(data, ts, bundle.apiSalt);
    data.ts = ts;
  }
  const needEncrypt = auth?.secret?.is_encrypted === 1 && bundle.encryptPaths.includes(path);
  if (needEncrypt) {
    const ts = ts10();
    crypt = encryptBody({ ...data, hs_request_timestamp: ts }, auth.secret.secret_key, bundle.rsaPublicKeyPem);
    data = crypt.payload;
    extra['Hs-Request-Timestamp'] = ts;
  }

  const res = await fetch(`${defaults.api}${path}`, {
    method: 'POST', headers: headers(auth, bundle, extra), body: JSON.stringify(data),
    signal: AbortSignal.timeout(defaults.timeoutMs),
  });
  const text = await res.text();
  if (res.status === 403 || res.status === 429 || res.status >= 500 || /captcha|cf-chl|access denied|too many requests/i.test(text.slice(0, 2000))) {
    trip(`HTTP ${res.status} on ${path}`);
    throw new HsError(`HouseSigma refused the request (HTTP ${res.status}). Paused all requests; see data/guard.json.`, { code: CODES.HTTP_ERROR, path });
  }
  let env;
  try { env = JSON.parse(text); }
  catch { throw new HsError(`HTTP ${res.status} non-JSON from ${path}: ${text.slice(0, 200)}`, { code: CODES.HTTP_ERROR, path }); }
  if (crypt && env.status && typeof env.data === 'string') {
    env.data = decryptData(env.data, crypt.key, crypt.counter);
  }
  return env;
}

/**
 * post() with envelope checking. Throws HsError with the server's own error.message and code.
 * `authProvider` = { get(): auth, refreshSecret(): Promise<auth>, invalidate(): void }
 */
async function post(path, body, authProvider, { retry = true } = {}) {
  return serialize(async () => {
    const auth = authProvider ? await authProvider.get() : null;
    let env = await rawPost(path, body, auth);
    if (!env.status) {
      const code = env.error?.code;
      if (code === CODES.SECRET_KEY_INVALID && retry && authProvider?.refreshSecret) {
        await authProvider.refreshSecret();
        env = await rawPost(path, body, await authProvider.get());
      } else if ([CODES.ACCESS_TOKEN_INVALID, CODES.LOGIN_REQUIRED, CODES.AUTH_TOKEN_INVALID].includes(code)) {
        authProvider?.invalidate?.();
        throw new HsError(`${env.error?.message || 'session invalid'} (code ${code}). Run the login tool.`, { code, path, data: env.data });
      }
    }
    if (!env.status) {
      throw new HsError(env.error?.message || 'request failed', { code: env.error?.code, path, data: env.data });
    }
    return env.data;
  });
}

module.exports = { post, rawPost, HsError, CODES };
