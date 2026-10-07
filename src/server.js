// server.js — builds the HouseSigma McpServer. Transport-agnostic: bin/stdio.js and bin/http.js mount it.
//
// 14 tools:
//   login            session (Gmail via your Chrome, persistent profile), or pasted token
//   suggest_places   place typeahead -> ids + coordinates
//   search_listings  map search: rent / sale / sold / leased / delisted / precon, every app filter, csv:true
//   lookup_filters   filter vocabulary
//   get_listing      detail + listing history + estimate + facts (+ rooms, schools, stats, photos, popularity)
//   get_photos       photo URLs, optional download
//   get_comparables  nearby rent / sale / sold with chart
//   market_stats     trend / rent_ratio / price_growth / demographic
//   my_saved         watchlists, watched, polygons, saved filters, recent, notes
//   update_watchlist watch / unwatch / add_to_list / remove_from_list / note (your own account)
//   track_search     save / list / delete named searches (local)
//   whats_new        run tracked searches, diff vs last snapshot (new / removed / price / status)
//   call_api         any /bkv2/api path, signed + encrypted for you (auth/profile endpoints refused)
//
// IMPORTANT: stdout is the JSON-RPC channel on stdio — all human-facing output goes to stderr.
'use strict';
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { defaults } = require('./config');
const pkg = require('../package.json');

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" rx="22" fill="#1d4ed8"/>' +
  '<path d="M50 22 L20 50 H30 V78 H44 V60 H56 V78 H70 V50 H80 Z" fill="#fff"/></svg>';

function buildServer() {
  const server = new McpServer({
    name: 'housesigma-mcp',
    title: '🏠 HouseSigma',
    version: pkg.version,
    icons: [{ src: `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString('base64')}`, mimeType: 'image/svg+xml' }],
  }, {
    instructions:
      'HouseSigma for one person\'s own account. If a tool says not signed in, run login. ' +
      'search_listings finds rentals by default (mode sale / sold / leased for others). get_listing gives history and facts for one listing. ' +
      'Add csv:true to any list tool to also get a CSV file. Keep calls modest: this is a personal account, not a crawler.',
  });

  const province = defaults.province;
  require('./tools/session_tool').register(server, province);
  require('./tools/find').register(server, province);
  require('./tools/listing').register(server, province);
  require('./tools/market').register(server, province);
  require('./tools/account').register(server, province);
  require('./tools/tracking').register(server, province);
  return server;
}

module.exports = { buildServer };
