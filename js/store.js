/* ============================================================
   store.js — persistence for Inkwell
   Notes live in IndexedDB (with a localStorage fallback) and are
   mirrored in an in-memory array so rendering never awaits I/O.
   Photos live in their own object store as blobs; a note only
   keeps the id of each photo it shows.
   ============================================================ */
(function (global) {
  'use strict';

  const DB_NAME = 'inkwell';
  const DB_VERSION = 2;
  const NOTES = 'notes';
  const IMAGES = 'images';
  const LS_KEY = 'inkwell.notes.v1';
  const LS_IMAGES = 'inkwell.images.v1';
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
        if (!d.objectStoreNames.contains(IMAGES)) {
          d.createObjectStore(IMAGES, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      req.onblocked = () => reject(new Error('indexedDB blocked'));
    });
  }

  function tx(name, mode) {
    const t = db.transaction(name, mode);
    return { store: t.objectStore(name), done: new Promise((res, rej) => {
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
      const t = tx(NOTES, 'readwrite');
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
      const t = tx(NOTES, 'readwrite');
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
      const t = tx(NOTES, 'readwrite');
      ids.forEach(id => t.store.delete(id));
      return t.done.catch(() => { usingFallback = true; lsWrite(); });
    } catch (_) {
      usingFallback = true; lsWrite();
      return Promise.resolve();
    }
  }

  /* ---------- photos ---------- */

  /* A photo is only ever referenced from note markup, as
     <img data-img="…">. Reading the ids back out of the markup
     keeps one source of truth, so a note can never claim a photo
     it does not actually show. */
  function picsOf(html) {
    const out = [];
    if (!html) return out;
    const re = /data-img="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) { if (out.indexOf(m[1]) < 0) out.push(m[1]); }
    return out;
  }

  /* The images store only arrives with DB_VERSION 2. If the upgrade
     could not run (another tab holding the old version open), notes
     carry on in IndexedDB and photos use localStorage instead. */
  function imgFallback() {
    return usingFallback || !db || !db.objectStoreNames.contains(IMAGES);
  }

  let lsImgs = null;      // fallback: { id: {…meta, data: 'data:…'} }

  function lsImgRead() {
    if (lsImgs) return lsImgs;
    try { lsImgs = JSON.parse(global.localStorage.getItem(LS_IMAGES) || '{}') || {}; }
    catch (_) { lsImgs = {}; }
    return lsImgs;
  }

  function lsImgWrite() {
    try { global.localStorage.setItem(LS_IMAGES, JSON.stringify(lsImgRead())); return true; }
    catch (_) { return false; }
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(fr.error || new Error('could not read that photo'));
      fr.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(url) {
    const str = String(url || '');
    const m = /^data:([^;,]*)(;base64)?,/.exec(str);
    if (!m) return null;
    const type = m[1] || 'image/jpeg';
    const body = str.slice(m[0].length);
    try {
      if (m[2]) {
        const bin = global.atob(body);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type });
      }
      return new Blob([decodeURIComponent(body)], { type });
    } catch (_) { return null; }
  }

  /* ---------- schema ---------- */

  function blank(patch) {
    const now = Date.now();
    const n = Object.assign({
      id: uid(),
      title: '',
      html: '',
      text: '',
      color: 'none',
      tags: [],
      pics: [],             // ids of the photos this note shows, in order
      pinned: false,
      created: now,
      updated: now,
      trashed: 0            // 0 = live, otherwise the timestamp it was trashed
    }, patch || {});
    n.pics = picsOf(n.html);
    return n;
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
    n.pics = picsOf(n.html);
    if (!n.html && !n.text && !n.title) return null;
    return n;
  }

  /* ---------- public API ---------- */

  const Store = {
    async init() {
      try {
        db = await openDB();
        notes = await readAllFromDB();
        notes.forEach(n => { if (!Array.isArray(n.pics)) n.pics = picsOf(n.html); });
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
      if (patch && typeof patch.html === 'string') n.pics = picsOf(n.html);
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
       Photos, checklists and dividers count as content even with no words. */
    isBlank(n) {
      return !n.title.trim() && !n.text.trim() && !n.tags.length && !/<(hr|li|img)\b/i.test(n.html);
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

    /* ---------- photos ---------- */

    picsOf: picsOf,

    /* Save a prepared (already downscaled) blob and hand back its record. */
    putImage(blob, meta) {
      const rec = {
        id: 'i' + uid(),
        type: blob.type || 'image/jpeg',
        w: (meta && meta.w) || 0,
        h: (meta && meta.h) || 0,
        bytes: blob.size || 0,
        added: Date.now()
      };
      return this.putImageRecord(rec, blob);
    },

    /* Same, but keeping an id we already know (used by import). */
    async putImageRecord(rec, blob) {
      if (imgFallback()) {
        const data = await blobToDataURL(blob);
        const map = lsImgRead();
        map[rec.id] = Object.assign({}, rec, { data });
        if (!lsImgWrite()) {
          delete map[rec.id];
          throw new Error('There is no room left for photos in this browser.');
        }
        return rec;
      }
      try {
        const t = tx(IMAGES, 'readwrite');
        t.store.put(Object.assign({}, rec, { blob }));
        await t.done;
        return rec;
      } catch (_) {
        throw new Error('That photo could not be saved — the device may be out of space.');
      }
    },

    getImage(id) {
      if (imgFallback()) {
        const rec = lsImgRead()[id];
        if (!rec) return Promise.resolve(null);
        const blob = dataURLToBlob(rec.data);
        return Promise.resolve(blob ? Object.assign({}, rec, { blob }) : null);
      }
      return new Promise(resolve => {
        try {
          const req = db.transaction(IMAGES, 'readonly').objectStore(IMAGES).get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (_) { resolve(null); }
      });
    },

    allImageIds() {
      if (imgFallback()) return Promise.resolve(Object.keys(lsImgRead()));
      return new Promise(resolve => {
        try {
          const req = db.transaction(IMAGES, 'readonly').objectStore(IMAGES).getAllKeys();
          req.onsuccess = () => resolve((req.result || []).map(String));
          req.onerror = () => resolve([]);
        } catch (_) { resolve([]); }
      });
    },

    deleteImages(ids) {
      if (!ids.length) return Promise.resolve(0);
      if (imgFallback()) {
        const map = lsImgRead();
        ids.forEach(id => { delete map[id]; });
        lsImgWrite();
        return Promise.resolve(ids.length);
      }
      try {
        const t = tx(IMAGES, 'readwrite');
        ids.forEach(id => t.store.delete(id));
        return t.done.then(() => ids.length).catch(() => 0);
      } catch (_) { return Promise.resolve(0); }
    },

    /* Every photo id any note still points at — trashed notes included,
       so restoring a note never finds a hole where its photo was. */
    usedImageIds() {
      const used = new Set();
      notes.forEach(n => (n.pics || []).forEach(id => used.add(id)));
      return used;
    },

    photoCount() { return this.usedImageIds().size; },

    /* Delete stored photos nothing refers to any more. */
    async gcImages() {
      const used = this.usedImageIds();
      const all = await this.allImageIds();
      const orphans = all.filter(id => !used.has(id));
      if (orphans.length) await this.deleteImages(orphans);
      return orphans.length;
    },

    /* ---------- backup ---------- */

    /* Photos ride along as data URLs so one file really is everything.
       `onProgress(done, total)` lets the caller keep the user informed. */
    async exportBundle(onProgress) {
      const ids = [...this.usedImageIds()];
      const images = [];
      for (let i = 0; i < ids.length; i++) {
        if (onProgress) onProgress(i, ids.length);
        const rec = await this.getImage(ids[i]);
        if (!rec) continue;
        let data = rec.data;
        if (!data && rec.blob) {
          try { data = await blobToDataURL(rec.blob); } catch (_) { data = null; }
        }
        if (!data) continue;
        images.push({ id: rec.id, type: rec.type, w: rec.w, h: rec.h, bytes: rec.bytes, added: rec.added, data });
      }
      if (onProgress) onProgress(ids.length, ids.length);
      return JSON.stringify({
        app: 'Inkwell',
        version: 2,
        exported: new Date().toISOString(),
        notes: notes,
        images: images
      }, null, 2);
    },

    /* Merge an exported file back in. Same id -> keep whichever was edited last. */
    async importJSON(text) {
      let data;
      try { data = JSON.parse(text); } catch (_) { throw new Error('That file is not valid JSON.'); }
      const incoming = Array.isArray(data) ? data : (data && Array.isArray(data.notes) ? data.notes : null);
      if (!incoming) throw new Error('No notes found in that file.');

      /* Photos first: a note is no use if the picture it shows is missing. */
      let photos = 0;
      const haveIds = new Set(await this.allImageIds());
      const pics = (data && Array.isArray(data.images)) ? data.images : [];
      for (const img of pics) {
        if (!img || typeof img.id !== 'string' || haveIds.has(img.id)) continue;
        const blob = dataURLToBlob(img.data);
        if (!blob) continue;
        try {
          await this.putImageRecord({
            id: img.id,
            type: blob.type || img.type || 'image/jpeg',
            w: Number(img.w) || 0,
            h: Number(img.h) || 0,
            bytes: blob.size,
            added: Number.isFinite(img.added) ? img.added : Date.now()
          }, blob);
          haveIds.add(img.id);
          photos++;
        } catch (_) { /* out of room — the note still imports, minus its photo */ }
      }

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
      return { added, updated, photos, skipped: clean.length - added - updated };
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
