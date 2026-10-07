#!/usr/bin/env node
// http entry — Streamable HTTP for remote hosting (Railway or any always-on box). Stateless: one MCP server per request.
//
//   PORT            default 8787 (Railway sets this)
//   PUBLIC_URL      https://your-host (no trailing slash). On Railway, RAILWAY_PUBLIC_DOMAIN is used if unset.
//   MCP_PASSWORD    required. The password for the sign-in page claude.ai / Claude Desktop shows on Connect.
//   MCP_BEARER      optional. Fixed token for headless clients: Authorization: Bearer <MCP_BEARER>
//   HS_DATA_DIR     where data/ lives. Point it at a persistent volume (e.g. /data).
//   HS_ACCESS_TOKEN optional. Your HouseSigma token; or call the login tool with access_token once.
//
// claude.ai / Claude Desktop: add a custom connector with URL  <PUBLIC_URL>/mcp  and click Connect.
// Claude Code:  claude mcp add --transport http housesigma <PUBLIC_URL>/mcp   (OAuth), or add
//               --header "Authorization: Bearer <MCP_BEARER>" to skip sign-in.
'use strict';
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const { buildServer } = require('../src/server');
const { createAuth } = require('../src/auth');

const PORT = Number(process.env.PORT || 8787);
const PASSWORD = process.env.MCP_PASSWORD;
const BEARER = process.env.MCP_BEARER || undefined;
const PUBLIC_URL = (process.env.PUBLIC_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`)).replace(/\/+$/, '');

if (!PASSWORD) { console.error('MCP_PASSWORD is required for the HTTP transport.'); process.exit(1); }
if (PASSWORD.length < 12) console.error('⚠ MCP_PASSWORD is short. Use a long random one: this URL is public.');

const baseUrl = new URL(PUBLIC_URL);
const mcpUrl = new URL('/mcp', baseUrl);
const { provider, loginHandler } = createAuth({ password: PASSWORD, bearer: BEARER });

const app = express();
app.set('trust proxy', 1); // Railway / any single reverse proxy: real client IP for rate limits
app.disable('x-powered-by');

app.get('/health', (_req, res) => res.json({ ok: true }));

// OAuth: /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource/mcp,
// /authorize (shows the password page), /token, /register, /revoke.
app.use(mcpAuthRouter({ provider, issuerUrl: baseUrl, resourceServerUrl: mcpUrl, resourceName: 'HouseSigma MCP' }));
app.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), loginHandler);

const auth = requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });

app.all('/mcp', auth, express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildServer();
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('request failed:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.error(`housesigma-mcp listening on ${mcpUrl.href} (port ${PORT})${BEARER ? ' · static bearer enabled' : ''}`));
