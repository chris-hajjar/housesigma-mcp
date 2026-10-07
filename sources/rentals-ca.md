# Rentals.ca

Status: lightly researched 2026-09-24 (Cloudflare 403 to curl on pages and `/phoenix/api`). Not built.

## What it is
Canadian rental portal (Bode/Rentals.ca network) with landlord, property-manager and brokerage rentals, plus the
monthly national rent report.

## Coverage
Canada-wide rentals: apartments, condos, houses, rooms, furnished, student.

## Data available
Listing facts (price, beds, baths, sqft, availability, pets, utilities, amenities), photos, description, landlord or
manager contact, building pages. No MLS numbers, no sold data. Rent report data (city medians) is public content.

## Access path
- Site and API behind **Cloudflare**; `https://rentals.ca/toronto` and `rentals.ca/phoenix/api/v1/listings`
  returned "Just a moment" 403 to curl. The Nuxt/Vue app uses an internal JSON API (Phoenix) that the browser reaches
  after the challenge.
- Same options as realtor.ca: cookie lift from the everyday Chrome plus matching TLS, in-browser fetch, or a proxy
  service. Not worth it until Kijiji and PadMapper are in.

## How we hook up
Adapter `rentalsca`: capture the map search call from a browser session, replay with clearance cookies; map fields;
bounds are native to the map call.

## Dedup key
None shared. Address + unit + price window; building-level matches.

## Risks and terms
Terms forbid scraping; Cloudflare maintenance.

## Effort
1 to 2 days, mostly the wall.

## Value added
Third non-MLS rental pool, overlapping heavily with PadMapper and Kijiji. Marginal once those two exist; useful
mainly for its rent report numbers, which are public and could be fetched without touching listings. Build last among
rental sources.
