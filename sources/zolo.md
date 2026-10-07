# Zolo

Status: lightly researched 2026-09-23 (Cloudflare 403 to curl). Not built.

## What it is
Zolo Realty's portal and brokerage. MLS listings for Ontario and BC with sold data and history behind a login, home
value estimates, market stats pages per neighbourhood.

## Coverage
Ontario (TRREB and other boards) and BC. Sale and rent. Sold history for logged-in users.

## Data available
Listing facts, description, photos, sold prices and past listings when logged in, "Zolo estimates", neighbourhood
statistics (median prices, days on market). Comparable in scope to HouseSigma, less deep on history.

## Access path
- Site behind **Cloudflare**: 403 to curl on `www.zolo.ca/toronto-real-estate` (2026-09-23). Not probed further.
- Likely a JSON API behind the map (not confirmed). Login required for sold data, with the same VOW questionnaire
  pattern as HouseSigma.

## How we hook up
Same options as `realtor-ca.md`: cookie lift from the everyday Chrome plus matching TLS fingerprint, or in-browser
fetches. Discovery needed: one session with the network tab open to capture the map search and detail calls.

## Dedup key
MLS number.

## Risks and terms
Terms forbid scraping; account can be flagged. Cloudflare maintenance burden.

## Effort
2 to 3 days including the wall.

## Value added
Low while HouseSigma works: same boards, same sold data, less history. Useful only as a **second opinion on sold
prices and estimates**, or as a fallback if HouseSigma access is ever lost. Build late, if at all.
