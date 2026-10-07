# realtor.ca (CREA)

Status: researched 2026-09-23. Not built.

## What it is
The Canadian Real Estate Association's national consumer portal. Every participating MLS board in Canada feeds it
through DDF (see `crea-ddf.md`). Listings only: no sold data, no history.

## Coverage
All provinces and territories, ~60 boards. Sale and rent. The only source in the set with Quebec, the Maritimes and
the Prairies at full depth.

## Data available (per listing)
From the public wrappers and the site itself; field names to verify against a live capture:
- `Results[]`: `Id`, `MlsNumber`, `PublicRemarks` (description), `Building {Bedrooms, BathroomTotal, SizeInterior,
  StoriesTotal, Type}`, `Property {Price, Type, OwnershipType, ParkingSpaceTotal, Address {AddressText, Latitude,
  Longitude}, Photo [{HighResPath, MedResPath, LowResPath}], AmmenitiesNearBy}`, `Land {SizeTotal}`,
  `Individual [{Name, Organization {Name, Phones}}]`, `RelativeDetailsURL`, `PostalCode`, `TimeOnRealtor`.
- `Paging {RecordsPerPage, CurrentPage, TotalRecords, MaxRecords, TotalPages}`, `Pins` (map clusters).
- Detail endpoint (`PropertyDetails`) adds rooms, features, open houses, agent contact.
- **No** sold price, **no** history, **no** price-change history. Some price-change flags on cards only.

## Access path
- Search: `POST https://api2.realtor.ca/Listing.svc/PropertySearch_Post` (form-encoded). Params: `LatitudeMin/Max`,
  `LongitudeMin/Max`, `PropertySearchTypeId` (0 residential … 8), `TransactionTypeId` (1 all, 2 sale, 3 rent),
  `PriceMin/Max`, `BedRange` ("1-0" = 1+), `BathRange`, `BuildingTypeId`, `ConstructionStyleId`,
  `OwnershipTypeGroupId`, `Keywords`, `ReferenceNumber` (MLS#), `SortBy`/`SortOrder`, `RecordsPerPage` (max 200),
  `CurrentPage` (max 51, so ~10k per box), `CultureId` (1 EN), `ApplicationId` (1 web, 37 mobile).
- Detail: `GET https://api2.realtor.ca/Listing.svc/PropertyDetails?ApplicationId=1&CultureId=1&PropertyID=<Id>&ReferenceNumber=<MLS>`.
- **Bot wall: Cloudflare.** Observed 2026-09-23: 403 to curl on the homepage and the API; the Chrome the devtools MCP
  drives got a "Just a moment" challenge and 403s on `ping.html` and sign-in fetches. Cloudflare recognises
  automation-controlled browsers.
- Public wrappers (`inin2007/realtorca`, `HexagonStudio/realtorca`, `TheBryanMac/realtorca`) predate the wall.
  Current scrapers (Apify actors, `simran-s-grewal/mls-real-estate-scraper-for-realtor.ca`) use
  `undetected-chromedriver` or Canadian residential proxies with a forged Chrome TLS fingerprint.
- Sign-in uses Gigya (SAP CDC); not needed for listing data.

## How we hook up (options, in order of preference)
1. **Cookie lift from the everyday Chrome.** Read `cf_clearance` (and the `__cf_bm`) cookie for realtor.ca from the
   user's real Chrome cookie store, then call `api2` from Node with a TLS fingerprint matching that Chrome
   (`curl_cffi` in Python, or a small Go/`utls` sidecar). Same UA string as the browser. Clearance lasts ~30 min to a
   few hours; refresh by having the user open realtor.ca. Fragile but no third party.
2. **In-browser fetch.** Run the calls inside a real logged-in tab via a tiny Chrome extension or the devtools
   protocol on the user's own Chrome (not an automation profile). Cloudflare accepts the page's own fetches.
3. **Residential proxy service** (Apify, Bright Data). Reliable, costs money, outsources the arms race.
4. **Official DDF** via a REALTOR sponsor (`crea-ddf.md`). Clean, but needs a member.
Adapter shape: `search(box, filters)` maps our params onto the form fields, walks `CurrentPage` to 51, tiles boxes
above 10k; `listing(mls)` via `ReferenceNumber` then `PropertyDetails`; `photos` from `Property.Photo`; `history`
returns nothing (HouseSigma fills it after dedup).

## Dedup key
`MlsNumber` (same numbers as HouseSigma and condos.ca for TRREB listings).

## Risks and terms
realtor.ca Terms of Use forbid scraping and automated access; DDF rules forbid redistribution. Cloudflare will
break any approach periodically. Residential proxies add cost and a vendor.

## Effort
2 to 4 days, uncertain. Most of it is the wall, not the data mapping (which is a day).

## Value added
**National breadth and completeness of active listings**, nothing else. For Toronto it duplicates HouseSigma (same
TRREB/PropTx feed) with less data. Worth building only when searching outside ON/BC/AB matters, or as a cross-check
that HouseSigma is not missing active listings. Build third or fourth.
