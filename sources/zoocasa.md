# Zoocasa

Status: researched 2026-09-24. Not built.

## What it is
Brokerage-backed portal (eXp Realty since 2022). MLS listings with sold history and an "appraisal" (comparable
sales) block per property. Next.js site.

## Coverage
Ontario (TRREB VOW and other boards, `provider_id: PROVIDER_TREB_VOW`), BC, Alberta, some US markets.
Sale and rent. Sold prices and history require sign-in (`compliance.complianceRequirement: "signIn"`).

## Data available
- Search rows (27 per page, server-rendered): `id`, `mls`, `status_id`, `listing_type` (buy/rent), `property_type`,
  `address`, `postal_code`, `price`, `square_footage {gte,lte}`, `bedrooms`, `bedrooms_partial`, `bathrooms`,
  `created_at`, `updated_on`, `provider_id`, `brokerage`, image key, `listing_url_absolute_path`.
- Detail page props: `activeListing.listing` (full facts, `isVow`, `imageUrls`, description), **`history[]`**
  (each past listing with `mlsNum`, `price`, `soldPrice`, `soldAt`, `expiredAt`, `addedAt`, `isRental`),
  `appraisal` (average price and days on market from nearby comparables with addresses), `stats`, `schools`.
  Anonymously `soldPrice`/`soldAt` are null; signed in they populate.

## Access path
- Server-rendered `__NEXT_DATA__` on `/<city>-on-real-estate` search pages and on listing pages; cursor pagination
  (`nextPageCursor`). Cloudflare is present but served 200 to plain curl on 2026-09-24.
- A JSON API behind the map exists (`listingSource: "go-search"`) but was not enumerated; the Next.js page data is
  enough for an adapter. Sign-in flow not probed.

## How we hook up
Adapter `zoocasa`: `search` → fetch the city search page with filters in the query string and read `__NEXT_DATA__`
(or replay the underlying `go-search` call once captured); `listing(mls)` → detail page, read `activeListing` and
`history`; `photos` → `imageUrls`; `history` → the `history[]` block, values complete only with a session cookie
(login via persistent Chrome, capture cookies rather than a token).

## Dedup key
`mls`.

## Risks and terms
Terms forbid scraping; VOW sign-in gate. Next.js page shapes change without notice.

## Effort
1 to 2 days.

## Value added
A **second, independent sold-history source** and a comparable-sales appraisal per property. Lower depth than
HouseSigma but useful as a cross-check when HouseSigma disagrees or is missing a transaction, and a fallback if
HouseSigma access is lost. Build after condos.ca and Kijiji.
