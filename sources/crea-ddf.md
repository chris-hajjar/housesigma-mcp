# CREA DDF (Data Distribution Facility), the official feed

Status: researched 2026-09-23. Not applicable without a sponsor.

## What it is
CREA's licensed listing feed behind realtor.ca. Brokerages opt their listings in; approved "Destinations" (member
websites, technology providers) consume it. Docs: https://ddfapi-docs.realtor.ca/ and https://support.crea.ca/DDF.

## Coverage
Every opted-in listing from every participating board in Canada. Active listings only; **no sold data**.

## Data available
RESO Data Dictionary aligned (not RESO certified): Property, Member, Office, OpenHouse, Destination resources,
media URLs, remarks, rooms. REALTOR email addresses deliberately excluded.

## Access path
- Web API: `https://ddfapi.realtor.ca/odata/v1` (OData v4, `$filter`, `$top`, `$skip`, `$expand`).
- Auth: OAuth 2.0 client_credentials at `https://identity.crea.ca/connect/token`, scope `DDFApi_Read`, tokens last
  60 minutes. Credentials are a data-feed username/password created by a REALTOR or broker owner in the member
  portal and linked to a registered Destination.
- **No self-serve signup, no sandbox, no public tier.** Access belongs to Participants (brokerages, salespersons,
  franchisors). Third parties get it through a member who sponsors them, or via resellers like Repliers that
  front the feed.

## How we hook up
Only if a REALTOR friend or a brokerage sponsors a Destination for personal use. Then it is the cleanest adapter in
the set: standard OData paging, stable schema, no bot wall, no signing. `search` becomes `$filter` on
`City`, `ListPrice`, `BedroomsTotal`, geo via `$filter` on coordinates; `listing` by `ListingKey` or `ListingId`
(the MLS number); `photos` from `Media`.

## Dedup key
`ListingId` (MLS number).

## Risks and terms
DDF Policy and Rules (Jan 2024) restrict display and redistribution and require the Destination to be a member
property. Using a sponsor's credentials for a personal tool sits in a grey zone for the sponsor.

## Effort
Half a day once credentials exist.

## Value added
Same breadth as realtor.ca with none of the scraping risk, but only if a member sponsors it. Still no history or
sold data, so HouseSigma stays the history source.
