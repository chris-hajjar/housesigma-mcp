# Zillow and realtor.com (US portals with Canadian listings)

Status: researched 2026-09-23/24. Recommendation: **skip**.

## What they are
- **Zillow** added Canadian for-sale listings in 2018 via brokerage partnerships (Century 21 Canada first, 250+
  brokerages since), roughly 30k listings at a time. Canada section: `zillow.com/c/canada/`.
- **realtor.com International** (`realtor.com/international/ca/...`) syndicates a subset of Canadian listings from
  partner brokerages; Next.js pages with `__NEXT_DATA__` served 200 to curl.

## Coverage
Partial and brokerage-dependent: a fraction of MLS inventory, sale only, no rentals of note in Canada, no sold
data or history for Canadian properties.

## Data available
Price, description, photos, basic facts, brokerage. No MLS number in many cases, no history.

## Access path
- Zillow: heavy anti-bot (PerimeterX), `GetSearchPageState` internal API keyed to a browser session; Canadian search
  works only through the US site's search state. Many scraping services exist, all proxy-based.
- realtor.com: `__NEXT_DATA__` on international pages is readable, but the inventory is thin.

## How we hook up
Not recommended. If ever needed: realtor.com international pages by city slug, read `__NEXT_DATA__`, dedup by address.

## Dedup key
Address + unit (MLS numbers often absent).

## Risks and terms
Both forbid scraping; Zillow actively blocks.

## Effort
2+ days for Zillow, half a day for realtor.com. Neither pays back.

## Value added
Essentially none for Canada beyond what realtor.ca and HouseSigma already carry, and nothing for rentals. Their US
inventory is irrelevant to the goal. Skip.
