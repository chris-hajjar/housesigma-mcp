# Source profiles

One document per listing source, same sections each time, so they can be compared and picked up cold.
Research only unless the doc says otherwise. Written 2026-09-23/24 from live probes (curl and bundle inspection,
no browser automation) plus public write-ups.

| doc | source | status |
|---|---|---|
| `housesigma.md` | HouseSigma | built, v0.1.x |
| `condos-ca.md` | condos.ca / Property.ca network | researched, **open JSON API confirmed** (gate header) |
| `kijiji.md` | Kijiji (non-MLS rentals) | researched, **open GraphQL confirmed** |
| `realtor-ca.md` | realtor.ca (CREA) | researched, Cloudflare wall |
| `zoocasa.md` | Zoocasa | researched, SSR history (sold values need sign-in) |
| `wahi.md` | Wahi | researched, rich SSR data incl. sold fields |
| `zolo.md` | Zolo | lightly researched, Cloudflare wall |
| `rentals-ca.md` | Rentals.ca | lightly researched, Cloudflare wall |
| `padmapper-zumper.md` | PadMapper / Zumper | researched, **open search API confirmed** |
| `strata-ca.md` | Strata.ca | lightly researched |
| `crea-ddf.md` | CREA DDF (official feed) | researched, membership gated |
| `zillow-realtor-com.md` | Zillow, realtor.com international | researched, skip |

Section order in every profile: What it is · Coverage · Data available · Access path · How we hook up ·
Dedup key · Risks and terms · Effort · Value added.

Cross-cutting design (adapters, unified listing model, dedup rules) lives in `../SOURCES.md`.
