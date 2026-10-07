// auth.js — single-user OAuth for the remote (HTTP) server, so claude.ai and Claude Desktop can add it like a
// normal connector: paste the URL, click Connect, type your password once.
//
// The MCP SDK does the OAuth plumbing (discovery metadata, client registration, PKCE, token endpoint).
// This file is the small part the SDK leaves to us: a password page, and somewhere to keep clients and tokens.
//
//   MCP_PASSWORD  required. The one password the sign-in page accepts.
//   MCP_BEARER    optional. A fixed token for headless clients (OpenClaw, scripts): Authorization: Bearer <it>.
//
// State lives in data/oauth.json (clients + SHA-256 hashes of tokens, never the tokens themselves), so a redeploy
// with a persistent data/ volume keeps you connected. Codes and pending sign-ins are memory-only (minutes).
'use strict';
const crypto = require('crypto');
const path = require('path');
const { paths } = require('./config');
const { readJson, writeJson } = require('./store');
const { InvalidTokenError, InvalidGrantError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');

const STATE_FILE = path.join(paths.data, 'oauth.json');
const ACCESS_TTL_S = 24 * 60 * 60;          // 1 day; clients refresh silently
const REFRESH_TTL_S = 90 * 24 * 60 * 60;    // 90 days of not using it before you have to sign in again
const CODE_TTL_MS = 5 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;
const FAIL_LIMIT = 5;                       // wrong passwords per IP per window
const FAIL_WINDOW_MS = 15 * 60 * 1000;

const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const now = () => Math.floor(Date.now() / 1000);

function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function createAuth({ password, bearer }) {
  if (!password) throw new Error('MCP_PASSWORD is required');

  const state = readJson(STATE_FILE, { clients: {}, access: {}, refresh: {} });
  for (const k of ['clients', 'access', 'refresh']) state[k] = state[k] || {};
  const save = () => {
    const t = now();
    for (const [h, r] of Object.entries(state.access)) if (r.expiresAt < t) delete state.access[h];
    for (const [h, r] of Object.entries(state.refresh)) if (r.expiresAt < t) delete state.refresh[h];
    writeJson(STATE_FILE, state);
  };

  const codes = new Map();    // code -> { clientId, challenge, redirectUri, scopes, resource, exp }
  const pending = new Map();  // request id -> { clientId, params, exp }
  const fails = new Map();    // ip -> { n, until }

  function issue(clientId, scopes, resource) {
    const access = rand(), refresh = rand();
    const t = now();
    state.access[hash(access)] = { clientId, scopes, resource, expiresAt: t + ACCESS_TTL_S };
    state.refresh[hash(refresh)] = { clientId, scopes, resource, expiresAt: t + REFRESH_TTL_S };
    save();
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopes.join(' ') };
  }

  const provider = {
    clientsStore: {
      getClient: id => state.clients[id],
      registerClient: client => { state.clients[client.client_id] = client; save(); return client; },
    },

    // Show the password page. The OAuth details stay server-side under a one-time id, so the form can't be tampered with.
    async authorize(client, params, res) {
      const id = rand(16);
      pending.set(id, { clientId: client.client_id, params, exp: Date.now() + PENDING_TTL_MS });
      res.status(200).type('html').send(loginPage({ id, clientName: client.client_name }));
    },

    async challengeForAuthorizationCode(client, code) {
      const c = codes.get(code);
      if (!c || c.clientId !== client.client_id || c.exp < Date.now()) throw new InvalidGrantError('Invalid or expired authorization code');
      return c.challenge;
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
      const c = codes.get(code);
      codes.delete(code); // single use
      if (!c || c.clientId !== client.client_id || c.exp < Date.now()) throw new InvalidGrantError('Invalid or expired authorization code');
      if (redirectUri && redirectUri !== c.redirectUri) throw new InvalidGrantError('redirect_uri mismatch');
      return issue(client.client_id, c.scopes, c.resource);
    },

    async exchangeRefreshToken(client, refreshToken) {
      const h = hash(refreshToken);
      const r = state.refresh[h];
      if (!r || r.clientId !== client.client_id || r.expiresAt < now()) throw new InvalidGrantError('Invalid or expired refresh token');
      delete state.refresh[h]; // rotate
      return issue(client.client_id, r.scopes, r.resource);
    },

    async verifyAccessToken(token) {
      if (bearer && sameSecret(token, bearer)) {
        return { token, clientId: 'static-bearer', scopes: [], expiresAt: now() + 3600 };
      }
      const r = state.access[hash(token)];
      if (!r || r.expiresAt < now()) throw new InvalidTokenError('Invalid or expired access token');
      return { token, clientId: r.clientId, scopes: r.scopes || [], expiresAt: r.expiresAt, resource: r.resource ? new URL(r.resource) : undefined };
    },

    async revokeToken(client, { token }) {
      const h = hash(token);
      if (state.access[h]?.clientId === client.client_id) delete state.access[h];
      if (state.refresh[h]?.clientId === client.client_id) delete state.refresh[h];
      save();
    },
  };

  // POST /login — the password form submits here.
  function loginHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const ip = req.ip || 'unknown';
    const f = fails.get(ip);
    if (f && f.n >= FAIL_LIMIT && f.until > Date.now()) {
      return res.status(429).type('html').send(loginPage({ id: req.body?.id || '', error: 'Too many wrong attempts. Try again in 15 minutes.', locked: true }));
    }

    const id = String(req.body?.id || '');
    const p = pending.get(id);
    if (!p || p.exp < Date.now()) {
      pending.delete(id);
      return res.status(400).type('html').send(loginPage({ id: '', error: 'This sign-in link expired. Go back and click Connect again.', locked: true }));
    }

    if (!sameSecret(req.body?.password || '', password)) {
      const cur = f && f.until > Date.now() ? f : { n: 0, until: Date.now() + FAIL_WINDOW_MS };
      cur.n += 1;
      fails.set(ip, cur);
      return res.status(401).type('html').send(loginPage({ id, error: 'Wrong password.' }));
    }

    fails.delete(ip);
    pending.delete(id);
    const code = rand();
    codes.set(code, {
      clientId: p.clientId, challenge: p.params.codeChallenge, redirectUri: p.params.redirectUri,
      scopes: p.params.scopes || [], resource: p.params.resource?.href, exp: Date.now() + CODE_TTL_MS,
    });
    const target = new URL(p.params.redirectUri);
    target.searchParams.set('code', code);
    if (p.params.state !== undefined) target.searchParams.set('state', p.params.state);
    res.redirect(302, target.href);
  }

  // Housekeeping for the in-memory maps.
  setInterval(() => {
    const t = Date.now();
    for (const [k, v] of codes) if (v.exp < t) codes.delete(k);
    for (const [k, v] of pending) if (v.exp < t) pending.delete(k);
    for (const [k, v] of fails) if (v.until < t) fails.delete(k);
  }, 60 * 1000).unref();

  return { provider, loginHandler };
}

function loginPage({ id, clientName, error, locked }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HouseSigma MCP · Sign in</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#111827;--mute:#6b7280;--line:#e5e7eb;--accent:#1d4ed8;--err:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--card:#121826;--fg:#e5e7eb;--mute:#9ca3af;--line:#1f2937;--accent:#3b82f6;--err:#f87171}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
.card{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 20px;color:var(--mute);font-size:14px}
input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:transparent;color:var(--fg);font-size:16px}
button{width:100%;margin-top:12px;padding:11px;border:0;border-radius:9px;background:var(--accent);color:#fff;font-size:16px;font-weight:600;cursor:pointer}
.err{color:var(--err);font-size:14px;margin:0 0 12px}
</style></head><body><main class="card">
<h1>HouseSigma MCP</h1>
<p>${clientName ? `${esc(clientName)} wants to connect.` : 'Sign in to connect.'}</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
${locked ? '' : `<form method="post" action="/login">
<input type="hidden" name="id" value="${esc(id)}">
<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
<button type="submit">Connect</button>
</form>`}
</main></body></html>`;
}

module.exports = { createAuth };
