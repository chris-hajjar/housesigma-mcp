#!/usr/bin/env node
// http entry — Streamable HTTP for remote use later. Stateless: one server instance per request.
//   PORT        default 8787
//   MCP_BEARER  required shared secret; clients send Authorization: Bearer <MCP_BEARER>
//   HS_ACCESS_TOKEN  your HouseSigma token (no browser on a server; run login locally once and copy it,
//                    or mount data/session.json)
// Claude Code: claude mcp add --transport http housesigma http://host:8787/mcp --header "Authorization: Bearer <MCP_BEARER>"
'use strict';
const http = require('http');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { buildServer } = require('../src/server');

const PORT = Number(process.env.PORT || 8787);
const BEARER = process.env.MCP_BEARER;
if (!BEARER) { console.error('MCP_BEARER is required for the HTTP transport.'); process.exit(1); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const srv = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true })); }
  if (url.pathname !== '/mcp') { res.writeHead(404); return res.end(); }
  if ((req.headers.authorization || '') !== `Bearer ${BEARER}`) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'unauthorized' })); }
  try {
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildServer();
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    console.error('request failed:', e);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
  }
});

srv.listen(PORT, () => console.error(`housesigma-mcp listening on http://0.0.0.0:${PORT}/mcp`));
