# HouseSigma

Status: **built** (`../src`, v0.1.x). This profile summarizes it in the same shape as the others; the wire contract
is in `../../housesigma-mcp-scoping.md`.

## What it is
Toronto-based portal and brokerage. Map search over MLS listings with sold and leased history, estimates
(SigmaEstimate), community stats. Consumer accounts get VOW data (sold prices, history) after a questionnaire.

## Coverage
Ontario, British Columbia, Alberta. Boards: TRREB/PropTx and the other Ontario boards, plus BC and AB feeds.
Rent, sale, sold, leased, de-listed, pre-construction.

## Data available
- Listing: address, unit, type, status, price, beds (+den string), baths, parking, sqft range, dates, description,
  brokerage, agent, key facts (tax, maintenance, exposure, locker), rooms, schools, community stats.
- **Listing history**: every list / relist / sold / leased / terminated with dates, asking and final prices, decades back.
- **Price changes** within the current listing.
- Photos (full and thumbs), virtual tour.
- Comparables (nearby rent / sale / sold), market trend series, rent ratio, price growth, demographics.
- Account: watchlists, watched, polygons, saved filters, recent, notes.

## Access path
Private JSON API `https://housesigma.com/bkv2/api`, all POST. Bearer `access_token` minted anonymously and bound to
the user on sign-in. Three endpoints md5-signed, six AES-CTR encrypted (key from the token check). No bot wall.
Paged list caps at 4,000 rows per box and jitters; map pins give true counts and up to 50 ids per cluster.

## How we hook up
Done: `src/hs/` (bundle constants, signing, crypto, client with 400 ms pacing), `src/hs/session.js` (Playwright on the
installed Chrome with a persistent profile; only the `login` tool may open it), 14 tools, background pulls.

## Dedup key
MLS number (`ml_num`), present on every row. Also `id_listing` (HouseSigma) and `id_address` (property).

## Risks and terms
Terms of Use and TRREB/PropTx VOW clauses forbid scraping and redistribution; personal, bona fide consumer use only.
Bundle constants (client version, salt) drift on deploys; re-read live at startup. One account, human pace.

## Effort
Spent: ~1.5 days to v0.1.0 plus iterations.

## Value added
The backbone: the only source in the set that combines active listings with complete historical sales and leases
for the same property. Everything else either adds breadth (realtor.ca), depth on one segment (condos.ca), or
listings that never reach MLS (Kijiji, rental sites).
