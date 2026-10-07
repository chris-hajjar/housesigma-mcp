# housesigma-mcp

Personal MCP server over HouseSigma, on your own account. Search rentals and sales, open any listing for
its full history, grab photos and comparables, read your watchlists, track searches for changes, export
CSVs. Everything (code, session, Chrome profile, cache, exports) lives in this folder.

Scope and wire contract: `docs/scoping.md`. Build plan: `docs/plan.md`. Remote hosting plan: `docs/REMOTE.md`. One-off analyses: `analysis/`.
Remote hosting idea (S3 links, hosted photos, EC2, OAuth): `REMOTE.md`.
Multi-source plan (condos.ca, Kijiji, realtor.ca, dedup): `SOURCES.md`; one profile per source in `sources/`.

## Run

```
npm install --registry https://registry.npmjs.org/     # once (the  .npmrc registry rejects anonymous installs)
```

**Claude Code**

```
claude mcp add housesigma -- node ~/Desktop/housesigma-mcp/bin/stdio.js
```

**Claude Desktop**: `npm run pack` -> double-click `housesigma-mcp-<version>.mcpb`.

**Remote (later)**: `MCP_BEARER=<secret> HS_ACCESS_TOKEN=<token> node bin/http.js` then
`claude mcp add --transport http housesigma http://host:8787/mcp --header "Authorization: Bearer <secret>"`.
Run `login` locally first and copy the token from `data/session.json`.

## First use

Call `login`. Chrome opens on housesigma.com with a profile kept in `data/chrome-profile`; sign in with
Google; the window closes itself and the token is cached in `data/session.json`. The server-side secret
lasts 7 days and is refreshed automatically. If Google refuses the automated window, copy
`access_token` from DevTools > Application > Local Storage > housesigma.com and call `login {access_token}`.

## Tools

| Tool | Kind | What |
|---|---|---|
| `login` | session | Gmail login via Chrome, or pasted token. Reports user + secret expiry. |
| `suggest_places` | read | Community / city / address typeahead -> ids + coordinates. |
| `search_listings` | read | Map search by `where`, `bounds` or `polygon_id`. `mode` rent (default) / sale / sold / leased / delisted / precon. All app filters plus `period` ("ytd", "2025", "90d"), `listed_over_days` (stale listings) and sorts: newest, longest_listed, recently_ended, price_asc/desc, sqft_desc, price_per_sqft, biggest_discount. `limit` up to 1000 for pulls. |
| `pulls` | read | Progress of background pulls (`search_listings all:true`): rows written, ETA, CSV path; cancel. |
| `lookup_filters` | read | House type codes, statuses, days buckets. |
| `get_listing` | read | Detail + listing history + estimate + facts (+ rooms, schools, stats, photos, popularity, raw). 24h cache. |
| `get_photos` | read | Photo URLs; `download:true` saves to `data/photos/<id>/`. |
| `get_comparables` | read | Nearby rent / sale / sold with chart. |
| `market_stats` | read | trend (summary + monthly chart), rent_ratio, price_growth, demographic. |
| `my_saved` | read | Watchlists, watched, polygons, saved filters, recent, notes. |
| `update_watchlist` | write (own account) | watch / unwatch / add_to_list / remove_from_list / note. |
| `track_search` | local | save / list / delete named searches. |
| `whats_new` | read | Run tracked searches, diff vs last snapshot. |
| `call_api` | read | Any `/bkv2/api` path, signed + encrypted for you. Auth/profile endpoints refused. |

**CSV**: every list tool takes `csv: true` and writes `data/exports/<date>-<tool>-<slug>.csv`, returning the path.
Default output is short JSON for Claude to reason over: rows carry id, address, area, type, status, price, beds, baths,
parking, sqft, listed, days_on_market, mls, lat, lon, postal, estimate (HouseSigma sale estimate), url; sold/leased/de-listed rows add sold_price, vs_asking_pct, ended,
ended_days_ago. Empty fields are dropped. Errors are one plain sentence.

**Beds and dens**: HouseSigma's bedroom filter is a list of exact main-bedroom counts and ignores the den ("+1").
`beds_min` / `beds_max` expand to that list; `den: yes|no` is applied to the results client-side because the app has
no den filter. `baths_min` is a true minimum.

**Tracking**: `whats_new` uses the map-pin id set (stable) plus 30-per-call previews, not the paged list, so a diff
never shows phantom changes from page jitter.

**Big pulls** (`search_listings all:true`): HouseSigma's paged list stops at 4,000 rows per map box and jitters
between pages (a straight page-through of 1,189 rows kept only 881 unique). `src/pull.js` instead tiles the area,
reads map pins at high zoom (a cluster carries up to 50 ids plus its true count), splits tiles until clusters are
complete, pages a tiny box around dense buildings, then fetches rows 30 per call and appends to
`data/exports/pull-<id>.csv`. Runs in the background; `pulls` shows progress. Measured: Liberty Village leased YTD,
1,419 of 1,517 rows in 93 s and 158 requests. Toronto-wide YTD (~34k rows) is on the order of 30 minutes and heavy on
the account; keep such pulls occasional.

## How it talks to HouseSigma

`POST https://housesigma.com/bkv2/api/<path>` with `Authorization: Bearer <access_token>`,
`HS-Client-Type: desktop_v7`, `HS-Client-Version` (read live from the web bundle, cached 24h). Three endpoints
are md5-signed, six are AES-128-CTR encrypted with a per-session key and an RSA-OAEP wrapped counter; responses
on those come back encrypted + gzipped. All of it is in `src/hs/`. `client.js` serializes requests with a
400 ms floor between them.

## Tests

```
node test/live.js crypto        # anonymous token -> encrypted detail_v2 (step 0)
node test/smoke.js              # every read tool through a real MCP client (anonymous data has sign-in placeholders)
node test/smoke.js --signed     # + login + my_saved
```

## Guardrails

Personal, single-account, human-volume use only. HouseSigma's terms and the TRREB/PropTx VOW clauses prohibit
scraping and redistribution of listing data; keep this private and do not share exports.
