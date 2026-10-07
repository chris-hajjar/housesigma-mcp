# Multi-source Canadian listings: realtor.ca, condos.ca, Kijiji and friends

Status: research only, 2026-09-23. Nothing built. Companion to `REMOTE.md` (hosting) and `README.md` (what exists).
Per-source deep dives live in `sources/` (see `sources/README.md`); this file is the cross-cutting plan.

## Goal

Grow housesigma-mcp into one place for every Canadian listing for rent or sale, with the same tools you have now
(search, listing detail with history, photos, comparables, tracking, pulls, CSV), fed by several sites and
deduplicated into one listing model.

## What each site is (probed 2026-09-23)

| source | covers | history | sold data | bot wall | how it serves data |
|---|---|---|---|---|---|
| HouseSigma (built) | MLS in ON, BC, AB | full, decades | yes, logged in | none; Bearer token + md5 + AES | private JSON API, see `../housesigma-mcp-scoping.md` |
| realtor.ca (CREA) | every MLS board in Canada | none | no | **Cloudflare**; 403 to curl and to the devtools-driven Chrome | private `api2.realtor.ca/Listing.svc/PropertySearch_Post`, 200 per page, `CurrentPage` max 51 per box |
| condos.ca (Property.ca network) | Toronto-area condos, deep building data | yes, logged in | yes, logged in | none on the site; `api.condos.ca/v1` 403 without its token | server-rendered `window.__INITIAL_STATE__` with 450+ listings per page; Algolia index (`ALGOLIA_APP_ID 1TVIG461EC`, prefix `condos_`) |
| Zoocasa | ON, BC, AB, some US | some | yes, logged in | light (Cloudflare present, page served) | Next.js `__NEXT_DATA__` |
| Zolo | ON, BC | some | yes, logged in | Cloudflare 403 to curl | not probed further |
| Wahi | ON, BC | claims 21 years | yes, logged in | unknown | not probed (URL guess 404) |
| Zillow | ~30k Canadian for-sale via brokerage feeds | no | no | heavy | skip for Canada |
| realtor.com international | small Canadian subset | no | no | none seen | Next.js data; skip |
| Kijiji | the big non-MLS rental pool | no | no | none; page served | Apollo state embedded; search via their GraphQL (to discover) |
| Rentals.ca | non-MLS rentals | no | no | Cloudflare 403 | private API |
| Zumper / PadMapper | non-MLS rentals | no | no | TLS fingerprinting reported | private search API |
| Strata.ca | condo strata data | n/a | n/a | 429 on first hit | not probed |
| CREA DDF (official) | all boards | no sold | no | n/a | OAuth client_credentials via identity.crea.ca; needs a REALTOR or brokerage to create and sponsor credentials, no public signup |

### condos.ca listing object (from the rent search page)

Keys seen: `id, mls_number, latitude, longitude, title, home_type, sub_type, offer (Rent/Sale), status, property_type,
unit_number, asking_price, source (VOW), building_id, building_age, neighbourhood_name, locality_name, province_name,
url, tax, tax_year, bedrooms, bedrooms_plus, bed_type, bathrooms, furnished, parking_spots, parking_type,
locker_type, sqft_min, sqft_max, sqft, lot_size`. Unit page URL pattern: `/toronto/<building-slug>/unit-<unit>-<MLS>`.
Bundle strings hint at routes: `listings`, `listings/events`, `buildings`, `search_listings_*` sorts, `users/login`,
`users/google/login`, `sold_price_range`, `has_photos`.

### realtor.ca search parameters (from public wrappers)

`LatitudeMin/Max, LongitudeMin/Max, PropertySearchTypeId (0-8), BuildingTypeId, ConstructionStyleId,
OwnershipTypeGroupId, TransactionTypeId (1 all, 2 sale, 3 rent), PriceMin/Max, BedRange, BathRange, RecordsPerPage (<=200),
CurrentPage (<=51), Keywords, ReferenceNumber (MLS#), SortBy/SortOrder, CultureId, ApplicationId`. Response has
`Results[]`, `Paging`, `Pins`. Requires Cloudflare clearance cookies from a real browser session plus a matching
User-Agent/TLS fingerprint; Apify-style scrapers use Canadian residential proxies.

## The honest read

- **realtor.ca adds little in Toronto.** Same TRREB/PropTx feed as HouseSigma, minus history and sold data. Its value
  is national breadth (Quebec, Maritimes, Prairies). It is also the hardest wall in the set. Build it third or fourth.
- **The real gaps are condo depth and non-MLS rentals.** condos.ca has building pages, fee history, floor plans and
  dens as a field, with MLS numbers for dedup and no bot wall. Kijiji, Rentals.ca and PadMapper carry landlord and
  private rentals that never reach MLS; Kijiji is the largest and easiest.

## Architecture

Tools stay as they are. Underneath:

1. **Source adapters**, one module per site, same interface: `search(box, filters) -> rows`, `listing(id) -> detail`,
   `photos(id)`, `history(id)`. Login, signing, pacing and bot handling live inside the adapter. HouseSigma already is one.
   Each adapter re-reads its site's live bundle for drifting constants (the HouseSigma pattern).
2. **One listing model**: address, unit, lat/lon, type, status, price, beds, dens, baths, sqft range, listed/ended
   dates, days on market, photos, description, history rows, `sources[] = {site, id, url, seen_at}`.
3. **Dedup keys, in order**: (a) MLS number when both sides have one (HouseSigma, realtor.ca, condos.ca, Zoocasa);
   (b) normalized address + unit + price/date window (matches a Kijiji ad to an MLS rental); (c) photo hash as a last
   resort (landlords reuse agent photos). Merge rule: MLS sources win on facts, HouseSigma wins on history, the
   non-MLS source keeps its own price and contact.
4. **Tool surface**: `search_listings` gains `sources: all | housesigma | condos | kijiji | ...`; rows get a `sources`
   column; `get_listing` merges; tracking, pulls and CSV unchanged. A per-source `login` where needed.
5. **Storage**: same JSON cache per listing keyed by the merged id, plus a source-id index for dedup lookups.

## Build order and rough effort

1. **condos.ca adapter** (1 to 3 days). Discover: token flow for `api.condos.ca/v1`, the Algolia search key in the
   bundle, what a unit page returns logged in (history, sold). Server-rendered search pages are the fallback.
2. **Kijiji adapter, rentals only** (1 to 2 days). Discover the GraphQL search call behind the results page, map
   fields, handle no-MLS dedup.
3. **Merge layer + dedup + `sources` option** (1 to 2 days).
4. **realtor.ca** (2 to 4 days, uncertain). Only if coverage outside ON/BC/AB matters. Cookie lift from the everyday
   Chrome plus TLS impersonation; expect breakage.
5. **Zoocasa or Wahi** as a second opinion on sold history; **Rentals.ca / PadMapper** last.

## Risks

- Every site's terms forbid scraping; the ones with sold data need an account that can be flagged. One account per
  site, human pace, private use only. A merged dataset from several sites is further from "personal use of one portal"
  than today; keep it yours, do not distribute (see README "Guardrails" and REMOTE.md).
- More adapters, more rot. Live-bundle constant reads and a per-adapter smoke test are mandatory.
- Cloudflare sites (realtor.ca, Zolo, Rentals.ca) may block automation-controlled browsers entirely, as realtor.ca did
  to the devtools Chrome tonight.

## Next step when picking this up

A one-day discovery pass on condos.ca alone: token flow, Algolia key, logged-in unit page shape. That decides whether
adapter one is a day or three.

## Ontario-only priority (decided 2026-09-24)

Chris's focus is Ontario (Toronto rentals first). HouseSigma already carries every Ontario MLS board with history, so
the ranking is about what HouseSigma cannot see, weighted by how open the source is.

| # | source | why | open? | effort |
|---|---|---|---|---|
| 1 | condos.ca | condo depth (den as a field, fees, utilities included, floor, building stats), same MLS numbers for dedup | yes, JSON API with gate header | 1-2 d |
| 2 | Kijiji | non-MLS rentals: landlords, sublets, rooms; 7k+ live Toronto ads | yes, GraphQL | 1-2 d |
| 3 | Wahi | richest per-listing record (relists, price updates, sold diff, fees); Ontario native | pages yes; sold fields to verify | 0.5 d check, 1-2 d build |
| 4 | PadMapper | purpose-built rental buildings and managers not on MLS or Kijiji | yes, POST API | 0.5-1 d |
| 5 | Zoocasa | independent sold-history cross-check | pages yes, sold needs sign-in | 1-2 d |
| 6 | realtor.ca | only as an active-listing completeness check; same feed as HouseSigma for Ontario | no, Cloudflare | 2-4 d |
| - | Zolo, Rentals.ca, Strata.ca | duplicates of the above behind walls or rate limits | no | skip for now |
| - | CREA DDF, Zillow, realtor.com | membership-gated or irrelevant to Ontario | - | skip |

Sequence: condos.ca, then Kijiji, then the merge layer (`sources` option, dedup by MLS then address+unit), then a
half-day Wahi check, then PadMapper. Revisit realtor.ca only if a coverage gap against HouseSigma is actually observed.
