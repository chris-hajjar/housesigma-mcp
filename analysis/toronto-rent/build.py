"""Inline data.js + a compact market layer into the page -> toronto-rent.artifact.html (self-contained)."""
import json, re
html = open('toronto-rent.html').read()
data_js = open('data.js').read()
m = json.load(open('market.json'))
def num(v):
    try: return float(v)
    except: return None
periods = [r['period'] for r in m['city']['C.']]
def series(chart, key):
    by = {r['period']: num(r.get(key)) for r in chart}
    return [by.get(p) for p in periods]
city = {k: series(m['city']['C.'], f) for k, f in [('rent', 'price_rent'), ('leased', 'rent_count'), ('listings', 'rent_listing_count'), ('dom', 'list_days')]}
comm = {}
for name, c in m['communities'].items():
    if 'chart' not in c: continue
    muni = c.get('municipality') or 'Toronto'
    if muni == 'East York': muni = 'Toronto'   # HouseSigma folds East York into the Toronto municipality
    comm[name] = {'rent': series(c['chart'], 'price_rent'), 'leased': series(c['chart'], 'rent_count'), 'listings': series(c['chart'], 'rent_listing_count'), 'muni': muni}
market = {'periods': periods, 'city': city, 'comm': comm, 'fetched': m['fetched_at'][:10]}
inline = '<script>' + data_js + '\nwindow.MARKET=' + json.dumps(market, separators=(',', ':')) + ';</script>'
out = html.replace('<script src="data.js"></script>', inline)
# copy: explain the two layers honestly
out = out.replace(
 "Every 1, 1+1 and 2 bedroom lease that closed in the City of Toronto in 2025 and 2026 year to date, at the price it actually leased for. Pick a bedroom type, pick what to map, click a hex or a neighbourhood to focus everything on it.",
 "Two layers. HouseSigma's complete monthly market series for every Toronto neighbourhood over the last two years, and the individual 1, 1+1 and 2 bedroom leases behind it at the price they actually leased for. Pick a bedroom type, pick what to map, click a hex, a dot or a neighbourhood to focus everything on it.")
out = out.replace(
 "if (!HAS25) { $('lede').textContent = 'Every 1, 1+1 and 2 bedroom lease that closed in the City of Toronto in 2026 so far, at the price it actually leased for. This first edition covers 2026 only; the 2025 comparison is being pulled now and will fill in the year-over-year figures. Pick a bedroom type, pick what to map, click a hex or a neighbourhood to focus everything on it.';",
 "if (!HAS25) { $('lede').textContent = 'Two layers. HouseSigma\\'s complete monthly market series for every Toronto neighbourhood over the last two years (the section “Where rents are moving” and the “12-mo change, market series” map colour), and a first sample of the individual 1, 1+1 and 2 bedroom leases behind it: ' + N.toLocaleString() + ' leases from 2026, about a third of the year so far, so hexes are dense where the pull has reached and empty where it has not. The full 2025 and 2026 lease pull is running and will fill in year-over-year and the same-unit comparisons. Pick a bedroom type, pick what to map, click a hex, a dot or a neighbourhood to focus everything on it.';")
out = out.replace("<div>Source: HouseSigma lease records (TRREB and ITSO boards), pulled through a personal account.",
 "<div>Source: HouseSigma. Market layer: HouseSigma's monthly market statistics per TRREB community (condo apartments, all bedroom types), complete for the 24 months shown. Lease layer: individual lease records (TRREB and ITSO boards) pulled through a personal account.")
open('toronto-rent.artifact.html', 'w').write(out)
print('built', round(len(out) / 1e6, 2), 'MB;', len(comm), 'communities in market layer;', sum(1 for c in comm.values() if c['muni'] == 'Toronto'), 'Toronto proper')
# syntax check the page script once
scripts = re.findall(r'<script>(.*?)</script>', out, re.S)
open('/tmp/_page.js', 'w').write('\n'.join(scripts))
