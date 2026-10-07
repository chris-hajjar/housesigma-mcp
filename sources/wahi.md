# Wahi

Status: researched 2026-09-24 (pages only). Not built.

## What it is
Toronto-founded portal and brokerage (2022) with cashback offers, "Wahi Price" estimates and deep per-listing
history. Next.js site under `/ca/en/real-estate/...`, GraphQL-shaped data (`ListingV2` types).

## Coverage
Ontario and BC (TRREB feed visible; BC Capital region pages exist). Sale and rent. Claims 21 years of sold history.

## Data available (server-rendered search rows, 10 per page)
Very rich per row: `mlsId`, `address {streetNumber, streetName, unitNumber, city, zip}`, `listPrice`, `soldPrice`,
`soldDate`, `listDate`, `originalListedDate`, `relisted`, `daysOnMarket`, `lastStatus`, `status`, `isSold`,
`terminatedDate`, `expiryDate`, **`hasHistory`, `historicalData`, `priceUpdates`, `soldPriceDifferences`**,
`maintenanceFees`, `taxes`, `pricePerSqFt`, `sqft`, `yearBuilt`, `details {numBedrooms, numBedroomsPlus,
numBathrooms, propertyType, sqft, numGarageSpaces, numParkingSpaces, basement1}`, `condominiumDetails`, `rooms`,
`schools`, `openHouses`, `images[].cdnPath` (`cdn.wahi.com/listings/images/trreb/...`), `virtualTourUrl`,
`wahiPrice`, `popularityScore`, `brokerageName`, `coordinates`. Whether `soldPrice`/`historicalData` are populated
anonymously needs one check on a sold listing (the Toronto page had 73 `soldPrice` mentions).

## Access path
- URL scheme: `/ca/en/real-estate/<prov>/<region>/<city>[/<district>/<neighbourhood>]/<address-slug>`; search pages
  like `/ca/en/real-estate/on/gta/toronto` render `pageProps.listingListProps.listings` with `initialFilters`
  (`states`, `zoneIds`) and `sorting`. No Cloudflare challenge to curl on 2026-09-24.
- The client talks to a GraphQL backend (typenames everywhere) whose endpoint was not found in the first chunks;
  `/api/login` exists. Capture from a browser session when building.

## How we hook up
Adapter `wahi`: `search` → search page per geo zone with filters in the query string, read `__NEXT_DATA__`, page
via `page`; `listing(mls)` → property page (`propertyWebUrl`), read the listing plus `historicalData` and
`priceUpdates`; `photos` → `cdn.wahi.com/...cdnPath`; `history` → `historicalData`. Login via persistent Chrome
if sold fields turn out gated.

## Dedup key
`mlsId`.

## Risks and terms
Terms forbid scraping; brokerage-run, so sold data is VOW-gated at some level. Page shapes change.

## Effort
1 to 2 days once the GraphQL endpoint or the page-data path is pinned.

## Value added
Potentially the **richest per-listing record after HouseSigma**, with relist detection, price updates, sold
differences and fees in one object. If sold fields are visible without login it becomes the easiest history
cross-check in the set. Worth a half-day check early, full build after condos.ca and Kijiji.
