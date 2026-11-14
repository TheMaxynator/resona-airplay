'use strict';
// Bounded metadata and listening positions only. No streams or account details.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function validTime(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 604800; }
function label(value, limit) { return String(value || '').normalize('NFKC').replace(/<[^>]*>/g, '').trim().slice(0, limit || 160); }
function parseChapters(value, duration) {
  if (typeof value !== 'string') return [];
  const found = new Map();
  value.slice(0, 16000).split(/\r?\n/).slice(0, 300).forEach(line => {
    // A timestamp at the beginning or end of a line; never one inside a URL.
    const beginning = /^\s*(?:\d+[.)]\s+)?(?:[-*•]\s*)?[\[(]?(\d{1,3}:\d{2}(?::\d{2})?)[\])]?(?:\s*[-–—|:]\s*|\s+)(.+?)\s*$/.exec(line);
    const ending = !beginning && /^\s*(.+?)\s+(?:[-–—|]\s*)?[\[(]?(\d{1,3}:\d{2}(?::\d{2})?)[\])]?\s*$/.exec(line);
    if (!beginning && !ending) return;
    const parts = (beginning ? beginning[1] : ending[2]).split(':').map(Number);
    if (parts[parts.length - 1] > 59 || (parts.length === 3 && parts[1] > 59)) return;
    const seconds = parts.reduce((sum, part) => sum * 60 + part, 0);
    const title = label(beginning ? beginning[2] : ending[1]).replace(/^[-–—|\s]+|[-–—|\s]+$/g, '');
    if (!validTime(seconds) || (duration > 0 && seconds >= duration) || !title || /https?:\/\//i.test(title)) return;
    if (!found.has(seconds) && found.size < 100) found.set(seconds, { position: seconds, title });
  });
  const result = Array.from(found.values()).sort((a, b) => a.position - b.position);
  return result.length >= 2 ? result : [];
}
function sourceKey(track) {
  if (track.sourceId) return 'sc:' + track.sourceId;
  const link = new URL(track.url); link.hash = '';
  return 'url:' + crypto.createHash('sha256').update(link.href).digest('hex');
}
function listeningHistory(dataDir, now) {
  const records = new Map();
  const filename = dataDir && path.join(dataDir, 'listening-history.json');
  if (filename) {
    try {
      if (fs.statSync(filename).size <= 1048576) {
        const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (Array.isArray(saved)) saved.slice(0, 100).forEach(record => {
          if (!record || !/^(sc:[1-9]\d{0,17}|url:[a-f0-9]{64})$/.test(record.key) ||
              !validTime(record.position) || !validTime(record.duration)) return;
          const bookmarks = Array.isArray(record.bookmarks) ? record.bookmarks.slice(0, 20).filter(bookmark =>
            bookmark && /^[a-f0-9]{16}$/.test(bookmark.id) && validTime(bookmark.position)).map(bookmark =>
            ({ id: bookmark.id, position: bookmark.position, label: label(bookmark.label, 80) })) : [];
          records.set(record.key, { key: record.key, position: record.position, duration: record.duration,
            updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : 0, bookmarks });
        });
      }
    } catch (_) { /* A missing/corrupt history never prevents audio playback. */ }
  }
  function save() {
    if (!filename) return;
    try {
      fs.mkdirSync(dataDir, { recursive: true, mode: 448 });
      const temporary = filename + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(Array.from(records.values())), { mode: 384 });
      fs.renameSync(temporary, filename);
    } catch (_) { /* Read-only/full storage must not interrupt the decoder. */ }
  }
  function get(track) { return track && records.get(sourceKey(track)); }
  function recordFor(track) {
    const key = sourceKey(track);
    let record = records.get(key);
    if (!record) {
      if (records.size >= 100) {
        const oldest = Array.from(records.values()).sort((a, b) => a.updatedAt - b.updatedAt)[0]; records.delete(oldest.key);
      }
      record = { key, position: 0, duration: track.duration, updatedAt: 0, bookmarks: [] }; records.set(key, record);
    }
    return record;
  }
  return {
    get,
    remember(track, position, duration, force) {
      if (!track || !validTime(position) || !validTime(duration)) return;
      const existing = get(track);
      if (existing && existing.position === position && existing.duration === duration) return;
      if (!force && existing && now() - existing.updatedAt < 15000) return;
      const record = recordFor(track);
      record.position = duration > 0 ? Math.min(position, duration) : position;
      record.duration = duration; record.updatedAt = now(); save();
    },
    add(track, position, title) {
      const record = recordFor(track);
      const duplicate = record.bookmarks.find(bookmark => Math.abs(bookmark.position - position) < 1);
      if (duplicate) return true;
      if (record.bookmarks.length >= 20) return false;
      record.bookmarks.push({ id: crypto.randomBytes(8).toString('hex'), position, label: label(title, 80) });
      record.bookmarks.sort((a, b) => a.position - b.position); record.updatedAt = now(); save(); return true;
    },
    remove(track, id) {
      const record = get(track); if (!record) return false;
      const index = record.bookmarks.findIndex(bookmark => bookmark.id === id); if (index < 0) return false;
      record.bookmarks.splice(index, 1); record.updatedAt = now(); save(); return true;
    }
  };
}
module.exports = { parseChapters, listeningHistory };
