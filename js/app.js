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
    editor: $('#editor'), edBar: $('.ed-bar'), edScroll: $('#edScroll'),
    edTitle: $('#edTitle'), edTags: $('#edTags'), edBody: $('#edBody'), edFooter: $('#edFooter'),
    edMeta: $('#edMeta'),
    btnBack: $('#btnBack'), btnPin: $('#btnPin'), btnPalette: $('#btnPalette'), btnMore: $('#btnMore'),
    toolbar: $('#toolbar'),
    sheetLayer: $('#sheetLayer'), sheetScrim: $('#sheetScrim'),
    bottomSheet: $('#bottomSheet'), sheetBody: $('#sheetBody'),
    dialog: $('#dialog'), dlgTitle: $('#dlgTitle'), dlgBody: $('#dlgBody'),
    dlgCancel: $('#dlgCancel'), dlgOk: $('#dlgOk'),
    toast: $('#toast')
  };

  const COLORS = ['none', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink', 'sand'];
  const TRASH_DAYS = 30;

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
    S: [], STRIKE: [], DEL: [], HR: [], SPAN: [], A: ['href']
  };
  /* these go entirely — keeping their text would just leak code into the note */
  const DROP = {
    SCRIPT: 1, STYLE: 1, IFRAME: 1, FRAME: 1, OBJECT: 1, EMBED: 1, APPLET: 1,
    LINK: 1, META: 1, BASE: 1, TITLE: 1, NOSCRIPT: 1, TEMPLATE: 1,
    SVG: 1, MATH: 1, FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1, SELECT: 1,
    AUDIO: 1, VIDEO: 1, CANVAS: 1, IMG: 1
  };

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
    let html = '';

    if (note.pinned) {
      html += '<svg class="cpin" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3.5h5l-.7 5.2 3.2 3.3h-4.6L12 20.5l-.4-8.5H7l3.2-3.3z"/></svg>';
    }
    if (title) html += '<h3>' + highlight(title, q) + '</h3>';
    if (snippet) html += '<p class="snippet">' + highlight(snippet, q) + '</p>';
    if (!title && !snippet) html += '<p class="snippet muted">Empty note</p>';

    html += '<div class="cardfoot"><time datetime="' + new Date(note.updated).toISOString() + '">' +
            escapeHTML(state.view === 'trash' ? 'Trashed ' + relTime(note.trashed) : relTime(note.updated)) +
            '</time>';
    note.tags.slice(0, 2).forEach(t => { html += '<span class="minitag">' + escapeHTML(t) + '</span>'; });
    if (note.tags.length > 2) html += '<span class="minitag">+' + (note.tags.length - 2) + '</span>';
    html += '</div>';

    card.innerHTML = html;
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
    el.statLine.textContent =
      live.length + (live.length === 1 ? ' note' : ' notes') +
      (tags.length ? ' · ' + tags.length + (tags.length === 1 ? ' tag' : ' tags') : '');

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
    palette: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="8.7" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.1" cy="11.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="8.9" cy="11.7" r="1.15" fill="currentColor" stroke="none"/>'
  };

  /* ============================================================
     editor
     ============================================================ */

  let dirty = false;

  const saveNow = () => {
    if (!state.editing) return;
    const note = Store.get(state.editing);
    if (!note) return;
    const html = sanitizeHTML(el.edBody.innerHTML);
    const text = htmlToText(html);
    const title = el.edTitle.value.replace(/\s*\n+\s*/g, ' ').trim();   // pasted titles stay one line
    if (note.title === title && note.html === html) return;
    Store.update(state.editing, { title, html, text });
    dirty = false;
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
  }

  function closeEditor() { if (isOpen('editor')) popOverlay(); }

  el.btnBack.addEventListener('click', closeEditor);

  el.edTitle.addEventListener('input', () => { dirty = true; growTitle(); saveSoon(); });
  el.edTitle.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); el.edBody.focus(); }
  });
  el.edBody.addEventListener('input', () => {
    dirty = true; syncPlaceholder(); saveSoon(); refreshToolbarState();
  });
  el.edBody.addEventListener('blur', () => { if (dirty) saveNow(); });

  /* paste as plain text so foreign styles never leak in */
  el.edBody.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
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
      b.classList.toggle('on', !!on);
    });
  }

  el.toolbar.querySelectorAll('button[data-cmd]').forEach(b => {
    b.addEventListener('pointerdown', e => e.preventDefault());   // keep the caret
    b.addEventListener('click', () => runCommand(b.dataset.cmd));
  });

  document.addEventListener('selectionchange', () => {
    if (el.editor.classList.contains('open')) refreshToolbarState();
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

  el.btnMore.addEventListener('click', () => {
    const note = Store.get(state.editing);
    if (!note) return;
    openSheet(parent => {
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
        if (ok) { Store.destroy(id); render(); toast('Deleted'); }
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
    if (ok) { Store.emptyTrash(); render(); toast('Trash emptied'); }
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

  el.btnExport.addEventListener('click', () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inkwell-backup-' + stamp + '.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Backup saved to your downloads');
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
     ============================================================ */

  const vv = window.visualViewport;
  if (vv) {
    const syncVV = () => {
      el.root.style.setProperty('--vvh', vv.height + 'px');
      el.root.style.setProperty('--vvt', vv.offsetTop + 'px');
    };
    vv.addEventListener('resize', syncVV);
    vv.addEventListener('scroll', syncVV);
    syncVV();
  }

  /* keep the caret in view while typing near the keyboard */
  el.edBody.addEventListener('keyup', () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || !rect.height) return;
    const limit = el.toolbar.getBoundingClientRect().top - 12;
    if (rect.bottom > limit) el.edScroll.scrollTop += rect.bottom - limit;
  });

  /* ============================================================
     service worker
     ============================================================ */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('A new version is ready', 'Reload', () => {
                sw.postMessage({ type: 'skip-waiting' });
                setTimeout(() => location.reload(), 120);
              });
            }
          });
        });
      }).catch(() => { /* offline support simply stays off */ });
    });
  }

  /* ============================================================
     share target & shortcuts  (?title=…&text=…  /  ?new=1)
     ============================================================ */

  function handleLaunchParams() {
    const p = new URLSearchParams(location.search);
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

  /* save before the page goes away */
  window.addEventListener('beforeunload', () => { if (dirty) saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) saveNow(); });

  /* ============================================================
     boot
     ============================================================ */

  (async function boot() {
    const s = Store.settings();
    state.theme = s.theme || 'auto';
    state.layout = s.layout || 'grid';
    state.sort = s.sort || 'updated';
    applyTheme(); applyLayout(); applySort();

    await Store.init();
    Store.pruneTrash(TRASH_DAYS);
    Store.pruneEmpty();   // blank notes left behind if the app was killed mid-edit

    render();
    handleLaunchParams();

    if (Store.fallback) {
      setTimeout(() => toast('Storage is limited here — export backups often'), 1200);
    }
  })();
})();
