// remote_login.js — HouseSigma sign-in for the hosted server, from any browser (phone or desktop).
//
// A server can't open a Chrome window, and a page on our domain can never read what housesigma.com stores
// (browsers wall sites off from each other). So the hand-off is:
//   1. The login tool returns a one-time link: <PUBLIC_URL>/hs/connect?c=<code>  (valid 15 min).
//   2. Opening it sets a short-lived cookie on our domain that authorizes ONE session hand-off.
//   3. You sign in on housesigma.com as usual, then tap the "Send to MCP" bookmark (saved once).
//      The bookmark runs on housesigma.com, reads your session token, and opens <PUBLIC_URL>/hs/receive#t=<token>.
//      The token rides in the #fragment, so it never reaches server logs; the receive page posts it back
//      same-origin with the cookie, the server validates it with HouseSigma and saves it to data/session.json.
//
// Only http.js mounts this. In stdio (local) mode the login tool keeps opening Chrome as before.
'use strict';
const crypto = require('crypto');
const express = require('express');
const { getSession } = require('./session');

const LINK_TTL_MS = 15 * 60 * 1000;
const COOKIE = 'hs_connect';

let linkMaker = null;            // set when mounted; the login tool checks for it
const makeLink = () => (linkMaker ? linkMaker() : null);

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

function bookmarkletFor(publicUrl) {
  const js = `(()=>{var t=(localStorage.getItem('access_token')||'').replace(/^"|"$/g,'');` +
    `if(!/housesigma\\.com$/.test(location.hostname)||!t){alert('Open housesigma.com, sign in, then tap this bookmark again.');return}` +
    `location.href='${publicUrl}/hs/receive#t='+encodeURIComponent(t)})()`;
  return 'javascript:' + js;
}

/** Mount /hs/connect and /hs/receive on an express app. */
function mountRemoteLogin(app, { publicUrl }) {
  const secure = publicUrl.startsWith('https://');
  const codes = new Map();    // one-time link code -> exp
  const grants = new Map();   // cookie value -> exp  (authorizes one hand-off)

  linkMaker = () => {
    const code = crypto.randomBytes(18).toString('base64url');
    codes.set(code, Date.now() + LINK_TTL_MS);
    return `${publicUrl}/hs/connect?c=${code}`;
  };

  setInterval(() => {
    const t = Date.now();
    for (const [k, exp] of codes) if (exp < t) codes.delete(k);
    for (const [k, exp] of grants) if (exp < t) grants.delete(k);
  }, 60 * 1000).unref();

  const grantOf = req => {
    const g = readCookie(req, COOKIE);
    return g && grants.get(g) > Date.now() ? g : null;
  };

  app.get('/hs/connect', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const code = String(req.query.c || '');
    if (code) {
      const exp = codes.get(code);
      codes.delete(code); // one-time
      if (!exp || exp < Date.now()) return res.status(400).type('html').send(page('Link expired', '<p>This link expired or was already used. Ask Claude to run <b>login</b> again for a fresh one.</p>'));
      const grant = crypto.randomBytes(24).toString('base64url');
      grants.set(grant, Date.now() + LINK_TTL_MS);
      res.setHeader('Set-Cookie', `${COOKIE}=${grant}; Path=/hs; Max-Age=${LINK_TTL_MS / 1000}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
      return res.redirect(302, '/hs/connect'); // drop the code from the address bar / history
    }
    if (!grantOf(req)) return res.status(400).type('html').send(page('Link expired', '<p>Open the sign-in link from Claude first. Ask Claude to run <b>login</b> for a fresh one.</p>'));
    res.type('html').send(connectPage(bookmarkletFor(publicUrl)));
  });

  app.get('/hs/receive', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(receivePage());
  });

  app.post('/hs/receive', express.json({ limit: '4kb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const grant = grantOf(req);
    if (!grant) return res.status(403).json({ ok: false, error: 'This hand-off isn\'t authorized. Open the sign-in link from Claude first (it lasts 15 minutes), then tap the bookmark again.' });
    const token = String(req.body?.token || '').trim();
    if (!/^[A-Za-z0-9._-]{10,200}$/.test(token)) return res.status(400).json({ ok: false, error: 'No HouseSigma session found. Sign in on housesigma.com, then tap the bookmark again.' });
    try {
      const ua = String(req.body?.ua || req.headers['user-agent'] || '').slice(0, 400);
      const s = await getSession({ access_token: token, ua: ua || undefined }); // same browser that signed in
      grants.delete(grant);
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/hs; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
      res.json({ ok: true, as: [s.user?.name, s.user?.email].filter(Boolean).join(' · ') || 'your account' });
    } catch (e) {
      const anon = /anonymous/i.test(e.message);
      res.status(400).json({ ok: false, error: anon ? 'HouseSigma says you\'re not signed in there yet. Sign in on housesigma.com, then tap the bookmark again.' : `HouseSigma rejected that session (${e.message}).` });
    }
  });
}

// ---------- pages ----------

const STYLE = `
:root{--bg:#f6f7f9;--card:#fff;--fg:#111827;--mute:#6b7280;--line:#e5e7eb;--accent:#1d4ed8;--ok:#047857;--err:#b91c1c;--code:#f3f4f6}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--card:#121826;--fg:#e5e7eb;--mute:#9ca3af;--line:#1f2937;--accent:#3b82f6;--ok:#34d399;--err:#f87171;--code:#0b1220}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:24px 16px;display:flex;justify-content:center}
.card{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px}
h1{font-size:20px;margin:0 0 6px}h2{font-size:15px;margin:22px 0 8px}p,li{color:var(--mute);font-size:15px}p{margin:0 0 12px}
ol{padding-left:20px;margin:0 0 12px}li{margin:4px 0}b{color:var(--fg)}
.btn{display:block;width:100%;text-align:center;padding:12px;border-radius:10px;background:var(--accent);color:#fff;font-weight:600;text-decoration:none;border:0;font-size:16px;cursor:pointer}
.btn.alt{background:transparent;color:var(--accent);border:1px solid var(--line);margin-top:8px}
.bm{display:inline-block;padding:8px 12px;border:1px dashed var(--accent);border-radius:8px;color:var(--accent);text-decoration:none;font-weight:600}
details{border-top:1px solid var(--line);margin-top:20px;padding-top:12px}summary{cursor:pointer;font-weight:600}
.ok{color:var(--ok)}.err{color:var(--err)}`;

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>HouseSigma MCP · ${esc(title)}</title><style>${STYLE}</style></head>
<body><main class="card"><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

function connectPage(bookmarklet) {
  return page('Connect HouseSigma', `
<p>This link is good for 15 minutes.</p>
<ol>
<li>Open HouseSigma and sign in the way you normally do.</li>
<li>While you're on housesigma.com, tap your <b>Send to MCP</b> bookmark.</li>
</ol>
<a class="btn" href="https://housesigma.com/on/">Open HouseSigma</a>
<details>
<summary>First time? Save the bookmark</summary>
<h2>On a computer</h2>
<p>Drag this to your bookmarks bar: <a class="bm" href="${esc(bookmarklet)}">Send to MCP</a></p>
<h2>On a phone</h2>
<ol>
<li>Tap <b>Copy bookmark code</b> below.</li>
<li>Bookmark this page, and name it <b>Send to MCP</b>.</li>
<li>Edit that bookmark and replace its address with the copied code.</li>
</ol>
<p>To use it: Safari, open it from your bookmarks. Chrome, type <b>Send to MCP</b> in the address bar and tap the bookmark suggestion.</p>
<button class="btn alt" id="copy" type="button">Copy bookmark code</button>
</details>
<script>
const code = ${JSON.stringify(bookmarklet)};
document.getElementById('copy').onclick = async e => {
  try { await navigator.clipboard.writeText(code); e.target.textContent = 'Copied'; }
  catch { prompt('Copy this:', code); }
};
</script>`);
}

function receivePage() {
  return page('Connecting…', `
<p id="msg">Checking your HouseSigma session…</p>
<script>
(async () => {
  const msg = document.getElementById('msg');
  const h1 = document.querySelector('h1');
  const t = new URLSearchParams(location.hash.slice(1)).get('t') || '';
  history.replaceState(null, '', location.pathname); // wipe the token from the address bar
  try {
    const r = await fetch('/hs/receive', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t, ua: navigator.userAgent }) });
    const j = await r.json();
    if (j.ok) { h1.textContent = 'Connected'; msg.className = 'ok'; msg.textContent = 'Signed in as ' + j.as + '. You can close this window.'; }
    else { h1.textContent = 'Not connected'; msg.className = 'err'; msg.textContent = j.error; }
  } catch (e) { h1.textContent = 'Not connected'; msg.className = 'err'; msg.textContent = 'Could not reach the server: ' + e.message; }
})();
</script>`);
}

module.exports = { mountRemoteLogin, makeLink, bookmarkletFor };
