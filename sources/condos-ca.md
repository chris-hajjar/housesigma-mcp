# condos.ca (Property.ca network)

Status: researched 2026-09-23/24, **open JSON API confirmed**. Not built. Best next adapter.

## What it is
Toronto condo portal run by the Property.ca / Condos.ca brokerage network. Building-centric: every listing hangs off
a building page with fees, amenities, floor plans and building-level stats. Sister sites `property.ca` (houses)
and `hq.property.ca`. Listing data is supplied through **Repliers** (photos on `cdn.repliers.io`, `photo_source:
REPLIERSV2`), a commercial MLS data reseller.

## Coverage
GTA condos first, expanding to Ontario. Rent and sale. Sold and leased history behind a login (VOW pattern).
Anonymous queries return active listings only (`status=Sold` returns 0 anonymously).

## Data available
Listing object (105 fields on list, 120+ on detail). Highlights: `mls_number`, `title` ("311 - 10 Wilby Crescent"),
`offer` (Rent/Sale), `status`, `asking_price`, `bedrooms`, **`bedrooms_plus`** (den as a number), `bed_type` ("1+1"),
`bathrooms`, `sqft_min/max/sqft/sqft_source`, `maintenance_fee`, `tax`, `parking_spots/type`, `locker_type`,
`exposure`, `furnished`, `pets_permitted`, `date_available`, utilities included flags (`heat_inc`, `hydro_inc`,
`water_inc`, `aircon_inc`, `cable_inc`), `ensuite_laundry`, `level`, `walkscore`, `building_age`, `entry_date`,
`listed_ago`, `brokerage_name`, `ad_text` (description), `images[]` + `photo_base_url`, `tour_url`, `neighbourhood_name`,
`building_id`, `address_id`, `unit_id`, `corporation_number`. Building object (68 fields): units, floors, date built,
ceiling heights, amenities, `stats` endpoint with price stats by bed type and area.

## Access path (verified)
- Base `https://api.condos.ca/v1/`, Laravel-style JSON. **Required header** `x-platform-gate: <X_P_GATE>`, a constant in
  the site bundle (`/dist/main.js`, key `X_P_GATE`). Without it: 403. With it, anonymous reads work.
- `GET /listings` filters seen working: `offer=Rent|Sale`, `locality_id=1` (Toronto), `neighbourhood_id`, `building_id`,
  `bedrooms`, `price_min`, `price_max`, `sort=asking_price_asc|search_listings_entry_date_unix_desc|...`,
  `per_page` (100 ok), `page`. Bounds params (`bounds=`, `sw_lat/...`) were accepted but did not change results;
  polygon/map filtering needs discovery (bundle mentions `polygon:` and `bounds:`).
- **Cap: 500 results per query** (`total` never exceeds 500; `last_page` shrinks with `per_page`). Slice by
  neighbourhood or building to stay under it.
- `GET /listings/{numeric id}` detail (MLS number is not accepted as id). `GET /buildings`, `GET /buildings/{id}`,
  `GET /buildings/{id}/stats`, `GET /addresses/{id}`. `listings/events`, `listings/favourites`, `autocomplete`
  exist in the bundle; history route not found yet (probably needs the login token).
- Login: `POST users/login` (email/password) or `users/google/login`; the SPA stores a Bearer token in
  `localStorage.token` and sends `Authorization: Bearer`. `users/refresh` for renewal. This unlocks sold/leased.
- Algolia (`1TVIG461EC`, search-only key in bundle, prefix `condos_`) is referer-locked to condos.ca; usable only
  from inside the page or with a Referer header (untested).
- No bot wall on the site or the API as of 2026-09-24.

## How we hook up
Adapter `condos`: `search(box, filters)` → map our params to `/listings` (neighbourhood via their autocomplete or a
neighbourhood-id table cached from `/listings` rows; bounds by post-filtering `lat/lng` until the polygon param is
understood); `listing(mls)` → `/listings?mls_number=`? not accepted, so resolve numeric id from search rows or the
unit URL (`unit-<unit>-<MLS>` → detail page) then `/listings/{id}`; `photos` → `photo_base_url + images[]`;
`history` → after login, discover the events route; `building(id)` and `building_stats(id)` as a condos-only extra.
Login tool: same persistent-Chrome capture as HouseSigma, reading `localStorage.token`; or `users/login` directly
with email/password since it is a plain JSON call. Pace: their API is fast; keep 300 to 500 ms between calls.

## Dedup key
`mls_number` (TRREB numbers, same as HouseSigma). Also `building_id` + `unit_number` for building-level joins.

## Risks and terms
Terms forbid scraping and redistribution; VOW rules for sold data. The gate header is a shared constant, so it will
rotate eventually: read it from the live bundle like HouseSigma's salt. Repliers' involvement means the data is
licensed; keep it personal.

## Effort
1 to 2 days: half a day for search/detail/photos/buildings on the open API, half a day for login and the history
route, the rest for neighbourhood resolution and tests.

## Value added
**Condo depth Toronto renters and buyers actually use**: den as a field (fixes the 1+1 problem natively),
maintenance fees, what utilities are included, furnished, pets, floor level, building age, building-level price
stats and amenities. Plus a second active-listing feed for TRREB condos to cross-check HouseSigma. Cheapest adapter
in the set. Build first.
