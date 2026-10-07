#!/usr/bin/env node
// stdio entry — Claude Code (`claude mcp add housesigma -- node <path>/bin/stdio.js`) and the .mcpb for Claude Desktop.
// No require.main guard: .mcpb hosts load this file in ways where require.main !== module (see MCPB bootstrap gotcha).
'use strict';
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { buildServer } = require('../src/server');

(async () => {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error('housesigma-mcp ready (stdio)');
})().catch(e => { console.error('housesigma-mcp failed to start:', e); process.exit(1); });
