# Strata.ca

Status: lightly researched 2026-09-24 (HTTP 429 on first request). Not built.

## What it is
Condo-focused portal (Toronto and BC) with building pages, unit sold history, maintenance-fee trends and strata /
condo-corporation context. Sold data behind sign-in.

## Coverage
Ontario and BC condos. Sale and rent, sold history per unit and building.

## Data available
Unit-level listing and sale history, building fees and reserve-fund style context, building amenities and photos,
neighbourhood condo stats. Overlaps condos.ca heavily; stronger on BC.

## Access path
- Rate-limited aggressively: the homepage returned 429 on a single curl. Suggests an API gateway with per-IP
  limits; stack not identified.
- Sign-in for sold data (VOW pattern).

## How we hook up
Discovery needed: one browser session with the network tab to see the search and building calls, then replay with
cookies at a slow pace. Adapter would mirror condos.ca (`building`, `building_stats`, `unit_history`).

## Dedup key
MLS number where shown; building + unit otherwise.

## Risks and terms
Terms forbid scraping; the 429 shows they enforce limits.

## Effort
1 to 2 days after discovery.

## Value added
Condo depth similar to condos.ca with better BC coverage. Only worth it if you search BC condos or want a second
source for building fee history. Low priority for Toronto.
