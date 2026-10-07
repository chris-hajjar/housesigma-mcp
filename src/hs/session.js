// session.js — your HouseSigma session, Gmail login included. Port of domain-mcp/session.js with two changes:
// the credential is a Bearer access_token (read from localStorage / storeAsyc_desk cookie), not a cookie,
// and Chrome runs with a PERSISTENT profile in data/chrome-profile so Google's sign-in accepts it and
// you only log in once.
//
// Resolution order:
//   1. HS_ACCESS_TOKEN env (remote / override) — validated
//   2. data/session.json — validated with POST /init/accesstoken/check (user must be bound)
//   3. Browser login (installed Chrome via playwright-core, persistent profile), token captured, saved
//   4. login({access_token}) — pasted token, validated, saved
//
// All human-facing output goes to stderr; stdout is the MCP channel.
'use strict';
const fs = require('fs');
const { paths, defaults } = require('../config');
const { rawPost } = require('./client');

let mem = null; // { token, userId, user, secret, province, saved_at, source, ua }
let capturedUa = null;
function setUserAgent(ua) { capturedUa = ua; defaults.userAgent = ua; }
// HouseSigma serves sold/leased details only when requests carry the same browser identity the session
// signed in with. Hosted, there is no login browser, so take it from HS_USER_AGENT (or from the hand-off page).
if (process.env.HS_USER_AGENT) setUserAgent(process.env.HS_USER_AGENT);

function load() {
  try { return JSON.parse(fs.readFileSync(paths.session, 'utf8')); } catch { return null; }
}
function save(s) {
  fs.writeFileSync(paths.session, JSON.stringify(s, null, 2), { mode: 0o600 });
}
function clear() {
  mem = null;
  try { fs.unlinkSync(paths.session); } catch { /* gone */ }
}

/** Ask the server about a token. Returns { valid, bound, user, secret, province, agent, vow_agent } */
async function check(token) {
  const env = await rawPost('/init/accesstoken/check', { access_token: token }, { token });
  if (!env.status) return { valid: false, bound: false, error: env.error, server: env.debug?.server };
  const d = env.data;
  return { valid: true, bound: !!d.user, user: d.user, secret: d.secret, province: d.province, agent: d.agent, vow_agent: d.vow_agent, is_hs_employee: d.is_hs_employee, server: env.debug?.server };
}

/** check() with retries: right after sign-in the user binding can lag across HouseSigma's API servers. */
async function checkBound(token, { tries = 5, delayMs = 1500 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await check(token);
    if (last.valid && last.bound) return last;
    if (!last.valid && last.error?.code && last.error.code !== 0) break; // hard reject, no point retrying
    await new Promise(r => setTimeout(r, delayMs));
  }
  return last;
}

function toSession(token, chk, source) {
  return {
    token,
    userId: chk.user?.user_id || chk.user?.id || null,
    user: chk.user ? { name: chk.user.name || chk.user.nickname || null, email: chk.user.email || null, phone: chk.user.phone || null, province: chk.user.province || null, lang: chk.user.lang || null } : null,
    secret: chk.secret,
    province: chk.province || chk.user?.province || defaults.province,
    vow_agent: chk.vow_agent || null,
    saved_at: new Date().toISOString(),
    source,
    ua: capturedUa || undefined,
  };
}

async function browserLogin() {
  let chromium;
  try { ({ chromium } = require('playwright-core')); }
  catch { throw new Error('playwright-core unavailable. Run `npm install` in the project folder, or pass access_token to login.'); }

  console.error('\n🔐 No valid HouseSigma session. Opening Chrome — click "Sign In" and continue with Google.');
  console.error('   Login is detected automatically (waiting up to 5 min)...\n');

  let ctx, lastErr;
  for (const channel of ['chrome', 'msedge']) {
    try {
      ctx = await chromium.launchPersistentContext(paths.chromeProfile, {
        channel, headless: false, viewport: null,
        args: ['--window-size=1200,900', '--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
      });
      break;
    } catch (e) { lastErr = e; }
  }
  if (!ctx) throw new Error(`Could not open Chrome/Edge for login (${lastErr?.message}). Pass access_token to login instead.`);

  const page = ctx.pages()[0] || await ctx.newPage();
  try {
    await page.goto(`https://housesigma.com/${defaults.province.toLowerCase()}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const ua = await page.evaluate(() => navigator.userAgent).catch(() => null);
    if (ua) setUserAgent(ua);
    // Keep the window open until NODE confirms the token is bound to a user (the page's own view can be misleading).
    const deadline = Date.now() + defaults.loginTimeoutMs;
    let lastTok = null, lastChk = null, ticks = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      if (page.isClosed()) throw new Error('Login window was closed before sign-in completed.');
      const tok = await page.evaluate(() => (localStorage.getItem('access_token') || '').replace(/^"|"$/g, '')).catch(() => '');
      if (tok && tok !== lastTok) { lastTok = tok; lastChk = null; }
      if (tok && ticks++ % 2 === 0) {
        lastChk = await check(tok).catch(() => null);
        if (lastChk?.valid && lastChk.bound) {
          console.error(`✓ Signed in as ${lastChk.user?.email || lastChk.user?.name || 'user'} — closing browser.\n`);
          await page.waitForTimeout(1000);
          return tok;
        }
      }
    }
    throw new Error(`Timed out waiting for sign-in (${Math.round(defaults.loginTimeoutMs / 60000)} min). Last check: ${lastChk ? `valid=${lastChk.valid} bound=${lastChk.bound}` : 'none'}.`);
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Returns the session. opts: { force, access_token, interactive }
 * interactive defaults to FALSE: only the login tool passes interactive:true, so no other tool can ever open a browser.
 */
async function getSession(opts = {}) {
  if (mem && !opts.force && !opts.access_token) return mem;

  if (opts.access_token) {
    if (opts.ua) setUserAgent(opts.ua);
    const chk = await checkBound(opts.access_token, { tries: 3 });
    if (!chk.valid || !chk.bound) throw new Error(`That access_token is ${chk.valid ? 'not signed in (anonymous)' : `invalid (${chk.error?.message || 'rejected'})`}.`);
    mem = toSession(opts.access_token, chk, 'pasted'); save(mem); return mem;
  }

  const envTok = process.env.HS_ACCESS_TOKEN;
  if (envTok && !opts.force) {
    const chk = await check(envTok);
    if (chk.valid && chk.bound) { mem = toSession(envTok, chk, 'env'); return mem; }
    console.error('⚠ HS_ACCESS_TOKEN is invalid or anonymous — falling back.');
  }

  const cached = opts.force ? null : load();
  if (cached?.ua) setUserAgent(cached.ua); // the identity saved with the session wins over HS_USER_AGENT
  if (cached?.token) {
    const chk = await check(cached.token);
    if (chk.valid && chk.bound) { mem = { ...toSession(cached.token, chk, 'cached'), saved_at: cached.saved_at }; save(mem); return mem; }
    clear();
  }

  if (!opts.interactive) throw new Error('no cached session (run the login tool)');
  const fresh = await browserLogin();
  const chk = await checkBound(fresh);
  if (!chk.valid || !chk.bound) throw new Error(`Captured token failed validation (valid=${chk.valid}, bound=${chk.bound}, server=${chk.server || '?'}${chk.error?.message ? `, error=${chk.error.message}` : ''}). Try login again, or pass access_token from DevTools.`);
  mem = toSession(fresh, chk, 'login'); save(mem); return mem;
}

/** Provider used by client.post(): current auth, secret refresh, invalidation. */
const authProvider = {
  async get() {
    const s = mem || await getSession();
    return { token: s.token, userId: s.userId, secret: s.secret, province: s.province };
  },
  async refreshSecret() {
    const s = mem || await getSession();
    const env = await rawPost('/init/accesstoken/refresh', {}, { token: s.token, userId: s.userId });
    if (env.status && env.data?.secret) { s.secret = env.data.secret; mem = s; save(s); }
    return this.get();
  },
  invalidate() { clear(); },
};

/** Anonymous auth for read probes / tests (no user bound). */
async function anonymousAuth() {
  const env = await rawPost('/init/accesstoken/new', {});
  if (!env.status) throw new Error(`accesstoken/new failed: ${env.error?.message}`);
  return { token: env.data.access_token, secret: env.data.secret, province: defaults.province };
}

module.exports = { getSession, check, checkBound, clear, authProvider, anonymousAuth, setUserAgent };
