// csv.js — the one export mechanism. Any list-returning tool with csv:true calls writeCsv(rows, toolName, slug)
// and gets back { path, rows } to hand to the user. Flat rows only; nested values are JSON-stringified.
'use strict';
const fs = require('fs');
const path = require('path');
const { paths } = require('./config');

function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(rows, columns) {
  if (!rows.length) return '';
  const cols = columns || Array.from(rows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set()));
  const lines = [cols.map(cell).join(',')];
  for (const r of rows) lines.push(cols.map(c => cell(r[c])).join(','));
  return lines.join('\n') + '\n';
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'export';
}

/** Writes data/exports/<YYYY-MM-DD-HHMM>-<tool>-<slug>.csv and returns { path, rows, columns }. */
function writeCsv(rows, tool, slug, columns) {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const file = path.join(paths.exports, `${stamp}-${slugify(tool)}-${slugify(slug)}.csv`);
  const csv = toCsv(rows, columns);
  fs.writeFileSync(file, csv);
  return { path: file, rows: rows.length, columns: columns || (rows[0] ? Object.keys(rows[0]) : []) };
}

module.exports = { writeCsv, toCsv };
