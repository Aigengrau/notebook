/* ============================================================
   app.js — Inkwell UI
   ============================================================ */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const el = {
    root: document.documentElement,
    app: $('#app'),
    appbar: $('#appbar'),
    viewTitle: $('#viewTitle'),
    btnMenu: $('#btnMenu'), btnSearch: $('#btnSearch'), btnLayout: $('#btnLayout'),
    searchwrap: $('#searchwrap'), search: $('#search'), btnClearSearch: $('#btnClearSearch'),
    chips: $('#chips'), sheet: $('#sheet'),
    pinnedGroup: $('#pinnedGroup'), pinnedList: $('#pinnedList'),
    otherHead: $('#otherHead'), notesList: $('#notesList'),
    empty: $('#empty'), emptyTitle: $('#emptyTitle'), emptySub: $('#emptySub'),
    trashbar: $('#trashbar'), trashCount: $('#trashCount'), btnEmptyTrash: $('#btnEmptyTrash'),
    fab: $('#btnNew'),
    scrim: $('#scrim'), drawer: $('#drawer'), drawerNav: $('#drawerNav'),
    tagList: $('#tagList'), statLine: $('#statLine'),
    themeSeg: $('#themeSeg'), sortSeg: $('#sortSeg'),
    btnExport: $('#btnExport'), btnImport: $('#btnImport'), fileImport: $('#fileImport'),
    installSect: $('#installSect'), btnInstall: $('#btnInstall'),
    btnUpdate: $('#btnUpdate'), updateHint: $('#updateHint'), verLine: $('#verLine'),
    editor: $('#editor'), edBar: $('.ed-bar'), edScroll: $('#edScroll'),
    edTitle: $('#edTitle'), edTags: $('#edTags'), edBody: $('#edBody'), edFooter: $('#edFooter'),
    edMeta: $('#edMeta'),
    btnBack: $('#btnBack'), btnPin: $('#btnPin'), btnPalette: $('#btnPalette'), btnMore: $('#btnMore'),
    toolbar: $('#toolbar'),
    filePhoto: $('#filePhoto'), fileCamera: $('#fileCamera'),
    lightbox: $('#lightbox'), lbImg: $('#lbImg'), lbClose: $('#lbClose'),
    sheetLayer: $('#sheetLayer'), sheetScrim: $('#sheetScrim'),
    bottomSheet: $('#bottomSheet'), sheetBody: $('#sheetBody'),
    dialog: $('#dialog'), dlgTitle: $('#dlgTitle'), dlgBody: $('#dlgBody'),
    dlgCancel: $('#dlgCancel'), dlgOk: $('#dlgOk'),
    toast: $('#toast')
  };

  const COLORS = ['none', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink', 'sand'];
  const TRASH_DAYS = 30;
  const APP_VERSION = '1.1.2';

  /* Announce which build is actually running, but only if store.js came from
     the same one. index.html compares this with the version the service worker
     is serving: a mismatch means a script survived in a cache it should not
     have, and the page mends itself rather than running half updated. */
  if (window.Store && Store.version === APP_VERSION) window.INKWELL_RUNNING = APP_VERSION;

  /* photos: phone cameras hand us 12 megapixels, which no note needs */
  const PHOTO_MAX_DIM = 1600;
  const PHOTO_QUALITY = 0.85;
  const PHOTO_MAX_FILE = 40 * 1024 * 1024;
  const PHOTOS_PER_GO = 12;

  const state = {
    view: 'all',        // 'all' | 'pinned' | 'trash' | 'tag'
    tag: null,
    query: '',
    sort: 'updated',
    layout: 'grid',
    theme: 'auto',
    editing: null       // id of the note open in the editor
  };

  /* ============================================================
     utilities
     ============================================================ */

  const escapeHTML = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Keep only the markup the editor itself produces. Imported files and
     pasted content are otherwise free to smuggle in scripts. */
  const ALLOWED = {
    P: [], DIV: [], BR: [], H2: [], H3: [], UL: ['class'], OL: [], LI: ['data-done'],
    BLOCKQUOTE: [], PRE: [], CODE: [], B: [], STRONG: [], I: [], EM: [], U: [],
    S: [], STRIKE: [], DEL: [], HR: [], SPAN: [], A: ['href'], IMG: ['data-img', 'alt']
  };
  /* these go entirely — keeping their text would just leak code into the note */
  const DROP = {
    SCRIPT: 1, STYLE: 1, IFRAME: 1, FRAME: 1, OBJECT: 1, EMBED: 1, APPLET: 1,
    LINK: 1, META: 1, BASE: 1, TITLE: 1, NOSCRIPT: 1, TEMPLATE: 1,
    SVG: 1, MATH: 1, FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1, SELECT: 1,
    AUDIO: 1, VIDEO: 1, CANVAS: 1
  };
  /* `src` is deliberately not in IMG's list: a photo is identified only by
     the id of its record in our own store, and the blob: URL the editor is
     showing is re-attached at display time. Anything else — a pasted remote
     image, a data: URI, javascript: — loses its source and is dropped. */
  const IMG_ID = /^i[0-9a-z]+-[0-9a-z]+$/;

  function sanitizeHTML(html) {
    const doc = document.implementation.createHTMLDocument('');
    doc.body.innerHTML = String(html || '');

    const scrub = parent => {
      let child = parent.firstChild;
      while (child) {
        const next = child.nextSibling;
        if (child.nodeType === 3) { child = next; continue; }          // text is fine
        if (child.nodeType !== 1) { child.remove(); child = next; continue; }

        const tag = child.tagName;
        if (DROP[tag]) { child.remove(); child = next; continue; }

        if (!ALLOWED[tag]) {
          // unknown wrapper: keep the words, drop the element
          const first = child.firstChild;
          while (child.firstChild) parent.insertBefore(child.firstChild, child);
          child.remove();
          child = first || next;
          continue;
        }

        [...child.attributes].forEach(a => {
          const name = a.name.toLowerCase();
          if (ALLOWED[tag].indexOf(name) < 0) { child.removeAttribute(a.name); return; }
          if (name === 'href' && !/^(https?:|mailto:|tel:)/i.test(a.value.trim())) child.removeAttribute(a.name);
          if (name === 'class') {
            if (/\btodo\b/.test(a.value)) child.setAttribute('class', 'todo');
            else child.removeAttribute('class');
          }
          if (name === 'data-done') child.setAttribute('data-done', a.value === '1' ? '1' : '');
        });
        if (tag === 'IMG' && !IMG_ID.test(child.getAttribute('data-img') || '')) {
          child.remove(); child = next; continue;   // not one of ours
        }
        if (tag === 'A') {
          if (!child.getAttribute('href')) { // a link with nothing to point at is just text
            const first = child.firstChild;
            while (child.firstChild) parent.insertBefore(child.firstChild, child);
            child.remove();
            child = first || next;
            continue;
          }
          child.setAttribute('rel', 'noopener noreferrer');
          child.setAttribute('target', '_blank');
        }

        scrub(child);
        child = next;
      }
    };

    scrub(doc.body);
    return doc.body.innerHTML;
  }

  function htmlToText(html) {
    const doc = document.implementation.createHTMLDocument('');
    doc.body.innerHTML = String(html || '');
    doc.body.querySelectorAll('br').forEach(b => b.replaceWith(doc.createTextNode('\n')));
    doc.body.querySelectorAll('p,div,li,h2,h3,blockquote,pre,hr').forEach(b => b.append(doc.createTextNode('\n')));
    return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }

  const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmtDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const fmtFull = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const fmtLong = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  function relTime(ts) {
    const d = new Date(ts), now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return fmtTime.format(d);
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    if (d.getFullYear() === now.getFullYear()) return fmtDay.format(d);
    return fmtFull.format(d);
  }

  function debounce(fn, ms) {
    let t;
    const wrapped = function () {
      clearTimeout(t);
      const args = arguments;
      t = setTimeout(() => fn.apply(null, args), ms);
    };
    wrapped.flush = () => { clearTimeout(t); fn(); };
    return wrapped;
  }

  /* ============================================================
     photos
     A note stores only the id of each photo. The bytes live in
     their own IndexedDB store, and the blob: URL that actually
     displays them is cached here for the life of the session, so
     re-rendering the library never churns through object URLs.
     ============================================================ */

  const picURL = new Map();     // photo id -> blob: URL
  const picLoading = new Map(); // photo id -> in-flight promise

  function cachePic(id, blob) {
    if (picURL.has(id)) return picURL.get(id);
    const url = URL.createObjectURL(blob);
    picURL.set(id, url);
    return url;
  }

  function loadPic(id) {
    if (picURL.has(id)) return Promise.resolve(picURL.get(id));
    if (picLoading.has(id)) return picLoading.get(id);
    const p = Store.getImage(id)
      .then(rec => (rec && rec.blob ? cachePic(id, rec.blob) : null))
      .catch(() => null);
    picLoading.set(id, p);
    p.then(() => picLoading.delete(id));
    return p;
  }

  /* Attach the real source to every <img data-img> under `root`. */
  function showPics(root) {
    root.querySelectorAll('img[data-img]').forEach(im => {
      const id = im.getAttribute('data-img');
      const ready = picURL.get(id);
      if (ready) { if (im.getAttribute('src') !== ready) im.src = ready; return; }
      loadPic(id).then(url => {
        if (!im.isConnected) return;
        if (url) im.src = url;
        else im.classList.add('gone');
      });
    });
  }

  function decodeImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(() => createImageBitmap(file))      // older option-less signature
        .catch(() => decodeViaElement(file));
    }
    return decodeViaElement(file);
  }

  /* Last resort for browsers without createImageBitmap. */
  function decodeViaElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image Inkwell can read.')); };
      im.src = url;
    });
  }

  /* Shrink to something a note can carry, and keep transparency when the
     source had it. Returns the blob we are going to store. */
  async function prepareImage(file) {
    if (!/^image\//i.test(file.type || '')) throw new Error('That file is not an image.');
    if (file.size > PHOTO_MAX_FILE) throw new Error('That image is too big to store.');

    const bmp = await decodeImage(file);
    const srcW = bmp.width || bmp.naturalWidth || 0;
    const srcH = bmp.height || bmp.naturalHeight || 0;
    if (!srcW || !srcH) throw new Error('That image could not be read.');

    const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(srcW, srcH));

    /* an animated GIF would come out of the canvas as a single frame */
    if (/gif$/i.test(file.type) && scale === 1 && file.size <= 2 * 1024 * 1024) {
      if (bmp.close) bmp.close();
      return { blob: file, w: srcW, h: srcH };
    }

    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();

    /* JPEG would paint anything transparent black, so keep an alpha format */
    const keepsAlpha = /png|webp|gif|svg/i.test(file.type);
    const type = keepsAlpha ? 'image/webp' : 'image/jpeg';
    const out = await new Promise(res => canvas.toBlob(res, type, PHOTO_QUALITY));
    canvas.width = canvas.height = 0;

    if (!out) throw new Error('That photo could not be processed.');
    /* re-encoding small images can make them bigger — then don't bother */
    if (scale === 1 && out.size >= file.size) return { blob: file, w, h };
    return { blob: out, w, h };
  }

  /* ---------- where a photo lands in the note ---------- */

  let savedRange = null;   // the caret, remembered across the file picker

  function rememberCaret() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (el.edBody.contains(r.startContainer)) savedRange = r.cloneRange();
  }

  /* The direct child of the body that the caret sits in, so a photo is
     inserted between blocks instead of inside a paragraph. */
  function topBlockAt(node) {
    while (node && node.parentNode && node.parentNode !== el.edBody) node = node.parentNode;
    return node && node.parentNode === el.edBody ? node : null;
  }

  function insertBlocks(nodes) {
    let anchor = null;
    if (savedRange && el.edBody.contains(savedRange.startContainer)) {
      anchor = topBlockAt(savedRange.startContainer);
    } else {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && el.edBody.contains(sel.getRangeAt(0).startContainer)) {
        anchor = topBlockAt(sel.getRangeAt(0).startContainer);
      }
    }

    const tail = document.createElement('p');
    tail.append(document.createElement('br'));
    const frag = document.createDocumentFragment();
    nodes.forEach(n => frag.append(n));
    frag.append(tail);

    if (anchor) el.edBody.insertBefore(frag, anchor.nextSibling);
    else el.edBody.append(frag);

    savedRange = null;
    try {
      const r = document.createRange();
      r.setStart(tail, 0);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (_) {}
  }

  async function addPhotos(files) {
    if (!state.editing || !files.length) return;
    const forNote = state.editing;      // preparing a photo takes a moment
    const batch = files.slice(0, PHOTOS_PER_GO);
    if (files.length > batch.length) toast(PHOTOS_PER_GO + ' photos at a time');
    else toast(batch.length > 1 ? 'Adding ' + batch.length + ' photos…' : 'Adding photo…');

    const added = [];
    let failure = '';
    for (const file of batch) {
      try {
        const ready = await prepareImage(file);
        const rec = await Store.putImage(ready.blob, { w: ready.w, h: ready.h });
        const im = document.createElement('img');
        im.setAttribute('data-img', rec.id);
        im.alt = '';
        im.src = cachePic(rec.id, ready.blob);
        added.push(im);
      } catch (err) {
        failure = (err && err.message) || 'That photo could not be added.';
      }
    }

    if (!added.length) { toast(failure || 'No photos were added'); return; }

    /* the note was closed or swapped while we were working — the photos are
       already stored, so hand them to the note they were meant for */
    if (state.editing !== forNote) {
      const home = Store.get(forNote);
      if (home) {
        const html = home.html + added.map(im => im.outerHTML).join('') + '<p><br></p>';
        Store.update(forNote, { html: sanitizeHTML(html) });
      }
      render();
      toast(added.length > 1 ? added.length + ' photos saved to that note' : 'Photo saved to that note');
      return;
    }

    insertBlocks(added);
    dirty = true;
    syncPlaceholder();
    saveNow();                      // a photo is too much work to risk losing
    render();
    toast(failure ? 'Added ' + added.length + ' of ' + batch.length + ' — ' + failure
                  : (added.length > 1 ? added.length + ' photos added' : 'Photo added'));
  }

  function photoSheet() {
    rememberCaret();
    openSheet(parent => {
      sheetTitle(parent, 'Add a photo');
      sheetRow(parent, { icon: ICONS.camera, label: 'Take a photo', onTap: () => el.fileCamera.click() });
      sheetRow(parent, { icon: ICONS.gallery, label: 'Choose from gallery', onTap: () => el.filePhoto.click() });
    });
  }

  function onPhotoPick(input) {
    const files = input.files ? [...input.files] : [];
    input.value = '';                                  // so picking the same file twice works
    if (files.length) addPhotos(files);
  }

  /* ---------- a photo already in a note ---------- */

  function photoActions(im) {
    const id = im.getAttribute('data-img');
    openSheet(parent => {
      sheetTitle(parent, 'Photo');
      sheetRow(parent, { icon: ICONS.expand, label: 'View full size', onTap: () => openLightbox(id) });
      sheetRow(parent, { icon: ICONS.save, label: 'Save to device', onTap: () => savePhoto(id) });
      sheetRow(parent, { icon: ICONS.trash, label: 'Remove photo', danger: true, onTap: () => {
        const forNote = state.editing;
        const home = im.parentNode, after = im.nextSibling;
        im.remove();
        dirty = true; syncPlaceholder(); saveNow(); render();
        /* The bytes are not collected until the next launch, so Undo always has
           something to put back — even once the note has been closed, when the
           photo goes back on the end rather than exactly where it was. */
        toast('Photo removed', 'Undo', () => {
          if (state.editing === forNote && home) {
            home.insertBefore(im, after);
            dirty = true; syncPlaceholder(); saveNow();
          } else {
            const note = Store.get(forNote);
            if (!note) return;
            Store.update(forNote, { html: sanitizeHTML(note.html + im.outerHTML + '<p><br></p>') });
          }
          render();
        });
      } });
    });
  }

  function openLightbox(id) {
    loadPic(id).then(url => {
      if (!url) return toast('That photo is missing');
      el.lbImg.src = url;
      el.lightbox.hidden = false;
      requestAnimationFrame(() => el.lightbox.classList.add('show'));
      pushOverlay('lightbox', hideLightbox);
    });
  }
  function hideLightbox() {
    el.lightbox.classList.remove('show');
    setTimeout(() => { el.lightbox.hidden = true; el.lbImg.removeAttribute('src'); }, 220);
  }
  el.lightbox.addEventListener('click', () => { if (isOpen('lightbox')) popOverlay(); });

  async function savePhoto(id) {
    const rec = await Store.getImage(id);
    if (!rec || !rec.blob) return toast('That photo is missing');
    const type = rec.type || rec.blob.type || '';
    const ext = /png/i.test(type) ? 'png' : /webp/i.test(type) ? 'webp'
              : /gif/i.test(type) ? 'gif' : 'jpg';
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inkwell-photo-' + id + '.' + ext;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Saved to your downloads');
  }

  /* ============================================================
     toast · dialog
     ============================================================ */

  let toastTimer = null;
  function toast(message, actionLabel, onAction) {
    clearTimeout(toastTimer);
    el.toast.textContent = '';
    el.toast.append(document.createTextNode(message));
    if (actionLabel) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = actionLabel;
      b.addEventListener('click', () => { hideToast(); onAction && onAction(); });
      el.toast.append(b);
    }
    el.toast.classList.add('show');
    toastTimer = setTimeout(hideToast, actionLabel ? 6000 : 2600);
  }
  function hideToast() { clearTimeout(toastTimer); el.toast.classList.remove('show'); }

  function confirmDialog(opts) {
    return new Promise(resolve => {
      let answer = false;
      el.dlgTitle.textContent = opts.title;
      el.dlgBody.textContent = opts.body || '';
      el.dlgOk.textContent = opts.ok || 'Delete';
      el.dlgCancel.textContent = opts.cancel || 'Cancel';
      el.dlgOk.classList.toggle('danger', opts.danger !== false);
      el.dialog.hidden = false;
      requestAnimationFrame(() => el.dialog.classList.add('show'));

      /* the dialog joins the overlay stack so Android's back button dismisses it */
      const cleanup = () => {
        el.dialog.classList.remove('show');
        setTimeout(() => { el.dialog.hidden = true; }, 200);
        el.dlgOk.removeEventListener('click', ok);
        el.dlgCancel.removeEventListener('click', no);
        el.dialog.removeEventListener('click', backdrop);
        resolve(answer);
      };
      const ok = () => { answer = true; popOverlay(); };
      const no = () => { answer = false; popOverlay(); };
      const backdrop = e => { if (e.target === el.dialog) no(); };
      el.dlgOk.addEventListener('click', ok);
      el.dlgCancel.addEventListener('click', no);
      el.dialog.addEventListener('click', backdrop);
      pushOverlay('dialog', cleanup);
    });
  }

  /* ============================================================
     overlay stack — so the Android back button does the right thing
     ============================================================ */

  const overlays = [];

  function pushOverlay(name, close) {
    overlays.push({ name, close });
    history.pushState({ inkwell: overlays.length }, '');
  }
  function popOverlay() { if (overlays.length) history.back(); }
  function isOpen(name) { return overlays.some(o => o.name === name); }

  window.addEventListener('popstate', () => {
    const top = overlays.pop();
    if (top) top.close();
  });

  /* ============================================================
     theme & layout
     ============================================================ */

  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme() {
    const dark = state.theme === 'dark' || (state.theme === 'auto' && mqDark.matches);
    el.root.classList.toggle('is-dark', dark);
    el.root.setAttribute('data-theme', state.theme === 'auto' ? (dark ? 'dark' : 'light') : state.theme);
    [...el.themeSeg.children].forEach(b => b.classList.toggle('on', b.dataset.theme === state.theme));
  }
  mqDark.addEventListener('change', () => { if (state.theme === 'auto') applyTheme(); });

  function applyLayout() {
    el.root.setAttribute('data-layout', state.layout);
  }

  function applySort() {
    [...el.sortSeg.children].forEach(b => b.classList.toggle('on', b.dataset.sort === state.sort));
  }

  /* ============================================================
     library rendering
     ============================================================ */

  function sortNotes(list) {
    const by = state.sort;
    return list.slice().sort((a, b) => {
      if (by === 'title') {
        const at = (a.title || htmlToText(a.html)).trim().toLowerCase();
        const bt = (b.title || htmlToText(b.html)).trim().toLowerCase();
        if (!at && bt) return 1;
        if (at && !bt) return -1;
        return at.localeCompare(bt) || b.updated - a.updated;
      }
      if (by === 'created') return b.created - a.created;
      return b.updated - a.updated;
    });
  }

  function matches(note, q) {
    if (!q) return true;
    const hay = (note.title + '\n' + note.text + '\n' + note.tags.join(' ')).toLowerCase();
    return q.split(/\s+/).filter(Boolean).every(term => hay.indexOf(term) >= 0);
  }

  function currentNotes() {
    const q = state.query.trim().toLowerCase();
    let list = state.view === 'trash' ? Store.trash() : Store.live();
    if (state.view === 'pinned') list = list.filter(n => n.pinned);
    if (state.view === 'tag') list = list.filter(n => n.tags.indexOf(state.tag) >= 0);
    return sortNotes(list.filter(n => matches(n, q)));
  }

  function highlight(text, q) {
    const safe = escapeHTML(text);
    const terms = q.trim().toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (!terms.length) return safe;
    const re = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  }

  function snippetOf(note) {
    const t = note.text || htmlToText(note.html);
    return t.slice(0, 320);
  }

  function cardFor(note, i) {
    const q = state.query;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.id = note.id;
    if (note.color && note.color !== 'none') card.dataset.color = note.color;
    if (note.pinned) card.classList.add('haspin');
    card.style.animationDelay = Math.min(i, 12) * 14 + 'ms';

    const title = (note.title || '').trim();
    const snippet = snippetOf(note);
    const pics = note.pics || [];
    let html = '';

    if (note.pinned) {
      html += '<svg class="cpin" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3.5h5l-.7 5.2 3.2 3.3h-4.6L12 20.5l-.4-8.5H7l3.2-3.3z"/></svg>';
    }
    if (pics.length) {
      const shown = pics.slice(0, 3);
      html += '<div class="thumbs" data-n="' + shown.length + '">' +
        shown.map(id => '<img class="cthumb" data-img="' + escapeHTML(id) + '" alt="" loading="lazy" decoding="async">').join('') +
        (pics.length > shown.length ? '<span class="morepics">+' + (pics.length - shown.length) + '</span>' : '') +
        '</div>';
      card.classList.add('haspics');
    }
    if (title) html += '<h3>' + highlight(title, q) + '</h3>';
    if (snippet) html += '<p class="snippet">' + highlight(snippet, q) + '</p>';
    if (!title && !snippet && !pics.length) html += '<p class="snippet muted">Empty note</p>';

    html += '<div class="cardfoot"><time datetime="' + new Date(note.updated).toISOString() + '">' +
            escapeHTML(state.view === 'trash' ? 'Trashed ' + relTime(note.trashed) : relTime(note.updated)) +
            '</time>';
    note.tags.slice(0, 2).forEach(t => { html += '<span class="minitag">' + escapeHTML(t) + '</span>'; });
    if (note.tags.length > 2) html += '<span class="minitag">+' + (note.tags.length - 2) + '</span>';
    html += '</div>';

    card.innerHTML = html;
    if (pics.length) showPics(card);
    card.addEventListener('click', () => {
      if (state.view === 'trash') return trashedNoteSheet(note.id);
      openEditor(note.id);
    });
    return card;
  }

  function render() {
    const list = currentNotes();
    const splitPinned = state.view !== 'trash' && state.view !== 'pinned';
    const pinned = splitPinned ? list.filter(n => n.pinned) : [];
    const rest = splitPinned ? list.filter(n => !n.pinned) : list;

    el.pinnedList.textContent = '';
    el.notesList.textContent = '';
    pinned.forEach((n, i) => el.pinnedList.append(cardFor(n, i)));
    rest.forEach((n, i) => el.notesList.append(cardFor(n, i + pinned.length)));

    el.pinnedGroup.hidden = !pinned.length;
    el.otherHead.hidden = !(pinned.length && rest.length);
    el.empty.hidden = list.length > 0;

    if (!list.length) {
      if (state.query) {
        el.emptyTitle.textContent = 'No matches';
        el.emptySub.textContent = 'Nothing here contains “' + state.query.trim() + '”.';
      } else if (state.view === 'trash') {
        el.emptyTitle.textContent = 'Trash is empty';
        el.emptySub.textContent = 'Deleted notes wait here for ' + TRASH_DAYS + ' days.';
      } else if (state.view === 'pinned') {
        el.emptyTitle.textContent = 'No pinned notes';
        el.emptySub.textContent = 'Pin a note to keep it at the top.';
      } else if (state.view === 'tag') {
        el.emptyTitle.textContent = 'Nothing tagged “' + state.tag + '”';
        el.emptySub.textContent = 'Add this tag to a note to see it here.';
      } else {
        el.emptyTitle.textContent = 'Your notebook is empty';
        el.emptySub.textContent = 'Tap the plus button to write your first note.';
      }
    }

    const trashed = Store.trash().length;
    el.trashbar.hidden = state.view !== 'trash' || !trashed;
    el.trashCount.textContent = trashed + (trashed === 1 ? ' note in Trash' : ' notes in Trash');
    el.fab.classList.toggle('hidden', state.view === 'trash');

    el.viewTitle.textContent =
      state.view === 'trash' ? 'Trash' :
      state.view === 'pinned' ? 'Pinned' :
      state.view === 'tag' ? '#' + state.tag : 'Inkwell';

    renderChips();
    renderDrawer();
  }

  function renderChips() {
    const tags = Store.tags();
    el.chips.textContent = '';
    if (state.view === 'trash' || !tags.length) return;

    const add = (label, active, onTap) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (active ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', onTap);
      el.chips.append(b);
    };
    add('All', state.view === 'all', () => setView('all'));
    add('Pinned', state.view === 'pinned', () => setView('pinned'));
    tags.forEach(t => add('#' + t.name, state.view === 'tag' && state.tag === t.name,
      () => setView('tag', t.name)));
  }

  const NAV = [
    { view: 'all', label: 'All notes', icon: '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>' },
    { view: 'pinned', label: 'Pinned', icon: '<path d="M9.5 3.5h5l-.7 5.2 3.2 3.3h-4.6L12 20.5l-.4-8.5H7l3.2-3.3z"/>' },
    { view: 'trash', label: 'Trash', icon: '<path d="M4.5 7h15M9.5 7V4.6h5V7M6.5 7l1 12.4h9l1-12.4M10.5 10.5v6M13.5 10.5v6"/>' }
  ];

  function renderDrawer() {
    const live = Store.live();
    const tags = Store.tags();
    const pics = Store.photoCount();
    el.statLine.textContent =
      live.length + (live.length === 1 ? ' note' : ' notes') +
      (tags.length ? ' · ' + tags.length + (tags.length === 1 ? ' tag' : ' tags') : '') +
      (pics ? ' · ' + pics + (pics === 1 ? ' photo' : ' photos') : '');

    el.drawerNav.textContent = '';
    NAV.forEach(item => {
      const count = item.view === 'all' ? live.length
        : item.view === 'pinned' ? live.filter(n => n.pinned).length
        : Store.trash().length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'navitem' + (state.view === item.view ? ' on' : '');
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + item.icon + '</svg>' +
                    '<span>' + item.label + '</span>' +
                    '<span class="count">' + (count || '') + '</span>';
      b.addEventListener('click', () => { setView(item.view); closeDrawer(); });
      el.drawerNav.append(b);
    });

    el.tagList.textContent = '';
    tags.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tagpill' + (state.view === 'tag' && state.tag === t.name ? ' on' : '');
      b.textContent = '#' + t.name + ' · ' + t.count;
      b.addEventListener('click', () => { setView('tag', t.name); closeDrawer(); });
      el.tagList.append(b);
    });
  }

  function setView(view, tag) {
    state.view = view;
    state.tag = tag || null;
    el.sheet.scrollTop = 0;
    window.scrollTo(0, 0);
    render();
  }

  /* ============================================================
     drawer
     ============================================================ */

  function openDrawer() {
    if (isOpen('drawer')) return;
    el.scrim.hidden = false;
    requestAnimationFrame(() => {
      el.scrim.classList.add('show');
      el.drawer.classList.add('open');
    });
    document.body.classList.add('no-scroll');
    pushOverlay('drawer', hideDrawer);
  }
  function hideDrawer() {
    el.drawer.classList.remove('open');
    el.scrim.classList.remove('show');
    setTimeout(() => { el.scrim.hidden = true; }, 240);
    if (!el.editor.classList.contains('open')) document.body.classList.remove('no-scroll');
  }
  function closeDrawer() { if (isOpen('drawer')) popOverlay(); }

  el.btnMenu.addEventListener('click', openDrawer);
  el.scrim.addEventListener('click', closeDrawer);

  /* ============================================================
     bottom sheet
     ============================================================ */

  function openSheet(build) {
    el.sheetBody.textContent = '';
    build(el.sheetBody);
    el.sheetLayer.hidden = false;
    requestAnimationFrame(() => el.sheetLayer.classList.add('show'));
    /* reopening while one is already up just swaps the contents */
    if (!isOpen('sheet')) pushOverlay('sheet', hideSheet);
  }
  function hideSheet() {
    el.sheetLayer.classList.remove('show');
    setTimeout(() => { el.sheetLayer.hidden = true; }, 260);
  }
  function closeSheet() { if (isOpen('sheet')) popOverlay(); }
  el.sheetScrim.addEventListener('click', closeSheet);

  function sheetTitle(parent, text) {
    const p = document.createElement('p');
    p.className = 'sheet-title';
    p.textContent = text;
    parent.append(p);
  }
  function sheetRow(parent, opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sheet-row' + (opts.danger ? ' danger' : '');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + opts.icon + '</svg>' +
                  '<span>' + escapeHTML(opts.label) + '</span>' +
                  (opts.hint ? '<span class="hint">' + escapeHTML(opts.hint) + '</span>' : '');
    b.addEventListener('click', () => { closeSheet(); setTimeout(opts.onTap, 60); });
    parent.append(b);
    return b;
  }

  const ICONS = {
    share: '<path d="M16 7.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM16 21.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM10.2 10.9l3.6-2.1M10.2 13.1l3.6 2.1"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="12" rx="2.2"/><path d="M15.5 5.5H6.7A2.2 2.2 0 004.5 7.7v8.8"/>',
    duplicate: '<rect x="4.5" y="4.5" width="11" height="11" rx="2.2"/><path d="M8.5 19.5h8.8a2.2 2.2 0 002.2-2.2V8.5"/>',
    tag: '<path d="M4.5 10.5V5.5a1 1 0 011-1h5l9 9-6 6-9-9z"/><circle cx="8.3" cy="8.3" r="1.1" fill="currentColor" stroke="none"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.6h5V7M6.5 7l1 12.4h9l1-12.4M10.5 10.5v6M13.5 10.5v6"/>',
    restore: '<path d="M4 12a8 8 0 1114 5.3M4 12V7M4 12h5"/>',
    info: '<circle cx="12" cy="12" r="8.2"/><path d="M12 11v5.5"/><circle cx="12" cy="8.2" r="1" fill="currentColor" stroke="none"/>',
    pin: '<path d="M9.5 3.5h5l-.7 5.2 3.2 3.3h-4.6L12 20.5l-.4-8.5H7l3.2-3.3z"/>',
    palette: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="8.7" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.1" cy="11.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="8.9" cy="11.7" r="1.15" fill="currentColor" stroke="none"/>',
    camera: '<path d="M4 8.6h2.8l1.4-2.4h7.6l1.4 2.4H20a1.5 1.5 0 011.5 1.5v7.4A1.5 1.5 0 0120 19.5H4a1.5 1.5 0 01-1.5-1.5v-7.4A1.5 1.5 0 014 8.6z"/><circle cx="12" cy="13.8" r="3.3"/>',
    gallery: '<rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.6"/><circle cx="8.7" cy="10.1" r="1.7"/><path d="M3.6 16.6l4.4-4.1 3.2 3 3.3-3.5 6.3 6"/>',
    photo: '<rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.6"/><circle cx="8.7" cy="10.1" r="1.7"/><path d="M3.6 16.6l4.4-4.1 3.2 3 3.3-3.5 6.3 6"/>',
    expand: '<path d="M9.5 4.5h-5v5M14.5 19.5h5v-5M19.5 9.5v-5h-5M4.5 14.5v5h5"/>',
    save: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>'
  };

  /* ============================================================
     editor
     ============================================================ */

  let dirty = false;
  let composing = false;    // true while an IME is mid-word

  /* Sanitising the body builds a whole throwaway document, so this bails out
     the moment there is nothing to write — blur, backgrounding and closing the
     editor all land here and used to pay that cost whether or not anything
     had changed. */
  const saveNow = () => {
    if (!dirty || !state.editing) return;
    const note = Store.get(state.editing);
    if (!note) { dirty = false; return; }
    const html = sanitizeHTML(el.edBody.innerHTML);
    const text = htmlToText(html);
    const title = el.edTitle.value.replace(/\s*\n+\s*/g, ' ').trim();   // pasted titles stay one line
    dirty = false;
    if (note.title === title && note.html === html) return;
    Store.update(state.editing, { title, html, text });
    updateEdMeta();
  };
  const saveSoon = debounce(saveNow, 600);

  function updateEdMeta() {
    const note = Store.get(state.editing);
    if (!note) return;
    el.edMeta.textContent = 'Edited ' + relTime(note.updated);
    const words = (note.text.match(/[^\s]+/g) || []).length;
    const chars = note.text.length;
    el.edFooter.textContent =
      words + (words === 1 ? ' word' : ' words') + ' · ' + chars + ' characters\n' +
      'Created ' + fmtLong.format(new Date(note.created));
  }

  /* the title is a textarea so long titles wrap — keep it exactly as tall as its text */
  function growTitle() {
    el.edTitle.style.height = 'auto';
    el.edTitle.style.height = el.edTitle.scrollHeight + 'px';
  }

  function syncPlaceholder() {
    const empty = !el.edBody.textContent.trim() && !el.edBody.querySelector('hr,img');
    el.edBody.classList.toggle('blank', empty);
  }

  function renderEdTags() {
    const note = Store.get(state.editing);
    el.edTags.textContent = '';
    if (!note) return;
    note.tags.forEach(t => {
      const pill = document.createElement('span');
      pill.className = 'etag';
      pill.append(document.createTextNode('#' + t));
      const x = document.createElement('button');
      x.type = 'button';
      x.setAttribute('aria-label', 'Remove tag ' + t);
      x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      x.addEventListener('click', () => {
        Store.update(note.id, { tags: note.tags.filter(x2 => x2 !== t) }, false);
        renderEdTags(); render();
      });
      pill.append(x);
      el.edTags.append(pill);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'addtag';
    add.textContent = note.tags.length ? '+ tag' : '+ add a tag';
    add.addEventListener('click', tagSheet);
    el.edTags.append(add);
  }

  function openEditor(id, focusBody) {
    const note = Store.get(id);
    if (!note) return;
    state.editing = id;
    dirty = false;

    el.edTitle.value = note.title || '';
    el.edBody.innerHTML = sanitizeHTML(note.html);
    showPics(el.edBody);              // the markup keeps ids; attach the pixels
    el.editor.dataset.color = note.color && note.color !== 'none' ? note.color : '';
    el.btnPin.classList.toggle('on', !!note.pinned);
    el.btnPin.setAttribute('aria-label', note.pinned ? 'Unpin note' : 'Pin note');
    renderEdTags();
    updateEdMeta();
    syncPlaceholder();
    growTitle();
    requestAnimationFrame(growTitle);
    el.edScroll.scrollTop = 0;
    el.edBar.classList.remove('scrolled');

    el.editor.setAttribute('aria-hidden', 'false');
    el.editor.classList.add('open');
    el.app.classList.add('behind');
    document.body.classList.add('no-scroll');
    pushOverlay('editor', hideEditor);

    if (focusBody) setTimeout(() => el.edBody.focus(), 220);
    else if (!note.title && !note.html) setTimeout(() => el.edTitle.focus(), 220);
  }

  function hideEditor() {
    composing = false;
    savedRange = null;
    saveSoon.flush();
    const note = Store.get(state.editing);

    el.editor.classList.remove('open');
    el.editor.setAttribute('aria-hidden', 'true');
    el.app.classList.remove('behind');
    document.body.classList.remove('no-scroll');
    el.toolbar.classList.remove('show');
    document.activeElement && document.activeElement.blur();

    // an untouched new note should not clutter the library
    if (note && Store.isBlank(note)) Store.destroy(note.id);
    state.editing = null;
    render();

    /* an update that turned up while the note was open */
    if (updateWaiting) {
      const ask = updateWaiting;
      updateWaiting = null;
      setTimeout(ask, 450);
    }
  }

  function closeEditor() { if (isOpen('editor')) popOverlay(); }

  el.btnBack.addEventListener('click', closeEditor);

  el.edTitle.addEventListener('input', () => {
    dirty = true;
    growTitle();
    if (!composing) saveSoon();
  });
  el.edTitle.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !composing) { e.preventDefault(); el.edBody.focus(); }
  });
  el.edBody.addEventListener('input', () => {
    dirty = true;
    /* mid-composition the IME owns the DOM — touching it here is what used to
       make Gboard stutter and die when the language was switched */
    if (composing) return;
    syncPlaceholder();
    saveSoon();
    queueToolbarState();
  });
  el.edBody.addEventListener('blur', () => { if (dirty && !composing) saveNow(); });

  /* An IME (Japanese, Chinese, Korean, or any swipe/suggestion keyboard) feeds
     us a stream of provisional text. Hold still until it has finished. */
  const startComposing = () => { composing = true; };
  const stopComposing = () => {
    if (!composing) return;
    composing = false;
    dirty = true;
    syncPlaceholder();
    saveSoon();
    queueToolbarState();
  };
  [el.edBody, el.edTitle].forEach(node => {
    node.addEventListener('compositionstart', startComposing);
    node.addEventListener('compositionend', stopComposing);
    node.addEventListener('compositioncancel', stopComposing);
    /* switching keyboards can tear the IME down without a compositionend */
    node.addEventListener('blur', stopComposing);
  });

  /* paste photos as photos, everything else as plain text so foreign styles
     never leak in */
  el.edBody.addEventListener('paste', e => {
    const dt = e.clipboardData || window.clipboardData;
    e.preventDefault();
    if (!dt) return;
    const pics = dt.files ? [...dt.files].filter(f => /^image\//i.test(f.type || '')) : [];
    if (pics.length) { rememberCaret(); addPhotos(pics); return; }
    document.execCommand('insertText', false, dt.getData('text/plain'));
  });

  /* tapping a photo opens what you can do with it */
  el.edBody.addEventListener('click', e => {
    const im = e.target && e.target.tagName === 'IMG' ? e.target : null;
    if (!im || !im.hasAttribute('data-img')) return;
    e.preventDefault();
    photoActions(im);
  });

  /* checkbox taps in checklists */
  el.edBody.addEventListener('pointerdown', e => {
    const li = e.target.closest ? e.target.closest('li') : null;
    if (!li || !li.parentElement || !li.parentElement.classList.contains('todo')) return;
    const r = li.getBoundingClientRect();
    if (e.clientX - r.left > 30) return;
    e.preventDefault();
    li.setAttribute('data-done', li.getAttribute('data-done') === '1' ? '' : '1');
    dirty = true; saveNow();
  });

  /* a fresh checklist row starts unticked */
  el.edBody.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const li = currentBlock('li');
    if (!li || !li.parentElement.classList.contains('todo')) return;
    setTimeout(() => {
      const now = currentBlock('li');
      if (now && now !== li) now.setAttribute('data-done', '');
    }, 0);
  });

  function currentBlock(tag) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentNode;
    if (!node || !node.closest) return null;
    if (!el.edBody.contains(node)) return null;
    return tag ? node.closest(tag) : node;
  }

  /* ---------- toolbar ---------- */

  function exec(cmd, val) {
    document.execCommand(cmd, false, val || null);
    dirty = true;
    syncPlaceholder();
    saveSoon();
    refreshToolbarState();
  }

  function closestList() {
    const node = currentBlock();
    return node && node.closest ? node.closest('ul') : null;
  }

  function toggleBlock(tag) {
    const node = currentBlock();
    const inside = node && node.closest && node.closest(tag);
    exec('formatBlock', inside ? '<P>' : '<' + tag + '>');
  }

  function runCommand(cmd) {
    if (!el.edBody.contains(document.activeElement)) el.edBody.focus();

    switch (cmd) {
      case 'heading':  return toggleBlock('H2');
      case 'quote':    return toggleBlock('BLOCKQUOTE');
      case 'divider':  return exec('insertHTML', '<hr><p><br></p>');
      case 'photo':    return photoSheet();
      case 'code': {
        const sel = window.getSelection();
        const node = currentBlock();
        const inCode = node && node.closest && node.closest('code');
        if (inCode) {
          const parent = inCode.parentNode;
          while (inCode.firstChild) parent.insertBefore(inCode.firstChild, inCode);
          inCode.remove();
          dirty = true; saveSoon(); refreshToolbarState();
          return;
        }
        const text = sel ? sel.toString() : '';
        if (!text) return toast('Select some text first');
        return exec('insertHTML', '<code>' + escapeHTML(text) + '</code>&#8203;');
      }
      case 'checklist': {
        const ul = closestList();
        if (ul && ul.classList.contains('todo')) return exec('insertUnorderedList');
        if (ul) { ul.classList.add('todo'); dirty = true; saveSoon(); return refreshToolbarState(); }
        exec('insertUnorderedList');
        const fresh = closestList();
        if (fresh) {
          fresh.classList.add('todo');
          [...fresh.children].forEach(li => { if (!li.hasAttribute('data-done')) li.setAttribute('data-done', ''); });
          dirty = true; saveSoon();
        }
        return refreshToolbarState();
      }
      case 'insertUnorderedList': {
        const ul = closestList();
        if (ul && ul.classList.contains('todo')) { ul.classList.remove('todo'); dirty = true; saveSoon(); return refreshToolbarState(); }
        return exec('insertUnorderedList');
      }
      default: return exec(cmd);
    }
  }

  function refreshToolbarState() {
    const ul = closestList();
    el.toolbar.querySelectorAll('button[data-cmd]').forEach(b => {
      const cmd = b.dataset.cmd;
      let on = false;
      try {
        if (cmd === 'bold' || cmd === 'italic' || cmd === 'strikeThrough') on = document.queryCommandState(cmd);
        else if (cmd === 'insertOrderedList') on = document.queryCommandState('insertOrderedList');
      } catch (_) {}
      if (cmd === 'insertUnorderedList') on = !!(ul && !ul.classList.contains('todo'));
      if (cmd === 'checklist') on = !!(ul && ul.classList.contains('todo'));
      if (cmd === 'heading') on = !!currentBlock('h2');
      if (cmd === 'quote') on = !!currentBlock('blockquote');
      if (cmd === 'code') on = !!currentBlock('code');
      if (cmd === 'photo') on = false;
      b.classList.toggle('on', !!on);
    });
  }

  /* queryCommandState and the ancestor walks behind it are not free, and
     selectionchange fires on every keystroke — so at most one pass a frame,
     and none at all while an IME is composing. */
  let toolbarFrame = 0;
  function queueToolbarState() {
    if (toolbarFrame || composing) return;
    toolbarFrame = requestAnimationFrame(() => {
      toolbarFrame = 0;
      if (!composing) refreshToolbarState();
    });
  }

  el.toolbar.querySelectorAll('button[data-cmd]').forEach(b => {
    b.addEventListener('pointerdown', e => e.preventDefault());   // keep the caret
    b.addEventListener('click', () => runCommand(b.dataset.cmd));
  });

  document.addEventListener('selectionchange', () => {
    if (el.editor.classList.contains('open')) queueToolbarState();
  });

  /* show the toolbar only while the body has focus */
  el.edBody.addEventListener('focus', () => el.toolbar.classList.add('show'));
  el.edBody.addEventListener('blur', () => {
    setTimeout(() => {
      if (!el.edBody.contains(document.activeElement)) el.toolbar.classList.remove('show');
    }, 120);
  });

  /* ---------- editor actions ---------- */

  el.btnPin.addEventListener('click', () => {
    const note = Store.get(state.editing);
    if (!note) return;
    const pinned = !note.pinned;
    Store.update(note.id, { pinned }, false);
    el.btnPin.classList.toggle('on', pinned);
    el.btnPin.setAttribute('aria-label', pinned ? 'Unpin note' : 'Pin note');
    toast(pinned ? 'Pinned to the top' : 'Unpinned');
    render();
  });

  el.btnPalette.addEventListener('click', () => {
    const note = Store.get(state.editing);
    if (!note) return;
    openSheet(parent => {
      sheetTitle(parent, 'Note colour');
      const grid = document.createElement('div');
      grid.className = 'swatches';
      COLORS.forEach(c => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch' + (note.color === c ? ' on' : '');
        b.dataset.color = c;
        b.setAttribute('aria-label', c === 'none' ? 'Default' : c);
        b.addEventListener('click', () => {
          Store.update(note.id, { color: c }, false);
          el.editor.dataset.color = c === 'none' ? '' : c;
          grid.querySelectorAll('.swatch').forEach(s => s.classList.toggle('on', s.dataset.color === c));
          render();
        });
        grid.append(b);
      });
      parent.append(grid);
    });
  });

  function tagSheet() {
    const note = Store.get(state.editing);
    if (!note) return;
    openSheet(parent => {
      sheetTitle(parent, 'Tags');
      const wrap = document.createElement('div');
      wrap.className = 'tagedit';

      const field = document.createElement('div');
      field.className = 'field';
      const input = document.createElement('input');
      input.placeholder = 'New tag';
      input.maxLength = 40;
      input.enterKeyHint = 'done';
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.textContent = 'Add';
      field.append(input, addBtn);

      const known = document.createElement('div');
      known.className = 'known';

      const paint = () => {
        const fresh = Store.get(note.id);
        known.textContent = '';
        Store.tags().forEach(t => {
          const b = document.createElement('button');
          b.type = 'button';
          const on = fresh.tags.indexOf(t.name) >= 0;
          b.className = 'tagpill' + (on ? ' on' : '');
          b.textContent = '#' + t.name;
          b.addEventListener('click', () => {
            const tags = on ? fresh.tags.filter(x => x !== t.name) : fresh.tags.concat([t.name]);
            Store.update(note.id, { tags }, false);
            paint(); renderEdTags(); render();
          });
          known.append(b);
        });
      };

      const commit = () => {
        const name = input.value.trim().replace(/^#+/, '').slice(0, 40);
        if (!name) return;
        const fresh = Store.get(note.id);
        if (fresh.tags.indexOf(name) < 0) Store.update(note.id, { tags: fresh.tags.concat([name]) }, false);
        input.value = '';
        paint(); renderEdTags(); render();
      };
      addBtn.addEventListener('click', commit);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });

      wrap.append(field, known);
      parent.append(wrap);
      paint();
      setTimeout(() => input.focus(), 260);
    });
  }

  el.filePhoto.addEventListener('change', () => onPhotoPick(el.filePhoto));
  el.fileCamera.addEventListener('change', () => onPhotoPick(el.fileCamera));

  el.btnMore.addEventListener('click', () => {
    const note = Store.get(state.editing);
    if (!note) return;
    rememberCaret();        // so "Add a photo" from here still knows where you were
    openSheet(parent => {
      sheetRow(parent, { icon: ICONS.photo, label: 'Add a photo', onTap: photoSheet });
      sheetRow(parent, { icon: ICONS.tag, label: 'Tags', hint: note.tags.length ? String(note.tags.length) : '', onTap: tagSheet });
      sheetRow(parent, { icon: ICONS.copy, label: 'Copy text', onTap: () => copyNote(note.id) });
      if (navigator.share) sheetRow(parent, { icon: ICONS.share, label: 'Share', onTap: () => shareNote(note.id) });
      sheetRow(parent, { icon: ICONS.duplicate, label: 'Duplicate', onTap: () => duplicateNote(note.id) });
      sheetRow(parent, { icon: ICONS.info, label: 'Note info', onTap: () => infoSheet(note.id) });
      sheetRow(parent, { icon: ICONS.trash, label: 'Move to trash', danger: true, onTap: () => {
        closeEditor();
        setTimeout(() => {
          Store.toTrash(note.id);
          render();
          toast('Moved to trash', 'Undo', () => { Store.restore(note.id); render(); });
        }, 180);
      } });
    });
  });

  function plainOf(note) {
    const body = note.text || htmlToText(note.html);
    return (note.title ? note.title + '\n\n' : '') + body;
  }

  async function copyNote(id) {
    const note = Store.get(id);
    if (!note) return;
    const text = plainOf(note);
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied to clipboard'); }
      catch (_e) { toast('Could not copy'); }
      ta.remove();
    }
  }

  async function shareNote(id) {
    const note = Store.get(id);
    if (!note || !navigator.share) return;
    try { await navigator.share({ title: note.title || 'Note', text: plainOf(note) }); }
    catch (_) { /* the user dismissed the sheet */ }
  }

  function duplicateNote(id) {
    const note = Store.get(id);
    if (!note) return;
    const copy = Store.create({
      title: note.title ? note.title + ' (copy)' : '',
      html: note.html, text: note.text, color: note.color, tags: note.tags.slice()
    });
    render();
    toast('Duplicated', 'Open', () => openEditor(copy.id));
  }

  function infoSheet(id) {
    const note = Store.get(id);
    if (!note) return;
    openSheet(parent => {
      sheetTitle(parent, 'Note info');
      const words = (note.text.match(/[^\s]+/g) || []).length;
      const rows = [
        ['Created', fmtLong.format(new Date(note.created))],
        ['Last edited', fmtLong.format(new Date(note.updated))],
        ['Words', String(words)],
        ['Characters', String(note.text.length)],
        ['Photos', String((note.pics || []).length)],
        ['Tags', note.tags.length ? note.tags.map(t => '#' + t).join(' ') : '—']
      ];
      rows.forEach(([k, v]) => {
        const d = document.createElement('div');
        d.className = 'sheet-row';
        d.innerHTML = '<span>' + escapeHTML(k) + '</span><span class="hint">' + escapeHTML(v) + '</span>';
        parent.append(d);
      });
    });
  }

  function trashedNoteSheet(id) {
    const note = Store.get(id);
    if (!note) return;
    openSheet(parent => {
      sheetTitle(parent, (note.title || 'Untitled note').slice(0, 60));
      sheetRow(parent, { icon: ICONS.restore, label: 'Restore note', onTap: () => {
        Store.restore(id); render(); toast('Restored');
      } });
      sheetRow(parent, { icon: ICONS.trash, label: 'Delete forever', danger: true, onTap: async () => {
        const ok = await confirmDialog({
          title: 'Delete forever?',
          body: 'This note cannot be recovered afterwards.',
          ok: 'Delete'
        });
        if (ok) { Store.destroy(id); Store.gcImages().catch(() => {}); render(); toast('Deleted'); }
      } });
    });
  }

  /* ============================================================
     library chrome
     ============================================================ */

  el.fab.addEventListener('click', () => {
    const patch = {};
    if (state.view === 'tag' && state.tag) patch.tags = [state.tag];
    if (state.view === 'pinned') patch.pinned = true;
    const note = Store.create(patch);
    render();
    openEditor(note.id);
  });

  el.btnSearch.addEventListener('click', () => {
    const open = el.searchwrap.classList.toggle('open');
    if (open) setTimeout(() => el.search.focus(), 200);
    else { el.search.value = ''; state.query = ''; el.search.blur(); render(); }
    el.btnSearch.classList.toggle('on', open);
  });

  el.search.addEventListener('input', debounce(() => {
    state.query = el.search.value;
    el.search.parentElement.classList.toggle('filled', !!el.search.value);
    render();
  }, 140));

  el.btnClearSearch.addEventListener('click', () => {
    el.search.value = ''; state.query = '';
    el.search.parentElement.classList.remove('filled');
    el.search.focus(); render();
  });

  el.btnLayout.addEventListener('click', () => {
    state.layout = state.layout === 'grid' ? 'list' : 'grid';
    Store.settings({ layout: state.layout });
    applyLayout();
  });

  el.btnEmptyTrash.addEventListener('click', async () => {
    const n = Store.trash().length;
    if (!n) return;
    const ok = await confirmDialog({
      title: 'Empty the trash?',
      body: n + (n === 1 ? ' note' : ' notes') + ' will be deleted for good.',
      ok: 'Empty trash'
    });
    if (ok) { Store.emptyTrash(); Store.gcImages().catch(() => {}); render(); toast('Trash emptied'); }
  });

  [...el.themeSeg.children].forEach(b => b.addEventListener('click', () => {
    state.theme = b.dataset.theme;
    Store.settings({ theme: state.theme });
    applyTheme();
  }));

  [...el.sortSeg.children].forEach(b => b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    Store.settings({ sort: state.sort });
    applySort(); render();
  }));

  /* scroll shadow under the bars */
  const onScroll = () => el.appbar.classList.toggle('scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  el.edScroll.addEventListener('scroll', () => {
    el.edBar.classList.toggle('scrolled', el.edScroll.scrollTop > 4);
  }, { passive: true });

  /* ============================================================
     export · import
     ============================================================ */

  let exporting = false;
  el.btnExport.addEventListener('click', async () => {
    if (exporting) return;
    exporting = true;
    const pics = Store.photoCount();
    if (pics) toast('Packing ' + pics + (pics === 1 ? ' photo…' : ' photos…'));
    try {
      /* photos go in as data URLs, so one file really is the whole notebook */
      const json = await Store.exportBundle();
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'inkwell-backup-' + stamp + '.json';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      const mb = blob.size / (1024 * 1024);
      toast('Backup saved · ' + (mb >= 1 ? mb.toFixed(1) + ' MB' : Math.max(1, Math.round(blob.size / 1024)) + ' KB'));
    } catch (_) {
      toast('Could not write the backup');
    }
    exporting = false;
  });

  el.btnImport.addEventListener('click', () => el.fileImport.click());
  el.fileImport.addEventListener('change', async () => {
    const file = el.fileImport.files && el.fileImport.files[0];
    el.fileImport.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const res = await Store.importJSON(text);
      render();
      const bits = [];
      if (res.added) bits.push(res.added + ' added');
      if (res.updated) bits.push(res.updated + ' updated');
      if (res.skipped) bits.push(res.skipped + ' unchanged');
      if (res.photos) bits.push(res.photos + (res.photos === 1 ? ' photo' : ' photos'));
      toast(bits.length ? 'Imported: ' + bits.join(', ') : 'Nothing new to import');
    } catch (err) {
      toast(err.message || 'Import failed');
    }
  });

  /* ============================================================
     install prompt
     ============================================================ */

  let installEvent = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installEvent = e;
    el.installSect.hidden = false;
  });
  el.btnInstall.addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    const res = await installEvent.userChoice.catch(() => null);
    if (res && res.outcome === 'accepted') { el.installSect.hidden = true; installEvent = null; }
  });
  window.addEventListener('appinstalled', () => { el.installSect.hidden = true; installEvent = null; });

  /* ============================================================
     on-screen keyboard: keep the editor above it

     The editor's height is driven by the visual viewport, so every
     one of these events relays out a full-screen contenteditable.
     Opening the keyboard switcher or changing language fires them
     in bursts of dozens — which is what made the app crawl and then
     be killed. Three things stop that: one write per frame, no
     write at all when nothing actually moved, and the expensive
     paint effects switched off while the viewport is in motion.
     ============================================================ */

  const vv = window.visualViewport;
  let vvFrame = 0, vvH = -1, vvT = -1, vvSettle = null;

  function writeViewport() {
    vvFrame = 0;
    if (!vv) return;
    const h = Math.round(vv.height), t = Math.round(vv.offsetTop);
    if (h === vvH && t === vvT) return;
    vvH = h; vvT = t;
    el.root.style.setProperty('--vvh', h + 'px');
    el.root.style.setProperty('--vvt', t + 'px');
    /* How much of the window the keyboard is covering. The window keeps its
       full height while the keyboard is up, so anything pinned to the bottom
       of it needs to be lifted by this much to stay in sight. */
    el.root.style.setProperty('--kb', Math.max(0, Math.round(window.innerHeight - h - t)) + 'px');
  }

  function viewportMoved() {
    el.root.classList.add('vv-busy');
    clearTimeout(vvSettle);
    vvSettle = setTimeout(() => el.root.classList.remove('vv-busy'), 260);
    if (!vvFrame) vvFrame = requestAnimationFrame(writeViewport);
  }

  if (vv) {
    vv.addEventListener('resize', viewportMoved, { passive: true });
    vv.addEventListener('scroll', viewportMoved, { passive: true });
    writeViewport();
  }

  /* keep the caret in view while typing near the keyboard — measuring forces
     layout, so once a frame at most, and never mid-composition */
  let caretFrame = 0;
  function keepCaretInView() {
    caretFrame = 0;
    if (composing || !el.editor.classList.contains('open')) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!el.edBody.contains(range.startContainer)) return;
    const rect = range.getBoundingClientRect();
    if (!rect || !rect.height) return;
    const limit = el.toolbar.getBoundingClientRect().top - 12;
    if (rect.bottom > limit) el.edScroll.scrollTop += rect.bottom - limit;
  }
  el.edBody.addEventListener('keyup', () => {
    if (composing || caretFrame) return;
    caretFrame = requestAnimationFrame(keepCaretInView);
  });

  /* ============================================================
     service worker & updating in place

     An installed PWA keeps serving itself from its own cache, so a
     new build can sit on the server unnoticed. "Update app" in the
     side menu forces the issue: activate a waiting worker if there
     is one, otherwise have the worker re-download the shell past
     every HTTP cache, then reload. Either way nothing is reinstalled
     and no notes are touched.
     ============================================================ */

  let swReg = null;
  let swVersion = '';
  let updating = false;
  let reloadingForUpdate = false;
  let lastCheck = 0;

  function showVersion() {
    const sw = swVersion && swVersion !== APP_VERSION ? ' · files ' + swVersion : '';
    el.verLine.textContent = 'Inkwell · version ' + APP_VERSION + sw;
  }
  function hint(text) { el.updateHint.textContent = text; }

  /* Come back up on the new build.

     location.reload() is not enough, and this is the whole reason updating an
     installed PWA has a reputation for needing a reinstall: a *reload* lets the
     browser reuse the stylesheet and the scripts it already holds in its HTTP
     cache — GitHub Pages serves them with a ten-minute lifetime — without ever
     asking the service worker. The worker would be sitting on the new files and
     the old ones would still be running. A navigation to a URL the browser has
     not seen is a new document load, and that does go through the worker, so
     the new files are the ones that run. The marker is stripped off again as
     the app starts, so nothing accumulates in the address bar. */
  function relaunch() {
    try { location.replace(location.pathname + '?u=' + Date.now()); }
    catch (_) { location.reload(); }
  }

  /* Talk to the worker and wait for its answer, but never hang on it. */
  function askWorker(sw, message, ms) {
    return new Promise(resolve => {
      if (!sw) return resolve(null);
      let done = false;
      const finish = value => { if (!done) { done = true; resolve(value); } };
      const timer = setTimeout(() => finish(null), ms || 15000);
      try {
        const channel = new MessageChannel();
        channel.port1.onmessage = e => { clearTimeout(timer); finish(e.data); };
        sw.postMessage(message, [channel.port2]);
      } catch (_) { clearTimeout(timer); finish(null); }
    });
  }

  function activateWorker(sw) {
    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      if (sw.state === 'activated') return finish();
      sw.addEventListener('statechange', () => { if (sw.state === 'activated') finish(); });
      try { sw.postMessage({ type: 'skip-waiting' }); } catch (_) {}
      setTimeout(finish, 5000);
    });
  }

  /* Asked about once per launch, and never over the top of a note being
     written — a modal that steals the keyboard mid-sentence is worse than
     waiting until the editor is closed. */
  let updateAsked = false;
  let updateWaiting = null;

  function offerUpdate(sw) {
    if (updateAsked || updating) return;
    updateAsked = true;
    const ask = async () => {
      const go = await confirmDialog({
        title: 'Update available',
        body: 'A newer version of Inkwell is ready. It takes a moment, and your notes and photos are not touched.',
        ok: 'Update now',
        cancel: 'Later',
        danger: false
      });
      if (!go) {
        hint('An update is waiting · tap to install');
        return;
      }
      if (dirty) saveNow();
      reloadingForUpdate = true;      // set first: claiming the page fires controllerchange
      await activateWorker(sw);
      relaunch();
    };
    if (el.editor.classList.contains('open')) updateWaiting = ask;
    else setTimeout(ask, 600);        // let the app finish settling in first
  }

  async function updateNow() {
    if (updating) return;
    updating = true;
    if (dirty) saveNow();                       // never trade text for a reload
    hint('Checking…');

    try {
      if (!('serviceWorker' in navigator)) { reloadingForUpdate = true; relaunch(); return; }

      const reg = swReg || await navigator.serviceWorker.getRegistration();
      if (!reg) { reloadingForUpdate = true; relaunch(); return; }
      swReg = reg;

      await reg.update().catch(() => {});
      lastCheck = Date.now();

      const pending = reg.waiting || reg.installing;
      if (pending) {
        hint('Installing the new version…');
        reloadingForUpdate = true;
        await activateWorker(pending);
        relaunch();
        return;
      }

      /* The worker itself is unchanged — but the files it hands out may not be,
         so make it fetch them again with the HTTP cache bypassed. */
      hint('Fetching the latest files…');
      const worker = reg.active || navigator.serviceWorker.controller;

      if (worker) {
        const res = await askWorker(worker, { type: 'refresh' });
        if (res && res.ok) {
          hint('Restarting…');
          reloadingForUpdate = true;
          relaunch();
          return;
        }
        /* It tried and came back empty-handed — offline, or a network that
           answers but does not serve. The cache is deliberately left alone:
           it is the only copy that lets the app open at all. */
        const got = res ? res.fetched : 0;
        hint(navigator.onLine === false ? 'Offline — nothing to fetch yet'
           : got ? 'Only part of it arrived — try again'
           : 'Could not reach the network');
        toast(navigator.onLine === false ? 'No connection — try again when you are online'
                                         : 'Update could not finish');
        updating = false;
        return;
      }

      /* No worker to ask at all. Emptying the caches makes the reload go to
         the network for everything — safe only while we are online. */
      if (navigator.onLine === false || !window.caches) {
        hint('Offline — nothing to fetch yet');
        toast('No connection — try again when you are online');
        updating = false;
        return;
      }
      await caches.keys()
        .then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .catch(() => {});
      hint('Restarting…');
      reloadingForUpdate = true;
      relaunch();
    } catch (_) {
      hint('Update failed — try again');
      toast('Update failed');
      updating = false;
    }
  }

  el.btnUpdate.addEventListener('click', updateNow);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(async reg => {
        swReg = reg;

        /* a worker that finished installing while the app was closed */
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

        reg.addEventListener('updatefound', () => {
          const sw = reg.installing || reg.waiting;
          if (!sw) return;
          if (sw.state === 'installed' && navigator.serviceWorker.controller) return offerUpdate(sw);
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller && !updating) offerUpdate(sw);
          });
        });

        const active = reg.active || navigator.serviceWorker.controller;
        const info = await askWorker(active, { type: 'version' }, 4000);
        if (info && info.version) { swVersion = info.version; showVersion(); }
        hint(swVersion && swVersion !== APP_VERSION
          ? 'Cached files are out of date — tap to fix'
          : 'Up to date · tap to check again');

        lastCheck = Date.now();
      }).catch(() => {
        hint('Offline support is off here');
      });
    });

    /* If something else activated a new worker, come back on the new build —
       but a first install claiming the page is not an update, it is just the
       worker starting for the first time. */
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloadingForUpdate) return;
      reloadingForUpdate = true;
      if (dirty) saveNow();
      relaunch();
    });
  } else {
    hint('This browser cannot update in place');
  }

  /* a quiet check each time the app comes back to the foreground */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !swReg || updating) return;
    if (Date.now() - lastCheck < 1800000) return;      // half an hour is plenty
    lastCheck = Date.now();
    swReg.update().catch(() => {});
  });

  /* ============================================================
     share target & shortcuts  (?title=…&text=…  /  ?new=1)
     ============================================================ */

  function handleLaunchParams() {
    const p = new URLSearchParams(location.search);
    /* the cache-busting marker relaunch() added — tidy it away again */
    if (p.get('u')) history.replaceState(null, '', location.pathname);
    const shared = (p.get('text') || '') + (p.get('url') ? '\n' + p.get('url') : '');
    const title = p.get('title') || '';

    if (shared.trim() || title.trim()) {
      const html = shared.trim()
        ? shared.trim().split(/\n{2,}/).map(par =>
            '<p>' + escapeHTML(par).replace(/\n/g, '<br>') + '</p>').join('')
        : '';
      const note = Store.create({ title: title.slice(0, 200), html, text: shared.trim() });
      history.replaceState(null, '', location.pathname);
      render();
      openEditor(note.id, true);
      return;
    }
    if (p.get('new')) {
      history.replaceState(null, '', location.pathname);
      const note = Store.create({});
      render();
      openEditor(note.id);
    }
  }

  /* ============================================================
     keyboard shortcuts (handy when testing on a desktop)
     ============================================================ */

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) ||
                   document.activeElement.isContentEditable;
    if (e.key === 'Escape') {
      if (overlays.length) { e.preventDefault(); popOverlay(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && state.editing) { e.preventDefault(); saveNow(); toast('Saved'); return; }
    if (typing) return;
    if (e.key === '/' ) { e.preventDefault(); el.btnSearch.click(); }
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); el.fab.click(); }
  });

  /* Save before the page goes away. Android can discard a backgrounded
     WebView without ever firing beforeunload, so pagehide and
     visibilitychange are the ones that actually matter on a phone. */
  const saveIfDirty = () => { if (dirty) saveNow(); };
  window.addEventListener('beforeunload', saveIfDirty);
  window.addEventListener('pagehide', saveIfDirty);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveIfDirty(); });

  /* ============================================================
     boot
     ============================================================ */

  (async function boot() {
    const s = Store.settings();
    state.theme = s.theme || 'auto';
    state.layout = s.layout || 'grid';
    state.sort = s.sort || 'updated';
    applyTheme(); applyLayout(); applySort();

    showVersion();

    await Store.init();
    Store.pruneTrash(TRASH_DAYS);
    Store.pruneEmpty();   // blank notes left behind if the app was killed mid-edit

    render();
    handleLaunchParams();

    /* photos no note points at any more — removed last session, or left over
       from a note that was deleted for good */
    Store.gcImages().catch(() => {});

    if (Store.fallback) {
      setTimeout(() => toast('Storage is limited here — export backups often'), 1200);
    }
  })();
})();
