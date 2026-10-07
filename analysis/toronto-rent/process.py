"""Toronto 1 / 1+1 / 2 bed leases (2025 + 2026 YTD) -> compact data.js for the dashboard + a summary JSON for me."""
import json, re, sys, glob
import numpy as np, pandas as pd

EXP = '/Users/chris.hajjar/Desktop/housesigma-mcp/data/exports/'
OUT = '/Users/chris.hajjar/Desktop/housesigma-mcp/analysis/toronto-rent/'
files = sys.argv[1:] or sorted(glob.glob(EXP + 'pull-*-toronto-*.csv'))
df = pd.concat([pd.read_csv(f, dtype=str) for f in files], ignore_index=True)
raw_n = len(df)

# City of Toronto = the amalgamated city: HouseSigma labels the former boroughs by their own names.
TORONTO = ('Toronto', 'Etobicoke', 'North York', 'Scarborough', 'East York', 'York')
mun = df['area'].fillna('').str.rsplit(', ', n=1).str[-1]
df = df[mun.isin(TORONTO)].copy()
df['community'] = df['area'].str.rsplit(', ', n=1).str[0]
for c in ['price', 'sold_price', 'vs_asking_pct', 'baths', 'parking', 'days_on_market', 'lat', 'lon', 'estimate']:
    df[c] = pd.to_numeric(df[c], errors='coerce')
df = df.dropna(subset=['sold_price', 'lat', 'lon', 'ended'])
df['ended'] = pd.to_datetime(df['ended'], errors='coerce')
df = df.dropna(subset=['ended'])

b = df['beds'].astype(str).str.extract(r'^(\d+)(?:\s*\+\s*(\d+))?')
df['bmain'] = pd.to_numeric(b[0], errors='coerce')
df['den'] = pd.to_numeric(b[1], errors='coerce').fillna(0) > 0
df = df[df['bmain'].isin([1, 2])]
df['seg'] = np.where(df['bmain'] == 2, 2, np.where(df['den'], 1, 0))  # 0 = 1 bed, 1 = 1+1, 2 = 2 bed (incl 2+1)

def sqft(s):
    s = str(s).lower().replace(',', '').replace('ft²', '').strip()
    s = re.sub(r'(\d+(?:\.\d+)?)k', lambda m: str(int(float(m.group(1)) * 1000)), s)
    n = [int(x) for x in re.findall(r'\d+', s)]
    if not n: return 0
    if s.startswith('<'): return max(n[0] - 50, 0)
    v = (n[0] + n[1] + 1) / 2 if len(n) >= 2 else n[0]
    return int(v) if 200 <= v <= 3000 else 0
df['sq'] = df['sqft'].map(sqft)

# unit key: HouseSigma address id in the URL (unit level). Same unit + same final price within a month = cross-board duplicate.
df['unit'] = df['url'].str.extract(r'/home/([A-Za-z0-9]+)\?')[0].fillna(df['id'])
df['ym'] = df['ended'].dt.to_period('M')
before = len(df)
df = df.sort_values('ended').drop_duplicates(subset=['unit', 'sold_price', 'ym'])
df = df.drop_duplicates(subset=['id'])
dups = before - len(df)

# outliers: rents outside sane band for 1-2 beds (typos, monthly vs total, short-term)
df = df[(df['sold_price'] >= 900) & (df['sold_price'] <= 9000)]
df['ask'] = df['price'].where(df['price'].between(900, 12000))
df['type_c'] = np.where(df['type'].str.contains('Condo', na=False), 'condo', 'other')

df['m'] = (df['ended'].dt.year - 2025) * 12 + df['ended'].dt.month - 1   # 0 = Jan 2025
df['doy'] = df['ended'].dt.dayofyear
last = df['ended'].max()
cut_doy = int(last.dayofyear)

# communities + buildings
comms = sorted(df['community'].unique())
cidx = {c: i for i, c in enumerate(comms)}
df['bkey'] = (df['lat'].round(4).astype(str) + ',' + df['lon'].round(4).astype(str))
df['street'] = df['address'].where(~df['address'].fillna('').str.startswith('('), None).str.replace(r'^.*? - ', '', regex=True)
# fall back to the URL slug for the building address
slug = df['url'].str.extract(r'real-estate/([^/]+)/home')[0].fillna('')
df['street'] = df['street'].fillna(slug.str.replace(r'^\d+-', '', regex=True).str.replace('-', ' ').str.title())
bl = df.groupby('bkey').agg(street=('street', lambda s: s.mode().iat[0] if len(s.mode()) else ''), n=('id', 'size')).reset_index()
bidx = {k: i for i, k in enumerate(bl['bkey'])}

# repeat leases: same unit leased in 2025 and again in 2026, same segment
p = df.sort_values('ended')
first25 = p[p['ended'].dt.year == 2025].groupby('unit').last()
first26 = p[p['ended'].dt.year == 2026].groupby('unit').last()
j = first25.join(first26, lsuffix='_a', rsuffix='_b', how='inner')
j = j[j['seg_a'] == j['seg_b']]
j = j[(j['ended_b'] - j['ended_a']).dt.days >= 150]
j['chg'] = j['sold_price_b'] / j['sold_price_a'] - 1
j = j[j['chg'].abs() < 0.6]
pairs = {
    'seg': j['seg_a'].astype(int).tolist(), 'c': j['community_a'].map(cidx).tolist(),
    'lat': ((j['lat_a'] - 43.5) * 1e4).round().astype(int).tolist(), 'lon': ((j['lon_a'] + 79.7) * 1e4).round().astype(int).tolist(),
    'm1': j['m_a'].astype(int).tolist(), 'p1': j['sold_price_a'].astype(int).tolist(),
    'm2': j['m_b'].astype(int).tolist(), 'p2': j['sold_price_b'].astype(int).tolist(),
    'b': j['bkey_a'].map(bidx).tolist(),
}

i = lambda s, k=1: (s * k).round().fillna(-1).astype(int).tolist()
data = {
    'asOf': last.strftime('%Y-%m-%d'), 'cutDoy': cut_doy,
    'communities': comms,
    'buildings': bl['street'].tolist(),
    'L': {
        'lat': i(df['lat'] - 43.5, 1e4), 'lon': i(df['lon'] + 79.7, 1e4), 'seg': df['seg'].astype(int).tolist(),
        'm': df['m'].astype(int).tolist(), 'd': df['doy'].astype(int).tolist(),
        'p': df['sold_price'].astype(int).tolist(), 'a': i(df['ask']), 'sq': df['sq'].astype(int).tolist(),
        'dom': i(df['days_on_market']), 'pk': (df['parking'].fillna(0) > 0).astype(int).tolist(),
        'est': i(df['estimate'], 1e-3), 'c': df['community'].map(cidx).tolist(),
        'b': df['bkey'].map(bidx).tolist(), 'condo': (df['type_c'] == 'condo').astype(int).tolist(),
    },
    'pairs': pairs,
}
open(OUT + 'data.js', 'w').write('window.RENT=' + json.dumps(data, separators=(',', ':')) + ';')

# ---- summary for me ----
S = {'raw_rows': raw_n, 'toronto_rows': len(df), 'dups_removed': dups, 'asOf': data['asOf'], 'cut_doy': cut_doy,
     'by_year_seg': df.groupby([df['ended'].dt.year, 'seg']).size().to_dict().__repr__(), 'pairs': len(j)}
ytd = df[df['doy'] <= cut_doy]
for s, name in enumerate(['1', '1+1', '2']):
    a = ytd[(ytd['seg'] == s) & (ytd['ended'].dt.year == 2025)]['sold_price']
    bb = ytd[(ytd['seg'] == s) & (ytd['ended'].dt.year == 2026)]['sold_price']
    rp = j[j['seg_a'] == s]['chg']
    S[name] = {'n25': len(a), 'n26': len(bb), 'med25': a.median() if len(a) else None, 'med26': bb.median() if len(bb) else None,
               'repeat_n': len(rp), 'repeat_med_chg': rp.median() if len(rp) else None}
S['monthly_med'] = df.groupby(['m', 'seg'])['sold_price'].median().unstack().round().to_dict()
S['vs_ask_med_by_year'] = df.groupby(df['ended'].dt.year)['vs_asking_pct'].agg(['median', 'mean']).round(2).to_dict()
S['dom_by_year'] = df.groupby(df['ended'].dt.year)['days_on_market'].median().to_dict()
print(json.dumps(S, indent=1, default=str))
print('data.js MB', round(len(open(OUT + 'data.js').read()) / 1e6, 2))
