// store.js — tiny JSON-file persistence inside data/: listing detail cache, tracked searches, snapshots.
'use strict';
const fs = require('fs');
const path = require('path');
const { paths, defaults } = require('./config');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
function safeName(s) { return String(s).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80); }

// ---- listing detail cache ----
const listings = {
  file: id => path.join(paths.listings, `${safeName(id)}.json`),
  get(id, { maxAgeMs = defaults.listingCacheMs } = {}) {
    const rec = readJson(this.file(id), null);
    if (!rec?.fetched_at) return null;
    if (Date.now() - Date.parse(rec.fetched_at) > maxAgeMs) return null;
    return rec;
  },
  put(id, detail) {
    const rec = { id_listing: id, fetched_at: new Date().toISOString(), detail };
    writeJson(this.file(id), rec);
    return rec;
  },
  ids() {
    try { return fs.readdirSync(paths.listings).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)); } catch { return []; }
  },
};

// ---- tracked searches ----
const searches = {
  all() { return readJson(paths.searches, {}); },
  get(name) { return this.all()[name] || null; },
  save(name, query) {
    const all = this.all();
    all[name] = { name, query, created_at: all[name]?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
    writeJson(paths.searches, all);
    return all[name];
  },
  remove(name) {
    const all = this.all();
    const existed = !!all[name];
    delete all[name];
    writeJson(paths.searches, all);
    try { fs.unlinkSync(snapshots.file(name)); } catch { /* none */ }
    return existed;
  },
};

// ---- snapshots (last result set per tracked search, keyed by id_listing) ----
const snapshots = {
  file: name => path.join(paths.snapshots, `${safeName(name)}.json`),
  get(name) { return readJson(this.file(name), null); },
  put(name, rows) {
    const byId = {};
    for (const r of rows) byId[r.id || r.id_listing] = r;
    const rec = { name, at: new Date().toISOString(), count: rows.length, rows: byId };
    writeJson(this.file(name), rec);
    return rec;
  },
};

module.exports = { listings, searches, snapshots, readJson, writeJson };
