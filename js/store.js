/* ============================================================
   store.js — persistence for Inkwell
   Notes live in IndexedDB (with a localStorage fallback) and are
   mirrored in an in-memory array so rendering never awaits I/O.
   ============================================================ */
(function (global) {
  'use strict';

  const DB_NAME = 'inkwell';
  const DB_VERSION = 1;
  const NOTES = 'notes';
  const LS_KEY = 'inkwell.notes.v1';
  const LS_SETTINGS = 'inkwell.settings.v1';

  let db = null;          // IDBDatabase, or null when we fall back
  let notes = [];         // in-memory mirror, newest-first is NOT guaranteed
  let usingFallback = false;

  /* ---------- tiny helpers ---------- */

  function uid() {
    // time-ordered id so notes created in the same ms never collide
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error('no indexedDB'));
      let req;
      try { req = global.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (err) { return reject(err); }

      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(NOTES)) {
          const os = d.createObjectStore(NOTES, { keyPath: 'id' });
          os.createIndex('updated', 'updated');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      req.onblocked = () => reject(new Error('indexedDB blocked'));
    });
  }

  function tx(mode) {
    const t = db.transaction(NOTES, mode);
    return { store: t.objectStore(NOTES), done: new Promise((res, rej) => {
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('transaction aborted'));
    }) };
  }

  function readAllFromDB() {
    return new Promise((resolve, reject) => {
      const req = db.transaction(NOTES, 'readonly').objectStore(NOTES).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /* ---------- localStorage fallback ---------- */

  function lsRead() {
    try {
      const raw = global.localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function lsWrite() {
    try { global.localStorage.setItem(LS_KEY, JSON.stringify(notes)); }
    catch (_) { /* quota or private mode — nothing we can do but keep memory */ }
  }

  /* persist one note; resolves even when storage misbehaves */
  function persist(note) {
    if (usingFallback) { lsWrite(); return Promise.resolve(); }
    try {
      const t = tx('readwrite');
      t.store.put(note);
      return t.done.catch(() => { usingFallback = true; lsWrite(); });
    } catch (_) {
      usingFallback = true; lsWrite();
      return Promise.resolve();
    }
  }

  function persistMany(list) {
    if (usingFallback) { lsWrite(); return Promise.resolve(); }
    try {
      const t = tx('readwrite');
      list.forEach(n => t.store.put(n));
      return t.done.catch(() => { usingFallback = true; lsWrite(); });
    } catch (_) {
      usingFallback = true; lsWrite();
      return Promise.resolve();
    }
  }

  function removeIds(ids) {
    if (usingFallback) { lsWrite(); return Promise.resolve(); }
    try {
      const t = tx('readwrite');
      ids.forEach(id => t.store.delete(id));
      return t.done.catch(() => { usingFallback = true; lsWrite(); });
    } catch (_) {
      usingFallback = true; lsWrite();
      return Promise.resolve();
    }
  }

  /* ---------- schema ---------- */

  function blank(patch) {
    const now = Date.now();
    return Object.assign({
      id: uid(),
      title: '',
      html: '',
      text: '',
      color: 'none',
      tags: [],
      pinned: false,
      created: now,
      updated: now,
      trashed: 0            // 0 = live, otherwise the timestamp it was trashed
    }, patch || {});
  }

  /* Accept anything note-shaped (e.g. from an imported file) and normalise it. */
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const n = blank();
    if (typeof raw.id === 'string' && raw.id) n.id = raw.id;
    n.title = typeof raw.title === 'string' ? raw.title.slice(0, 500) : '';
    n.html = typeof raw.html === 'string' ? raw.html : '';
    n.text = typeof raw.text === 'string' ? raw.text : '';
    n.color = typeof raw.color === 'string' ? raw.color : 'none';
    n.tags = Array.isArray(raw.tags)
      ? raw.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, 40)).slice(0, 20)
      : [];
    n.pinned = !!raw.pinned;
    n.created = Number.isFinite(raw.created) ? raw.created : Date.now();
    n.updated = Number.isFinite(raw.updated) ? raw.updated : n.created;
    n.trashed = Number.isFinite(raw.trashed) ? raw.trashed : (raw.trashed ? Date.now() : 0);
    if (!n.html && !n.text && !n.title) return null;
    return n;
  }

  /* ---------- public API ---------- */

  const Store = {
    async init() {
      try {
        db = await openDB();
        notes = await readAllFromDB();
        // one-time migration from an older localStorage-only install
        if (!notes.length) {
          const legacy = lsRead();
          if (legacy.length) { notes = legacy.map(sanitize).filter(Boolean); await persistMany(notes); }
        }
      } catch (_) {
        usingFallback = true;
        notes = lsRead().map(sanitize).filter(Boolean);
      }
      // ask the browser not to evict us when the device runs low on space
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {}
      return this;
    },

    get fallback() { return usingFallback; },

    all() { return notes; },

    live() { return notes.filter(n => !n.trashed); },

    trash() { return notes.filter(n => n.trashed); },

    get(id) { return notes.find(n => n.id === id) || null; },

    create(patch) {
      const n = blank(patch);
      notes.push(n);
      persist(n);
      return n;
    },

    /* Update in place. `touch: false` skips bumping `updated`
       (used for pin/colour so ordering does not jump around). */
    update(id, patch, touch) {
      const n = this.get(id);
      if (!n) return null;
      Object.assign(n, patch);
      if (touch !== false) n.updated = Date.now();
      persist(n);
      return n;
    },

    toTrash(id) { return this.update(id, { trashed: Date.now(), pinned: false }, false); },

    restore(id) { return this.update(id, { trashed: 0 }, false); },

    destroy(id) {
      const i = notes.findIndex(n => n.id === id);
      if (i < 0) return false;
      notes.splice(i, 1);
      removeIds([id]);
      return true;
    },

    emptyTrash() {
      const ids = notes.filter(n => n.trashed).map(n => n.id);
      notes = notes.filter(n => !n.trashed);
      removeIds(ids);
      return ids.length;
    },

    /* A note with nothing in it — created by tapping + and then walking away.
       Checklists and dividers count as content even with no words in them. */
    isBlank(n) {
      return !n.title.trim() && !n.text.trim() && !n.tags.length && !/<(hr|li)\b/i.test(n.html);
    },

    /* Sweep up blank notes left behind when the app was killed mid-edit. */
    pruneEmpty() {
      const ids = notes.filter(n => !n.trashed && this.isBlank(n)).map(n => n.id);
      if (!ids.length) return 0;
      notes = notes.filter(n => ids.indexOf(n.id) < 0);
      removeIds(ids);
      return ids.length;
    },

    /* Drop trashed notes older than `days`; called once at start-up. */
    pruneTrash(days) {
      const cutoff = Date.now() - days * 86400000;
      const ids = notes.filter(n => n.trashed && n.trashed < cutoff).map(n => n.id);
      if (!ids.length) return 0;
      notes = notes.filter(n => ids.indexOf(n.id) < 0);
      removeIds(ids);
      return ids.length;
    },

    tags() {
      const seen = new Map();
      notes.forEach(n => {
        if (n.trashed) return;
        n.tags.forEach(t => seen.set(t, (seen.get(t) || 0) + 1));
      });
      return [...seen.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count }));
    },

    exportJSON() {
      return JSON.stringify({
        app: 'Inkwell',
        version: 1,
        exported: new Date().toISOString(),
        notes: notes
      }, null, 2);
    },

    /* Merge an exported file back in. Same id -> keep whichever was edited last. */
    async importJSON(text) {
      let data;
      try { data = JSON.parse(text); } catch (_) { throw new Error('That file is not valid JSON.'); }
      const incoming = Array.isArray(data) ? data : (data && Array.isArray(data.notes) ? data.notes : null);
      if (!incoming) throw new Error('No notes found in that file.');

      const clean = incoming.map(sanitize).filter(Boolean);
      const byId = new Map(notes.map(n => [n.id, n]));
      const changed = [];
      let added = 0, updated = 0;

      clean.forEach(n => {
        const mine = byId.get(n.id);
        if (!mine) { notes.push(n); byId.set(n.id, n); changed.push(n); added++; }
        else if (n.updated > mine.updated) { Object.assign(mine, n); changed.push(mine); updated++; }
      });

      if (changed.length) await persistMany(changed);
      return { added, updated, skipped: clean.length - added - updated };
    },

    /* ---------- settings (small, non-critical → localStorage) ---------- */
    settings(patch) {
      let s = {};
      try { s = JSON.parse(global.localStorage.getItem(LS_SETTINGS) || '{}') || {}; } catch (_) { s = {}; }
      if (patch) {
        Object.assign(s, patch);
        try { global.localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch (_) {}
      }
      return s;
    },

    uid: uid
  };

  global.Store = Store;
})(window);
