# Kijiji (Real Estate: apartments and condos for rent, rooms, houses for rent)

Status: researched 2026-09-24, **open GraphQL confirmed**: anonymous `GetSearchResultsPageByUrl` returned 7,070 Toronto
apartment/condo rentals with full attributes. Not built.

## What it is
Canada's largest classifieds site (Adevinta / eBay Classifieds heritage). For housing it is the main home of
**non-MLS rentals**: landlords, property managers, sublets, rooms, plus brokerage feeds. Also "houses for sale"
by owner, small volume.

## Coverage
All of Canada. Rentals overwhelmingly. Categories: apartments & condos for rent (37), rooms & roommates,
short-term, house rental, commercial, real estate for sale (by owner).

## Data available
Per listing (`fragment Listing on FullListing`): `id`, `title`, `description`, `imageCount`, `imageUrls`, `url`,
`activationDate`, `sortingDate`, `adSource` (ORGANIC / feed), `location {name, address, nearestIntersection,
coordinates, neighbourhoodInfo}`, `price {amount, originalAmount}`, `flags {priceDrop, virtualTour, topAd,
showcase}`, `posterInfo {posterId, rating, verified}`, `attributes.all [{canonicalName, canonicalValues}]` which
carries bedrooms, bathrooms, unit type, parking, pets, furnished, utilities, size, move-in date, etc.
No MLS number, no history (beyond `originalAmount` vs `amount`), no sold data. Descriptions and photos are the
landlord's own.

## Access path
- Site is Next.js with Apollo; search results are server-rendered (`__NEXT_DATA__` → `__APOLLO_STATE__`) and fetched
  client-side from **`POST https://www.kijiji.ca/anvil/api`** (GraphQL). No Cloudflare challenge seen on pages or the
  endpoint; curl gets 200s.
- Operations in the bundle: `GetSearchResultsPageByUrl(searchResultsByUrlInput: SearchResultsByUrlInput!,
  pagination: PaginationInputV2!)`, `SearchResultsPage(by: SearchResultsPageInputBy!, ...)`, `GetPlaceSuggestions`,
  `PopularListings`, `GetSeoUrl`, `GetSearchUrl`. The full document with fragments is reconstructable from the
  chunks (saved during research as `kj_query.graphql` in the scratchpad; re-derive from the live bundle when building).
- Input shape (verified): `variables = { searchResultsByUrlInput: { url: "https://www.kijiji.ca/b-apartments-condos/
  city-of-toronto/c37l1700273", pagination: { offset, limit } }, pagination: { offset, limit } }`. The `url` must be a
  full URL (scalar type `URL`; a bare path is rejected). Response: `searchResultsPageByUrl.pagination.totalCount`
  (7,070 for Toronto apartments/condos on 2026-09-24), `results.mainListings[]`, `results.topListings[]`,
  `results.clusters[]`. Search URLs encode category and location in the path and filters as query params
  (`price__2000__3000`, `numberbedrooms_s0__2`, sort), so the adapter builds the same URL the site builds.
- Sample row: `price.amount` in cents (120000 = $1,200), `location.coordinates`, `location.neighbourhoodInfo.name`
  ("Newtonbrook West"), `attributes.all` with `heat`, `hydro`, `dateavailable`, `numberparkingspots`, `balcony`,
  `laundryinbuilding`, `furnished`, `petsallowed`, `numberbedrooms`, `numberbathrooms`, `areainfeet`, `unittype`.
- Listing pages (`/v-apartments-condos/...`) are server-rendered with the listing entity in Apollo state.
- Headers worth mirroring: `apollographql-client-name`, `x-ecg-ver` as seen in the browser.

## How we hook up
Adapter `kijiji`: `search(box, filters)` → compose the search URL (location id from `GetPlaceSuggestions`, category
37, price and bedroom filters, sort by date) and page with `pagination.offset`; map `attributes.all` to our fields;
coordinates come per listing so a bounds box can be applied client-side. `listing(id)` → VIP page or a
`GetListing`-style operation from the bundle. `photos` → `imageUrls` (swap the `?rule=kijijica-300-jpg` suffix for a
larger rule). `history` → none; `price.originalAmount` gives one price drop. No login needed for reads.

## Dedup key
None shared. Match to MLS listings by normalized address + unit + bedrooms + price within a window; photo hash as
tiebreaker. Otherwise keep as its own listing with `sources: [kijiji]`.

## Risks and terms
Terms forbid automated access. Volume of ads is high and churns fast; scams exist (verify `posterInfo.verified`).
GraphQL schema changes silently; re-derive the document from the bundle at startup like the HouseSigma salt.

## Effort
1 to 2 days: half a day to pin the input shape and location ids, half a day for field mapping and dedup, the rest
for detail pages and tests.

## Value added
**The listings no MLS site has**: private landlords, sublets, rooms, condo rentals listed without an agent. For a
renter this is the single largest gap in HouseSigma. Also the earliest signal on price drops (`priceDrop` flag) and
availability dates. Build second.
