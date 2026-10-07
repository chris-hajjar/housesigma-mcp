# housesigma-mcp — build plan for approval

Companion to `housesigma-mcp-scoping.md` (wire contract, crypto, risks). This is the build spec.

## 0. Shape

| | |
|---|---|
| Name / title / version | `housesigma-mcp` / "🏠 HouseSigma" / 0.1.0 |
| Runtime | Node 20+, JavaScript, zero native deps: `@modelcontextprotocol/sdk`, `zod`, `playwright-core` (login only). Crypto = `node:crypto`, gunzip = `node:zlib` |
| Skeleton | `~/Desktop/MCPs/domain-mcp` (session.js, server.js layout, .mcpb pack, test/live.js) |
| Location | `~/Desktop/MCPs/housesigma-mcp` (personal, NOT at-ai) |
| Transports | `bin/stdio.js` (local: Claude Code, Claude Desktop .mcpb) and `bin/http.js` (remote: Streamable HTTP). One `src/server.js` builds the McpServer, both bins mount it |
| State dir | `~/.housesigma-mcp/` -> `session.json` (0600), `bundle.json` (salt + client version cache), `listings/<id>.json` (detail cache), `searches.json` (tracked searches), `snapshots/<search>.json` (last result set for diffs). JSON files, no sqlite |
| Defaults | province `ON`, lang `en_US`, rentals, Toronto |

## 1. Auth: your Gmail account

Resolution order in `getSession()`:

1. `HS_ACCESS_TOKEN` env (remote mode / override), validated.
2. `~/.housesigma-mcp/session.json` `{access_token, user_id, email, secret, saved_at}`, validated via `POST /init/accesstoken/check` -> `data.user !== null`.
3. Browser login: Playwright launches your installed Chrome with a **persistent profile** at `~/.housesigma-mcp/chrome-profile` (Google sign-in refuses fresh automated contexts; a persistent profile makes it a one-time login and keeps Google's own cookies). Lands on `https://housesigma.com/on/`, you click Sign In -> Continue with Google. Poll `localStorage.access_token` and `/init/accesstoken/check` from inside the page until `user` is bound. Capture token, close window. Up to 5 min.
4. Fallback: `login({access_token})` accepts a pasted token from DevTools > Application > Local Storage > `access_token`.

Lifetime: the token does not rotate on login; the server-side `secret_key` lasts 7 days and is refreshed via `/init/accesstoken/refresh` on `940 SECRET_KEY_INVALID`. On `900/910/920` the session file is deleted and the next call reports `no_session` with "run login".

Headers on every call: `Authorization: Bearer`, `HS-Client-Type: desktop_v7`, `HS-Client-Version` (read live from the bundle, cached 24h, fallback `7.22.40`), `HS-User-Id`, `Content-Type: application/json;charset=UTF-8`, browser UA, `Origin`/`Referer` housesigma.com.

## 2. Transport module (`src/hs/`)

- `bundle.js` fetch `/on/` -> `index.<hash>.js` -> regex `apiSalt:(\w+)` then `\1="..."` and `"HS-Client-Version":"..."`. Cache 24h. Fallback to the values captured 2026-09-23.
- `sign.js` md5(desc-sorted lowercased `k=v` string + ts + salt) for `detail_v2`, `mapsearchv3/list`, `mapsearchv3/listing`.
- `crypto.js` AES-128-CTR body encrypt (key = secret_key, random 16-byte counter), RSA-OAEP counter wrap with the bundle's public key, `Hs-Request-Timestamp` header, response AES-CTR decrypt + gunzip + JSON. Honors `secret.is_encrypted`. Endpoint list from the bundle (`detail_v2, popularity, preview/many, mapsearchv3/list, trendHouseList, recommendlist_v2`).
- `client.js` `post(path, body)` merges `{lang, province}`, signs, encrypts, one retry on 940 after refresh, min 400 ms spacing, one request in flight, 15 s timeout. Every response envelope checked; `error.message` surfaced verbatim.
- **Step 0 of the build:** after first login, one encrypted `detail_v2` round trip against a listing from the sitemap. If status is false, dump request and switch key derivation (ASCII vs hex) before writing any tool.

## 3. Tools (14)

Annotations: `openWorldHint: true` on all. `readOnlyHint: true` on everything except `login`, `update_watchlist`, `track_search`. `destructiveHint: false` everywhere. Outputs are compact JSON; listing rows always carry `id_listing`, `url`, `address`, `price`, `beds`, `baths`, `sqft`, `house_type`, `status`, `days_listed`, `photo`.

### Session
1. **`login`** — "Get or refresh your HouseSigma session (Gmail). Checks HS_ACCESS_TOKEN, then the cached session, else opens Chrome for you to sign in. Pass `access_token` to skip the browser." Inputs: `access_token?`, `force?`. Returns `{status, source, user:{name,email,province}, vow_agent, secret_expires_at, client_version}`.

### Find
2. **`suggest_places`** — "Typeahead over addresses, communities, municipalities and listings. Use to turn a place name into ids and map bounds for search_listings." Inputs: `query` (min 3 chars), `province?`. Returns typed matches with ids and bounds.
3. **`search_listings`** — "Map search, the core tool. Give a place name, explicit bounds, or one of your watched polygons; default rentals. Filters mirror the app." Inputs: `where?` (place string, resolved via suggest), `bounds?` `{lat1,lon1,lat2,lon2}`, `polygon_id?`, `mode` `rent|sale|sold|leased|delisted` (default rent), `house_types?[]`, `price_min?`, `price_max?`, `beds_min?`, `baths_min?`, `sqft_min?`, `sqft_max?`, `max_maintenance_fee?`, `parking_min?`, `basement?`, `listed_within_days?` (default 30 for rent), `keywords?`, `sort?` `newest|price_asc|price_desc|sqft`, `page?`, `limit?` (default 50, max 200). Exactly one of where/bounds/polygon_id. Returns `{total, page, rows[], bounds_used}` and writes each row into the listing cache.
4. **`lookup_filters`** — "Reference: house type codes, sort keys, days buckets and what each filter accepts." Inputs: `search?`. No network unless cache empty.

### Listing
5. **`get_listing`** — "Full record for one listing by id or URL: facts, brokerage, agent, listing history (every list/relist/price change/sold/leased with dates), estimate, rooms, key facts, schools, popularity." Inputs: `id` (id_listing or housesigma URL), `include?[]` `history|rooms|estimate|schools|analytics|photos` (default facts+history), `fresh?` (bypass 24h cache). Returns flattened `{listing, history[], estimate, rooms[], schools[], photos_count}`.
6. **`get_photos`** — "Photo URLs for a listing; optionally download to disk." Inputs: `id`, `download?` (bool), `dir?` (default `~/Desktop/housesigma/<id>/`), `max?`. Returns `{urls[], files[]}`.
7. **`get_comparables`** — "Nearby rented / for-sale / sold comparables with the price chart HouseSigma shows." Inputs: `id`, `kind` `rent|sale|sold`. Returns rows + chart points.

### Market
8. **`market_stats`** — "Community or municipality stats: price trend, rent ratio, price growth, demographics." Inputs: `place` (name or id from suggest_places), `kind` `trend|rent_ratio|price_growth|demographic`, `house_type?`, `months?`. Returns series + summary.

### Your account
9. **`my_saved`** — "Your HouseSigma account data: watchlists (with listings), watched polygons, saved map filters, recently viewed, notes." Inputs: `kind` `watchlists|polygons|filters|recent|notes|all`. Returns per-kind arrays; polygons include `polygon_id` usable in search_listings.
10. **`update_watchlist`** — "Add or remove a listing on one of your watchlists, or attach a note. Writes to your own account only." Inputs: `action` `add|remove|note`, `id`, `watchlist_id?`, `note?`. `readOnlyHint:false`.

### Tracking (the "do my own thing" layer, local only)
11. **`track_search`** — "Save, list or delete a named search (same inputs as search_listings) so whats_new can diff it over time." Inputs: `action` `save|list|delete`, `name`, `query?`. Stored in `searches.json`.
12. **`whats_new`** — "Run one or all tracked searches and diff against the last snapshot: new listings, price changes, gone. Updates the snapshot." Inputs: `name?` (default all), `dry_run?`. Returns `{new[], price_changed[], removed[], unchanged_count, snapshot_at}`.
13. **`export_data`** — "Write cached listings, a search result, or a diff to JSON/CSV on disk for your own analysis." Inputs: `what` `cache|search|tracked`, `name?`, `format` `json|csv`, `path?` (default `~/Desktop/housesigma/exports/`). Returns file path + row count.

### Escape hatch
14. **`call_api`** — "Advanced: POST any /bkv2/api path with a JSON body. Signing, encryption and headers are handled for you. Read-only by convention; refuses /user/profile/* and /auth/* writes." Inputs: `path`, `body?`. Returns the raw envelope. This is how "covers all of HouseSigma" is true without 60 tools.

## 4. Metadata and packaging

- `manifest.json` (.mcpb): `name housesigma-mcp`, `display_name HouseSigma`, `server.type node`, `entry_point bin/stdio.js`, icon inline SVG (house), `user_config`: `HS_ACCESS_TOKEN` (optional, sensitive), `HS_PROVINCE` (default ON), `HS_DATA_DIR` (default `~/.housesigma-mcp`), `HS_EXPORT_DIR`. Bootstrap guard per [[reference_mcpb_sdk_version_pin]] (never gate startup on `require.main === module`).
- Claude Code: `claude mcp add housesigma -- node ~/Desktop/MCPs/housesigma-mcp/bin/stdio.js`.
- Server instructions string: province default, "call login first", "search_listings defaults to rentals listed in the last 30 days", volume note.

## 5. Remote later (phase 2, sketched now so phase 1 does not block it)

- `bin/http.js`: Streamable HTTP on `PORT` (default 8787), stateless, `MCP_BEARER` shared secret required on `/mcp`, `HS_ACCESS_TOKEN` from env (no browser on a server; run `login` locally once and copy the token, or mount `session.json`).
- Host options: Fly.io / Render / your box behind Cloudflare Tunnel. Data dir on a volume.
- Claude Code connects with `claude mcp add --transport http housesigma https://host/mcp --header "Authorization: Bearer ..."`. Claude.ai custom connectors need OAuth or an unauthenticated URL, so if you want it in claude.ai as well, phase 2 adds a minimal OAuth shim or an allowlisted URL. Not needed for phase 1.

## 6. Guardrails

- Human-volume: single in-flight request, 400 ms spacing, 24 h listing cache, search results cached 10 min. `whats_new` is designed to run a few times a day, not every minute.
- Private: never shared, no redistribution, one account (yours). Session file 0600. Nothing about the Google login is stored except Chrome's own profile dir.
- Drift: salt and client version re-read from the live bundle; a failure falls back to the captured values and reports `bundle_stale: true` in `login`.
- Errors surfaced verbatim from `error.message`; never guessed.

## 7. Build order and your test script

1. Skeleton + `bundle.js` + `sign.js` + `crypto.js` + `client.js`; `test/live.js crypto` does anonymous token -> encrypted `detail_v2` on a sitemap listing. Must return `status:true`.
2. `session.js` with persistent Chrome profile; `login` tool.
3. `suggest_places`, `search_listings`, `lookup_filters`, `get_listing`, `get_photos`, `get_comparables`.
4. `my_saved`, `update_watchlist`, `market_stats`, `call_api`.
5. `track_search`, `whats_new`, `export_data`.
6. `manifest.json`, `.mcpb` pack, Claude Code registration, README.

Your test, in order:
- `login` -> Chrome opens, Gmail sign-in, window closes, tool returns your email.
- `search_listings where:"Liberty Village" mode:rent price_max:3200 beds_min:1`
- `get_listing id:<one of them> include:[history,photos]` then `get_photos download:true`
- `my_saved kind:polygons` -> `search_listings polygon_id:<id>`
- `track_search save "lv-rentals"` -> `whats_new` twice.
- `export_data what:tracked name:lv-rentals format:csv`

Estimate: 1 day for steps 1 to 3, half a day for 4 to 6.

## 8. Decisions I am taking unless you say otherwise

- Node + JSON files, no sqlite (keeps the .mcpb native-free).
- Persistent Chrome profile for login (needed for Google).
- Watchlist/note writes included (your own account, reversible).
- `call_api` included, read-only by convention.
- Default province ON, default mode rent, default window 30 days.

## 9. Decisions confirmed 2026-09-23 (Chris)

- Harness: both from day one (Claude Code stdio registration + .mcpb for Claude Desktop).
- Login: Playwright drives installed Chrome with a persistent profile stored in the project folder.
- Scope: full 14 tools (incl. lookup_filters, market_stats, update_watchlist, precon search mode).
- CSV: `csv: true` flag on every list-returning tool -> `data/exports/<date>-<tool>-<slug>.csv`, path + preview returned. No separate export tool. Default output is compact JSON for Claude to reason over / build artifacts from.
- Whole project (code, session, cache, Chrome profile, exports) lives in `~/Desktop/housesigma-mcp`. Nothing in hidden home dirs.
- Coverage: rent, sale, sold, leased, de-listed via list_type + days filters; every house type the app lists; pre-construction via preconmap endpoints as `mode: precon`.
