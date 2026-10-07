# PadMapper / Zumper

Status: researched 2026-09-24, **open search API confirmed** (PadMapper). Not built.

## What it is
Zumper's rental network; PadMapper is its map-first front end. Aggregates landlord and property-manager listings
(feeds like `llws_mits41_bundle`), plus some brokerage rentals. US and Canada.

## Coverage
Canadian cities including Toronto. Rentals only: apartments, condos, houses, rooms.

## Data available (per "listable")
`listing_id`, `address`, `city`, `state`, `zipcode`, `lat/lng`, `neighborhood_name`, `building_name`, `building_id`,
`min_price/max_price` (+ `previous_price`, `price_state`), `min_bedrooms/max_bedrooms`, `min/max_bathrooms`,
`property_type`, `listing_type`, `date_available`, `min/max_lease_days`, `pets`, `amenities`, `building_amenities`,
`features`, `short_description`, `title`, `image_ids`, `floorplan_count`, `agent_name`, `brokerage_name`,
`is_messageable`, `listed_on`, `modified_on`, `url`, `provider_url`. No MLS numbers, no history beyond
`previous_price`.

## Access path (verified)
- `POST https://www.padmapper.com/api/t/1/pages/listables` with JSON `{minLat, maxLat, minLng, maxLng, limit,
  listTypes[]}` returned 200 with listables anonymously (2026-09-24). Page HTML itself is a 3 KB JS shell.
- Terms explicitly prohibit automated collection; reports of TLS-fingerprint checks on Zumper properties, so a
  browser-like TLS profile may be needed over time.

## How we hook up
Adapter `padmapper`: `search(box, filters)` → `pages/listables` with the box and client-side filters; `listing(id)` →
the listable detail endpoint (discover from the app), `photos` → image ids through their CDN pattern (discover).
No login.

## Dedup key
None shared. Address + unit + bedrooms + price window against MLS rows; many PadMapper units are building-level
"from $X" ranges, so match at building level and keep them as their own rows.

## Risks and terms
Terms forbid scraping outright. Building-level feed listings are less precise than MLS rows.

## Effort
Half a day to a day.

## Value added
A second non-MLS rental pool after Kijiji, strong on purpose-built rental buildings and property managers that
never list on MLS or Kijiji. Cheap to add. Build after Kijiji.
