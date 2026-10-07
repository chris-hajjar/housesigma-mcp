// tracking.js — track_search (save named searches), whats_new (run + diff against last snapshot). Local only.
'use strict';
const { z } = require('zod');
const { searches, snapshots } = require('../store');
const { withApi, json, maybeCsv } = require('./util');
const { runSearchStable, describeArea } = require('./find');

function diff(prev, rows) {
  const before = prev?.rows || {};
  const now = Object.fromEntries(rows.map(r => [r.id, r]));
  const added = rows.filter(r => !before[r.id]);
  const removed = Object.values(before).filter(r => !now[r.id]);
  const price_changed = rows.filter(r => before[r.id] && before[r.id].price !== r.price && r.price != null && before[r.id].price != null)
    .map(r => ({ ...r, old_price: before[r.id].price }));
  const status_changed = rows.filter(r => before[r.id] && before[r.id].status !== r.status).map(r => ({ id: r.id, address: r.address, was: before[r.id].status, now: r.status, url: r.url }));
  return { added, removed, price_changed, status_changed, unchanged: rows.length - added.length - price_changed.length };
}

function register(server, province) {
  server.registerTool('track_search', {
    title: 'Track search',
    description: 'Save, list or delete a named search so whats_new can report changes over time.',
    inputSchema: {
      action: z.enum(['save', 'list', 'delete']),
      name: z.string().optional().describe('Search name, e.g. "lv-rentals". Required for save/delete.'),
      query: z.record(z.any()).optional().describe('search_listings inputs, e.g. {"where":"Liberty Village","mode":"rent","price_max":3200,"beds_min":1}. Required for save.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (p) => {
    if (p.action === 'list') return json({ tracked: Object.values(searches.all()).map(s => ({ name: s.name, query: s.query, last_checked: snapshots.get(s.name)?.at?.slice(0, 16).replace('T', ' '), listings: snapshots.get(s.name)?.count })) });
    if (!p.name) return json({ error: 'Give the search a name.' });
    if (p.action === 'delete') return json({ deleted: searches.remove(p.name) ? p.name : `nothing named "${p.name}"` });
    if (!p.query || !(p.query.where || p.query.bounds || p.query.polygon_id)) return json({ error: 'query needs a place (where), bounds or polygon_id.' });
    const q = { ...p.query }; delete q.csv; delete q.page; delete q.limit;
    searches.save(p.name, q);
    return json({ tracking: p.name, query: q, note: 'Run whats_new to set the baseline.' });
  });

  server.registerTool('whats_new', {
    title: "What's new",
    description: 'What changed in your tracked searches since last time: new, gone, price or status changes. First run sets the baseline.',
    inputSchema: {
      name: z.string().optional().describe('One tracked search. Default: all of them.'),
      dry_run: z.boolean().optional().describe('Compute the diff but keep the old snapshot.'),
      csv: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async (p) => withApi(async api => {
    const all = searches.all();
    const names = p.name ? [p.name] : Object.keys(all);
    if (!names.length) return { note: 'No tracked searches. Use track_search action:save first.' };
    const results = {};
    const csvRows = [];
    for (const name of names) {
      const s = all[name];
      if (!s) { results[name] = { error: 'not tracked' }; continue; }
      try {
        const r = await runSearchStable(api, s.query, province);
        const prev = snapshots.get(name);
        const d = diff(prev, r.rows);
        const changes = d.added.length + d.removed.length + d.price_changed.length + d.status_changed.length;
        results[name] = !prev
          ? { area: describeArea(r, s.query), baseline_saved: true, listings_now: r.rows.length, note: 'First run. Run again later to see changes.' }
          : !changes
            ? { area: describeArea(r, s.query), since: prev.at.slice(0, 16).replace('T', ' '), listings_now: r.rows.length, changes: 'none' }
            : { area: describeArea(r, s.query), since: prev.at.slice(0, 16).replace('T', ' '), listings_now: r.rows.length,
                new: d.added.length ? d.added : undefined,
                gone: d.removed.length ? d.removed.map(x => ({ id: x.id, address: x.address, price: x.price, url: x.url })) : undefined,
                price_changed: d.price_changed.length ? d.price_changed.map(x => ({ id: x.id, address: x.address, was: x.old_price, now: x.price, url: x.url })) : undefined,
                status_changed: d.status_changed.length ? d.status_changed : undefined,
                unchanged: d.unchanged };
        csvRows.push(...d.added.map(x => ({ search: name, change: 'new', ...x })), ...d.price_changed.map(x => ({ search: name, change: 'price', ...x })), ...d.removed.map(x => ({ search: name, change: 'removed', ...x })));
        if (!p.dry_run) snapshots.put(name, r.rows);
      } catch (e) { results[name] = { error: e.message }; }
    }
    return maybeCsv({ checked: new Date().toISOString().slice(0, 16).replace('T', ' '), dry_run: p.dry_run || undefined, results }, csvRows, p, 'whats_new', p.name || 'all');
  }));
}

module.exports = { register };
