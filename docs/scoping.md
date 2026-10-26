# HouseSigma MCP / API scoping

Investigation only, 2026-09-23. Nothing built. Everything below was read from HouseSigma's
public web bundle (`/assets/index.2aec82b5.js` + 61 lazy chunks, client version 7.22.40) and
confirmed with three anonymous read probes against the live API (v5.38.207).

## 1. Verdict

Feasible. Two differences from a typical cookie-based MCP pattern:

1. **Auth is a Bearer token, not a cookie.** HouseSigma mints an anonymous `access_token`
   (`POST /init/accesstoken/new`), stores it in `localStorage.access_token` and mirrors it into a
   JS-set cookie `storeAsyc_desk={"access_token":...}`. Sign-in (`/auth/user/signin` or
   `/auth/user/googlesignin`) sends that same token and **binds the user to it server-side**. The
   token string does not change on login. So the "cookie rip" is: log in through Playwright, read
   `localStorage.access_token` (or the `storeAsyc_desk` cookie), done.
2. **The six endpoints that matter are signed and encrypted.** Map search, listing detail,
   popularity, preview/many, trendHouseList and recommendlist_v2 require an md5 signature and an
   AES-CTR encrypted payload with an RSA-OAEP wrapped counter. Responses on those endpoints come
   back AES-CTR encrypted too. Everything needed to do this is in the bundle (salt, RSA public key,
   algorithm), and the per-session AES key is handed to you by `/init/accesstoken/check`. It is
   ~80 lines of Node `crypto`, not a wall, but it is the part no Apify scraper documents and the
   part most likely to rot on a client bump.

## 2. Session capture pattern

- Resolution order: env var override (`HS_ACCESS_TOKEN`), then cached JSON at `data/session.json` with a
  7-day absolute TTL, then Playwright (`playwright-core`, `channel: 'chrome'`, headless false,
  ephemeral context) driving the *installed* Chrome.
- Login detection: poll `localStorage.access_token` from inside the page until set, then POST
  `/init/accesstoken/check` and wait for `data.user !== null`, close the browser.
- Cache shape: `{ access_token, saved_at }`, mode 0600. All stderr, stdout stays JSON-RPC.
- Header on every call: `Authorization: Bearer <token>`, `HS-Client-Type: desktop_v7`, `HS-Client-Version: 7.22.40`, optional `HS-User-Id`.
- Validity check: `/init/accesstoken/check {access_token}` returns `user`, `secret{secret_key,expired_at,is_encrypted}`. Server-side secret expires in 7 days; refresh via `/init/accesstoken/refresh`.

Google sign-in works fine in the Playwright flow because Chrome is the real installed browser;
the One Tap widget just posts the credential to `/auth/user/googlesignin` with the token.

## 3. Wire contract (read from the bundle)

Base: `https://housesigma.com/bkv2/api`. Everything is `POST` JSON. Every body is merged with
`{lang: "en_US", province: "ON"}` by the client. Response envelope:
`{status: bool, data: {...}, error: {code, message}, debug: {API, server}}`.

Error codes: `900 ACCESS_TOKEN_INVALID`, `910 LOGIN_REQUIRED`, `920 AUTH_TOKEN_INVALID`,
`940 SECRET_KEY_INVALID`, `503`, `0 COMMON`.

### Endpoints for the rental use case

| Endpoint | Signed | Encrypted | Notes |
|---|---|---|---|
| `/init/accesstoken/new` | no | no | anonymous, returns token + secret |
| `/init/accesstoken/check` | no | no | `{access_token}` -> user, secret |
| `/init/accesstoken/refresh` | no | no | new secret_key |
| `/auth/user/signin` | no | no | `{email/phone, password, token}` |
| `/search/address_v2/suggest` | no | no | `{query}` typeahead, min length enforced |
| `/search/mapsearchv2/mapfilter` | no | no | the filter vocabulary (house types, days buckets etc) |
| `/search/mapsearchv3/list` | **yes** | **yes** | THE search. bounds `lat1/lon1/lat2/lon2`, `zoom`, `list_type` (1 sale, 2 rent), `house_type`, `price_min/max`, `bedroom_range`, `washroom`, `square_footage`, `listing_days`, `sold_days`, `de_list_days`, `max_maintenance_fee`, `basement`, `parking`, `description`, `sort`, `page` |
| `/search/mapsearchv3/listing` | **yes** | no | listing pins for the map |
| `/listing/info/detail_v2` | **yes** | **yes** | `{id_listing, id_address?}` -> `house{...}`, `listing_history[]` (date_start, date_end, price, sold_price, price_change, list_status), `photos`, `rooms`, `key_facts`, `analytics`, `estimate_price`, `school`, `list_dates`, brokerage, agent |
| `/listing/info/photos` | no | no | `{id_listing}` -> photo URLs |
| `/listing/info/analytics` | no | no | views/saves |
| `/listing/nearby/rent` `/sale` `/sold` | no | no | `{id_listing}` comparables |
| `/listing/preview/many` | no | **yes** | batch preview cards by ids |
| `/stats/rentratio`, `/stats/trend/*`, `/stats/pricegrowth/*` | mixed | trendHouseList yes | market stats |
| `/user/watchlist/*`, `/user/watch_polygon/*`, `/user/watch/*`, `/user/mapfilter/*`, `/user/recent/viewed`, `/user/note/*` | no | no | your saved searches, polygons, watched listings, notes |

Login-gated *content* (sold prices, MLS numbers, some history) comes back regardless of whether
the endpoint itself is gated; anonymous calls get the "Sign-in required" placeholders.

### Signing (`needSignApi = ["detail_v2","mapsearchv3/list","mapsearchv3/listing"]`)

```
ts        = unix seconds (10 chars)
qs        = keys of body sorted DESCENDING, each `urlenc(k)=urlenc(v)` for string/number values, joined by &, lowercased
signature = md5(qs + ts + apiSalt)      apiSalt = "ZckdTeV3kGyZd80q"
body      = {...body, signature, ts}
```

### Encryption (applied AFTER signing when `secret.is_encrypted === 1`, which it is in prod)

```
key     = secret.secret_key (16 hex chars, from accesstoken/check or /new), used raw as AES-128 key
counter = 16 random bytes
enc     = AES-CTR(key, counter, length 128) over JSON({...body, hs_request_timestamp: ts})
ctr     = RSA-OAEP(pem public key in bundle) over counter
POST body      = { ctr: b64(ctr), et_payload: b64(enc) }
extra header   = Hs-Request-Timestamp: ts
response.data  = b64 string -> AES-CTR decrypt with same key+counter -> gunzip -> JSON
```

The RSA public key (1024-bit, `pemEncodedKey`) is hardcoded in the bundle. `iu()` imports the
secret_key as the AES key; confirm whether it is used as ASCII bytes or hex-decoded by one
Playwright-side capture of a real request (network tab) before writing the Node version.

## 4. Proposed MCP shape (v0.1, read-only)

Tools, mirroring the inventory/domain MCPs:

- `login` (Playwright capture, validity report, whether `user` is bound, secret expiry)
- `search_listings` (bounds or place name via suggest, list_type default rent, all filters,
  pagination; returns compact rows with id_listing, address, price, beds, baths, sqft, days, url)
- `get_listing` (detail_v2 flattened: facts, listing_history, estimate, brokerage, photo count)
- `get_photos` (URLs, optional download to `~/Desktop/housesigma/<id>/`)
- `get_history` (listing_history only, cheap projection of get_listing)
- `nearby` (rent/sale/sold comparables)
- `my_watchlist` / `my_polygons` / `my_saved_filters` (so your existing app setup is reusable)
- `market_stats` (rent ratio, trend)

Plus a local SQLite cache keyed by id_listing so re-queries and "what changed since yesterday"
do not re-hit the API. That cache is where "do my own thing with the data" lives.

Effort: 1 day for session + crypto + search + detail, half a day for the rest, using the
existing MCP skeleton.

## 5. Risks and gotchas

- **Terms.** HouseSigma ToS and the TRREB/PropTx VOW clauses prohibit scraping, storing,
  reorganizing or redistributing Listing Information, and limit use to personal, non-commercial,
  bona fide consumers. `/bkv2/api/` is disallowed in robots.txt. A personal, single-account,
  low-volume tool for your own rental search is the least-exposed form of this, but it is still
  outside the letter of the terms. Keep it private, do not share the data or the bundle.
- **Account risk.** The token is bound to your account. Aggressive polling could get the account
  flagged (they do VOW compliance questionnaires already). Keep it to human-like volumes.
- **Client version drift.** `HS-Client-Version` and `apiSalt` will change on deploys. Mitigation:
  the login tool can re-read the salt and version from the live bundle on startup (regex over
  `index.<hash>.js`, same way we scraped it today).
- **Geolocation headers** are optional. `Hs-Current-URL` is optional.
- **Rate limiting** is unpublished. The web client itself retries once.
- **Encryption toggle is server-driven** (`secret.is_encrypted`), so the code must honor the
  flag, not hardcode it.

## 6. Alternatives already out there

- ~10 Apify actors (abotapi, lexis-solutions, memo23, parsebird, rigelbytes, solidcode...) each
  with an auto-generated "MCP server". They scrape the public HTML/landing pages, mostly work
  anonymously, and show "Sign-in required" for sold prices unless you feed them your cookies
  (lexis-solutions asks for `storeAsyc_desk` + `access_token`, same tokens as above). Cost from
  $1 per 1k results. None give you your watchlist/polygons, none do listing history reliably, all
  are third parties holding your session.
- `api-evangelist/housesigma` on GitHub: a survey confirming there is no public API, only the
  WordPress blog REST endpoint.
- Official route: none. No developer program, no data licensing page. The MLS boards (TRREB VOW
  RESO feed) only license to brokerages.

## 7. Open questions before building

1. AES key derivation: raw ASCII of the 16-char hex `secret_key` vs hex-decoded 8 bytes (the
   latter is not a valid AES key length, so ASCII is the likely answer). Verify from one captured
   request.
2. Response gunzip: `x_()` calls a decompressor (`Hc`) after decrypt. Confirm it is gzip/pako.
3. Does `/auth/user/signin` with email+password work without a captcha? If not, Playwright login
   is the only path (fine, same as Okta today).
