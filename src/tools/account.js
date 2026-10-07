// account.js — my_saved (read your account data), update_watchlist (write to your own account).
'use strict';
const { z } = require('zod');
const { withApi, normRow, maybeCsv } = require('./util');

function normAny(v) {
  if (Array.isArray(v)) return v.map(x => (x && x.id_listing ? normRow(x) : x));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = Array.isArray(val) ? normAny(val) : val;
    return out;
  }
  return v;
}
const rowsIn = v => { const acc = []; (function walk(o) { if (Array.isArray(o)) { o.forEach(walk); return; } if (o && typeof o === 'object') { if ((o.id || o.id_listing) && o.url) { acc.push(o); return; } Object.values(o).forEach(walk); } })(v); return acc; };

function register(server) {
  server.registerTool('my_saved', {
    title: 'My saved',
    description: 'Your saved things on HouseSigma: watchlists, watched listings, watched areas (polygons), saved filters, recently viewed, notes.',
    inputSchema: {
      kind: z.enum(['watchlists', 'watched', 'polygons', 'filters', 'recent', 'notes', 'all']).optional().describe('Default all.'),
      list_type: z.enum(['rent', 'sale']).optional().describe('For watched/watchlist listings. Default both.'),
      page: z.number().int().min(1).optional().describe('Page (20 per page) for watched / watchlist listings / polygons. Default 1.'),
      csv: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (p) => withApi(async api => {
    if (api.anonymous) throw new Error('my_saved needs a signed-in session. Run login.');
    const kind = p.kind || 'all';
    const want = k => kind === 'all' || kind === k;
    const lt = p.list_type === 'rent' ? [2] : p.list_type === 'sale' ? [1] : [1, 2];
    const out = {};
    const safe = async (k, fn) => { try { out[k] = normAny(await fn()); } catch (e) { out[k] = { error: e.message }; } };
    if (want('watchlists')) await safe('watchlists', async () => {
      const lists = await api.post('/user/watchlist/list', {});
      const arr = Array.isArray(lists) ? lists : (lists.list || lists.watchlists || lists.data || lists);
      if (Array.isArray(arr)) {
        for (const w of arr) {
          const id = w.id_user_watchlist || w.id;
          if (!id) continue;
          try { const body = { id_user_watchlist: id, page: p.page || 1 }; if (p.list_type) body.list_type = lt[0]; const d = await api.post('/user/watchlist/listings', body); w.listings = d.houselist || d.houseList || d.list || d; } catch (e) { w.listings = { error: e.message }; }
        }
      }
      return arr;
    });
    if (want('watched')) await safe('watched', async () => {
      // /user/watch/list wants a scalar list_type (an array returns nothing): fetch each type and merge.
      const seen = new Set(); const rows = [];
      for (const t of lt) { const d = await api.post('/user/watch/list', { page: p.page || 1, list_type: t }); for (const r of d.houselist || []) if (!seen.has(r.id_listing)) { seen.add(r.id_listing); rows.push(r); } }
      return rows;
    });
    if (want('polygons')) await safe('polygons', () => api.post('/user/watch_polygon/list', { page: p.page || 1 }));
    if (want('filters')) await safe('filters', async () => {
      // The app keeps saved filters per category: For-Sale, For-Lease, Precon.
      const out = {};
      for (const cat of ['For-Lease', 'For-Sale', 'Precon']) { try { out[cat] = await api.post('/user/mapfilter/list', { category: cat }); } catch (e) { out[cat] = { error: e.message }; } }
      return out;
    });
    if (want('recent')) await safe('recent', () => api.post('/user/recent/viewed', {}));
    if (want('notes')) await safe('notes', () => api.post('/user/note/list', {}));
    return maybeCsv(out, rowsIn(out), p, 'my_saved', kind);
  }));

  server.registerTool('update_watchlist', {
    title: 'Update watchlist',
    description: 'Watch or unwatch a listing, add or remove it from one of your watchlists, or add a private note. Your own account only.',
    inputSchema: {
      action: z.enum(['watch', 'unwatch', 'add_to_list', 'remove_from_list', 'note']),
      id: z.string().describe('id_listing.'),
      watchlist_id: z.union([z.string(), z.number()]).optional().describe('id_user_watchlist for add_to_list / remove_from_list (see my_saved kind:watchlists).'),
      note: z.string().optional().describe('For action note.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (p) => withApi(async api => {
    if (api.anonymous) throw new Error('update_watchlist needs a signed-in session. Run login.');
    const id = p.id.replace(/.*id_listing=/, '');
    let data;
    switch (p.action) {
      case 'watch': data = await api.post('/user/watch/add', { id_listing: id }); break;
      case 'unwatch': data = await api.post('/user/watch/remove', { id_listing: id }); break;
      case 'add_to_list':
        if (!p.watchlist_id) throw new Error('watchlist_id required');
        data = await api.post('/user/watchlist/update_listings', { id_listing: id, ids_user_watchlist: [p.watchlist_id] }); break;
      case 'remove_from_list':
        if (!p.watchlist_id) throw new Error('watchlist_id required');
        data = await api.post('/user/watchlist/remove_listing', { id_listing: id, id_user_watchlist: p.watchlist_id }); break;
      case 'note':
        if (p.note === undefined) throw new Error('note required');
        data = await api.post('/user/watch/addNote', { id_listing: id, note: p.note }); break;
    }
    return { done: p.action, id, message: data?.message || 'ok' };
  }));
}

module.exports = { register };
