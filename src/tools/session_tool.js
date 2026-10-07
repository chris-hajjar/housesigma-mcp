// session_tool.js — login, call_api.
'use strict';
const { z } = require('zod');
const { getSession } = require('../hs/session');
const { getBundle } = require('../hs/bundle');
const { json, jsonError, withApi } = require('./util');

const BLOCKED = ['/auth/', '/user/profile', '/user/signup', '/user/join', '/user/forget', '/user/sell', '/user/buy', '/user/contact', '/user/questionnaire', '/user/tour', '/user/agent', '/user/myagent', '/init/'];

function register(server) {
  server.registerTool('login', {
    title: 'Login',
    description: 'Sign in to HouseSigma. Reuses your saved session; otherwise opens Chrome for a Google sign-in (watch for the window). Or pass access_token to skip the browser.',
    inputSchema: {
      access_token: z.string().optional().describe('Token copied from the browser, to skip the login window.'),
      force: z.boolean().optional().describe('Sign in again even if a session is saved.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async (p) => {
    try {
      const s = await getSession({ force: !!p.force, access_token: p.access_token, interactive: true });
      const b = await getBundle();
      return json({
        signed_in: true,
        as: s.user ? [s.user.name, s.user.email].filter(Boolean).join(' <').concat(s.user.email ? '>' : '') : 'unknown',
        province: s.province,
        session: s.source === 'login' ? 'new' : 'saved',
        renews_by: s.secret?.expired_at ? new Date(s.secret.expired_at * 1000).toISOString().slice(0, 10) : undefined,
        app_version: b.clientVersion,
      });
    } catch (e) { return jsonError({ signed_in: false, error: e.message }); }
  });

  server.registerTool('call_api', {
    title: 'Call API (advanced)',
    description: 'Advanced: call any HouseSigma API path directly. Signing and encryption are handled. Account and sign-in endpoints are refused.',
    inputSchema: {
      path: z.string().regex(/^\/[a-z0-9_\/\-]+$/i).describe('Path after /bkv2/api, e.g. /listing/nearby/sold'),
      body: z.record(z.any()).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (p) => {
    if (BLOCKED.some(b => p.path.startsWith(b))) return jsonError({ error: `${p.path} is an account or sign-in endpoint and is not allowed here.` });
    return withApi(async api => ({ path: p.path, data: await api.post(p.path, p.body || {}) }));
  });
}

module.exports = { register };
