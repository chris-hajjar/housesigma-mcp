// pull.js — big pulls that aim for EVERY listing in an area, streamed to CSV in the background.
//
// Why not just page the list? HouseSigma's paged list caps at 4,000 rows per map box and its ordering jitters
// between pages, so a long page-through both truncates and loses ~25% to duplicates. Instead:
//   1. tile the area adaptively; for each tile read the map pins at high zoom (one call). A pin cluster carries
//      up to 50 ids and its true count, so a cluster with ids == count is complete;
//   2. a tile with incomplete clusters is split (down to ~150 m). At max zoom an incomplete cluster is one
//      dense building: page a tiny box around it until its count is covered;
//   3. fetch rows for the collected ids 30 at a time (/listing/preview/many) and append to the CSV.
// Runs inside the server process; `pulls` reports progress. One pull at a time.
'use strict';
const fs = require('fs');
const path = require('path');
const { paths } = require('./config');
const { toCsv } = require('./csv');
const { normRow, passesFilters } = require('./tools/util');
const { readJson, writeJson } = require('./store');

const CAP = 4000;         // list endpoint's hard ceiling per box
const PAGE = 20;
const PREVIEW = 30;
const MIN_SPAN = 0.0015;  // ~150 m
const PULLS_FILE = path.join(paths.data, 'pulls.json');
const jobs = {};

function loadAll() { return readJson(PULLS_FILE, {}); }
function persist(job) { const all = loadAll(); all[job.id] = summary(job); writeJson(PULLS_FILE, all); }

function summary(j) {
  const elapsed = ((j.finished ? Date.parse(j.finished) : Date.now()) - Date.parse(j.started)) / 1000;
  const remainingRows = Math.max(0, (j.expected || j.ids.size) - j.rows);
  return {
    id: j.id, status: j.status, area: j.area, mode: j.mode, query: j.query,
    rows_written: j.rows, ids_found: j.ids.size, expected_rows: j.expected,
    complete_pct: j.expected ? Math.min(100, Math.round(j.rows / j.expected * 100)) : undefined,
    tiles_done: j.tilesDone, tiles_pending: j.tiles.length, dense_buildings: j.dense, requests: j.requests,
    started: j.started, finished: j.finished || undefined, elapsed_s: Math.round(elapsed),
    eta_s: j.status === 'running' ? Math.round(remainingRows / PREVIEW * (j.avgMs || 600) / 1000 + j.tiles.length * (j.avgMs || 600) / 1000) : undefined,
    csv: j.csv, error: j.error || undefined,
  };
}

const splittable = b => (b.lat2 - b.lat1) > MIN_SPAN && (b.lon2 - b.lon1) > MIN_SPAN;
function split(b) {
  const mLat = (b.lat1 + b.lat2) / 2, mLon = (b.lon1 + b.lon2) / 2;
  return [{ lat1: b.lat1, lon1: b.lon1, lat2: mLat, lon2: mLon }, { lat1: b.lat1, lon1: mLon, lat2: mLat, lon2: b.lon2 }, { lat1: mLat, lon1: b.lon1, lat2: b.lat2, lon2: mLon }, { lat1: mLat, lon1: mLon, lat2: b.lat2, lon2: b.lon2 }];
}
function zoomFor(b) {
  const span = Math.max(b.lat2 - b.lat1, (b.lon2 - b.lon1) * 0.72);
  if (span < 0.006) return 18; if (span < 0.012) return 17; if (span < 0.025) return 16; if (span < 0.05) return 15; if (span < 0.1) return 14; if (span < 0.2) return 13; return 12;
}

async function timed(job, fn) {
  const t0 = Date.now();
  try { return await retryOnce(fn); } finally { const ms = Date.now() - t0; job.requests++; job.avgMs = job.avgMs ? job.avgMs * 0.8 + ms * 0.2 : ms; }
}
// One request timing out (15 s) must not kill a 30-minute pull: retry it once after a short pause.
async function retryOnce(fn) {
  try { return await fn(); }
  catch (e) {
    if (!/timeout|aborted|ECONNRESET|fetch failed/i.test(e.message)) throw e;
    await new Promise(r => setTimeout(r, 5000));
    return fn();
  }
}

/** Total listings in a box (map pins, one call). */
async function expectedCount(api, body) {
  try { const d = await api.post('/search/mapsearchv3/listing', body); return (d.list || []).reduce((a, c) => a + (c.count || 0), 0); }
  catch { return null; }
}

/** Page a tiny box around one dense point until its count is covered (2 passes max). */
async function denseIds(job, api, buildBody, filters, loc, count) {
  const box = { lat1: loc.lat - 0.0004, lat2: loc.lat + 0.0004, lon1: loc.lon - 0.0005, lon2: loc.lon + 0.0005 };
  const body = buildBody(job.query, box, filters);
  const found = new Set();
  for (let pass = 0; pass < 4 && found.size < count; pass++) {
    for (let pg = 1; pg <= Math.ceil(Math.min(count, CAP) / PAGE) + 1 && job.status === 'running'; pg++) {
      const d = await timed(job, () => api.post('/search/mapsearchv3/list', { ...body, page: pg }));
      const list = d.houseList || [];
      for (const r of list) if (r.id_listing) found.add(r.id_listing);
      if (!list.length || found.size >= count) break;
    }
  }
  return found;
}

async function writeRows(job, api, ids) {
  for (let i = 0; i < ids.length && job.status === 'running'; i += PREVIEW) {
    const d = await timed(job, () => api.post('/listing/preview/many', { id_listing: ids.slice(i, i + PREVIEW) }));
    const rows = (d.houseList || []).map(normRow).filter(r => passesFilters(r, job.query));
    if (!rows.length) continue;
    const csv = toCsv(rows, job.columns);
    fs.appendFileSync(job.csv, job.rows === 0 ? csv : csv.split('\n').slice(1).join('\n') + '\n');
    job.rows += rows.length;
    for (const r of rows) job.written.add(r.id);
  }
}

async function run(job, api, buildBody, filters) {
  try {
    while (job.tiles.length && job.status === 'running') {
      const tile = job.tiles.shift();
      const zoom = zoomFor(tile);
      const body = { ...buildBody(job.query, tile, filters), zoom };
      const d = await timed(job, () => api.post('/search/mapsearchv3/listing', body));
      const clusters = d.list || [];
      const incomplete = clusters.filter(c => (c.ids || []).length < (c.count || 0));
      if (incomplete.length && zoom < 18 && splittable(tile)) { job.tiles.unshift(...split(tile)); continue; }
      const fresh = [];
      const take = id => { if (!job.ids.has(id)) { job.ids.add(id); fresh.push(id); } };
      for (const c of clusters) {
        (c.ids || []).forEach(take);
        if ((c.ids || []).length < (c.count || 0) && c.location) {
          job.dense++;
          (await denseIds(job, api, buildBody, filters, c.location, c.count)).forEach(take);
        }
      }
      await writeRows(job, api, fresh);
      job.tilesDone++;
      persist(job);
    }
    if (job.status === 'running') job.status = 'done';
  } catch (e) { job.status = 'failed'; job.error = e.message; }
  job.finished = new Date().toISOString();
  persist(job);
}

/** Start a background pull. Returns the job summary immediately. */
async function startPull({ api, query, bounds, area, buildBody, filters, columns }) {
  if (Object.values(jobs).some(j => j.status === 'running')) throw new Error('A pull is already running. Check it with the pulls tool, or cancel it first.');
  const id = new Date().toISOString().slice(2, 16).replace(/[-:T]/g, '') + '-' + String(query.where || query.polygon_id || 'box').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
  const csv = path.join(paths.exports, `pull-${id}.csv`);
  const job = { id, status: 'running', area, mode: query.mode || 'rent', query, tiles: [bounds], tilesDone: 0, dense: 0, ids: new Set(), written: new Set(), rows: 0, expected: null, requests: 0, avgMs: 0, started: new Date().toISOString(), csv, columns };
  job.expected = await expectedCount(api, buildBody(query, bounds, filters));
  jobs[id] = job;
  persist(job);
  run(job, api, buildBody, filters); // background
  return summary(job);
}

function status(id) {
  if (id) { const j = jobs[id]; if (j) return summary(j); return loadAll()[id] || null; }
  const live = Object.values(jobs).map(summary);
  const saved = Object.values(loadAll()).filter(s => !jobs[s.id]);
  return live.concat(saved).sort((a, b) => (b.started || '').localeCompare(a.started || ''));
}

function cancel(id) {
  const j = jobs[id];
  if (!j) return null;
  if (j.status === 'running') { j.status = 'cancelled'; j.finished = new Date().toISOString(); persist(j); }
  return summary(j);
}

module.exports = { startPull, status, cancel, CAP };
