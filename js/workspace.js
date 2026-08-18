import { applyStaticI18n, getLanguage, initI18n, onLanguageChange, setLanguage, t } from './i18n.js';

const PREFS_KEY = 'ti.prefs';
const DB_NAME = 'ti-workspace';
const DB_STORE = 'items';
const DB_VERSION = 1;
const MAX_CONCURRENT = 3;
const RECENT_MS = 48 * 60 * 60 * 1000;

const state = {
  items: [],
  view: 'files',
  layout: 'grid',
  sort: 'date:desc',
  query: '',
  selected: new Set(),
  theme: 'light',
  format: 'url',
  config: null,
  pushing: false,
  objectUrls: new Map(),
};

let dbPromise = null;
let toastTimer = null;
let confirmResolver = null;
let activeMenu = null;
let lastFocus = null;

const $ = (id) => document.getElementById(id);

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
  } catch (_) {
    return {};
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      theme: state.theme,
      layout: state.layout,
      sort: state.sort,
      view: state.view,
    }));
  } catch (_) { /* ignore */ }
}

function detectTheme(prefs) {
  if (prefs.theme === 'light' || prefs.theme === 'dark') return prefs.theme;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const btn = $('theme-btn');
  if (btn) {
    btn.setAttribute('aria-pressed', state.theme === 'dark' ? 'true' : 'false');
    btn.setAttribute('aria-label', t(state.theme === 'dark' ? 'themeDark' : 'themeLight'));
    btn.setAttribute('title', t(state.theme === 'dark' ? 'themeDark' : 'themeLight'));
  }
}

function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function openDb() {
  if (dbPromise) return dbPromise;
  if (!('indexedDB' in window)) {
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }
  dbPromise = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (_) { resolve(null); return; }
    req.onerror = () => resolve(null);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

async function idbAll() {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function idbPut(item) {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(toRecord(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function idbDelete(id) {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function toRecord(item) {
  const record = {
    id: item.id,
    name: item.name,
    type: item.type,
    size: item.size,
    addedAt: item.addedAt,
    pushedAt: item.pushedAt,
    status: item.status === 'pushing' ? 'pending' : item.status,
    src: item.src,
    url: item.url,
    error: item.error,
    width: item.width,
    height: item.height,
    blob: null,
  };
  if (item.status !== 'synced' && item.file) record.blob = item.file;
  return record;
}

function rememberUrl(id, blob) {
  const prev = state.objectUrls.get(id);
  if (prev) URL.revokeObjectURL(prev);
  if (!blob) {
    state.objectUrls.delete(id);
    return null;
  }
  const url = URL.createObjectURL(blob);
  state.objectUrls.set(id, url);
  return url;
}

function localPreview(item) {
  if (item.previewUrl) return item.previewUrl;
  if (item.file && isImage(item)) {
    item.previewUrl = rememberUrl(item.id, item.file);
    return item.previewUrl;
  }
  return item.url || '';
}

function isImage(item) {
  return (item.type || '').indexOf('image/') === 0;
}

function extOf(name) {
  const parts = String(name || '').split('.');
  return parts.length > 1 ? parts.pop().toUpperCase().slice(0, 5) : 'FILE';
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return t('bytes', { n });
  if (n < 1024 * 1024) return t('kb', { n: (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) });
  if (n < 1024 * 1024 * 1024) return t('mb', { n: (n / 1024 / 1024).toFixed(2) });
  return t('gb', { n: (n / 1024 / 1024 / 1024).toFixed(2) });
}

function formatWhen(ts) {
  if (!ts) return t('noDimensions');
  const delta = Date.now() - ts;
  if (delta < 60 * 1000) return t('justNow');
  if (delta < 60 * 60 * 1000) return t('minutesAgo', { n: Math.floor(delta / 60000) });
  if (delta < 24 * 60 * 60 * 1000) return t('hoursAgo', { n: Math.floor(delta / 3600000) });
  if (delta < 7 * 24 * 60 * 60 * 1000) return t('daysAgo', { n: Math.floor(delta / 86400000) });
  try {
    return new Date(ts).toLocaleString(getLanguage());
  } catch (_) {
    return new Date(ts).toLocaleString();
  }
}

function statusLabel(status) {
  if (status === 'pending') return t('statusPending');
  if (status === 'pushing') return t('statusPushing');
  if (status === 'synced') return t('statusSynced');
  if (status === 'failed') return t('statusFailed');
  return t('statusLocal');
}

function plural(key, n) {
  return t(n === 1 ? key : key + 'Plural', { n });
}

function announce(message) {
  const live = $('live');
  if (live) live.textContent = message;
}

function showToast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function copyText(text) {
  const done = () => showToast(t('copied'));
  const fail = () => showToast(t('copyFailed'));
  if (!text) return fail();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => {
      legacyCopy(text) ? done() : fail();
    });
  } else {
    legacyCopy(text) ? done() : fail();
  }
}

function legacyCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  document.body.removeChild(textarea);
  return ok;
}

function formatLink(item, format) {
  const url = item.url;
  if (!url) return '';
  switch (format) {
    case 'markdown': return '![' + item.name + '](' + url + ')';
    case 'bbcode': return '[img]' + url + '[/img]';
    case 'html': return '<img src="' + url + '" alt="' + escapeHtml(item.name) + '">';
    default: return url;
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function visibleItems() {
  let list = state.items.slice();
  if (state.view === 'images') list = list.filter(isImage);
  if (state.view === 'recent') {
    const cutoff = Date.now() - RECENT_MS;
    list = list.filter((item) => (item.pushedAt || item.addedAt) >= cutoff);
  }
  const q = state.query.trim().toLowerCase();
  if (q) list = list.filter((item) => (item.name || '').toLowerCase().indexOf(q) !== -1);

  const [key, dir] = state.sort.split(':');
  list.sort((a, b) => {
    let cmp = 0;
    if (key === 'name') cmp = String(a.name).localeCompare(String(b.name), getLanguage(), { sensitivity: 'base' });
    else if (key === 'size') cmp = (a.size || 0) - (b.size || 0);
    else cmp = (a.addedAt || 0) - (b.addedAt || 0);
    return dir === 'asc' ? cmp : -cmp;
  });
  return list;
}

function counts() {
  const pending = state.items.filter((i) => i.status === 'pending' || i.status === 'pushing').length;
  const failed = state.items.filter((i) => i.status === 'failed').length;
  const synced = state.items.filter((i) => i.status === 'synced').length;
  return { pending, failed, synced, total: state.items.length };
}

async function addFiles(fileList) {
  const files = Array.prototype.slice.call(fileList || []).filter(Boolean);
  if (!files.length) return;
  const added = [];
  for (const file of files) {
    const item = {
      id: uid(),
      name: file.name || 'untitled',
      type: file.type || '',
      size: file.size || 0,
      addedAt: Date.now(),
      pushedAt: null,
      status: 'pending',
      src: null,
      url: null,
      error: null,
      progress: 0,
      width: null,
      height: null,
      file,
      previewUrl: null,
    };
    if (isImage(item)) {
      try {
        const dims = await readImageSize(file);
        item.width = dims.width;
        item.height = dims.height;
      } catch (_) { /* ignore */ }
    }
    state.items.unshift(item);
    added.push(item);
    idbPut(item);
  }
  announce(plural('announceAdded', added.length));
  render();
}

function readImageSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: null, height: null });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function findItem(id) {
  return state.items.find((item) => item.id === id);
}

async function removeItem(id) {
  const item = findItem(id);
  if (!item || item.status === 'pushing') return;
  state.items = state.items.filter((entry) => entry.id !== id);
  state.selected.delete(id);
  rememberUrl(id, null);
  await idbDelete(id);
  announce(t('announceRemoved', { name: item.name }));
  render();
}

async function pushItems(ids) {
  const targets = state.items.filter((item) => {
    if (ids && ids.indexOf(item.id) === -1) return false;
    return (item.status === 'pending' || item.status === 'failed') && item.file;
  });
  if (!targets.length) {
    showToast(t('pushNothing'));
    return;
  }

  state.pushing = true;
  renderChrome();

  let cursor = 0;
  let active = 0;
  let failed = 0;
  const total = targets.length;
  let done = 0;

  await new Promise((resolve) => {
    const pump = () => {
      while (active < MAX_CONCURRENT && cursor < targets.length) {
        const item = targets[cursor++];
        active++;
        uploadItem(item).then((ok) => {
          if (!ok) failed++;
          done++;
          active--;
          updatePushMeter(done, total);
          announce(t('announcePushing', { current: done, total }));
          if (done === total) resolve();
          else pump();
        });
      }
    };
    pump();
  });

  state.pushing = false;
  updatePushMeter(0, 0);
  showToast(failed ? t('pushPartial') : t('pushComplete'));
  render();
}

function updatePushMeter(done, total) {
  const meter = $('push-meter');
  const bar = meter && meter.firstElementChild;
  if (!meter || !bar) return;
  if (!total || done >= total) {
    meter.hidden = true;
    bar.style.width = '0';
    return;
  }
  meter.hidden = false;
  bar.style.width = Math.round((done / total) * 100) + '%';
}

function uploadItem(item) {
  item.status = 'pushing';
  item.progress = 0;
  item.error = null;
  patchCard(item);

  return new Promise((resolve) => {
    const formData = new FormData();
    formData.append('file', item.file, item.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        item.progress = Math.round((event.loaded / event.total) * 100);
        patchCard(item);
      }
    };

    xhr.onload = () => {
      let src = null;
      let errorMessage = null;
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && data && data[0] && data[0].src) {
          src = data[0].src;
        } else {
          errorMessage = (data && data.error) || t('httpError', { status: xhr.status });
        }
      } catch (_) {
        errorMessage = t('httpError', { status: xhr.status });
      }

      if (src) {
        item.status = 'synced';
        item.progress = 100;
        item.src = src;
        item.url = location.origin + src;
        item.pushedAt = Date.now();
        item.error = null;
        item.file = null;
        rememberUrl(item.id, null);
        item.previewUrl = null;
        idbPut(item);
        announce(t('announcePushed', { name: item.name }));
        patchCard(item);
        renderLinks();
        resolve(true);
      } else {
        failItem(item, errorMessage);
        resolve(false);
      }
    };

    xhr.onerror = () => {
      failItem(item, t('networkError'));
      resolve(false);
    };

    xhr.send(formData);
  });
}

function failItem(item, message) {
  item.status = 'failed';
  item.progress = 100;
  item.error = message || t('networkError');
  idbPut(item);
  announce(t('announceFailed', { name: item.name }));
  patchCard(item);
}

function patchCard(item) {
  const card = document.querySelector('[data-id="' + item.id + '"]');
  if (!card) {
    render();
    return;
  }
  const chip = card.querySelector('[data-role="status"]');
  if (chip) {
    chip.className = 'status-chip ' + item.status;
    chip.textContent = statusLabel(item.status);
  }
  const bar = card.querySelector('.progress > i');
  if (bar) bar.style.width = (item.progress || 0) + '%';
  const progress = card.querySelector('.progress');
  if (progress) progress.hidden = item.status !== 'pushing';
  const img = card.querySelector('img');
  if (img && item.url) img.src = item.url;
  card.classList.toggle('pushing', item.status === 'pushing');
  card.classList.toggle('failed', item.status === 'failed');
  renderChrome();
}

function glyph(item) {
  const type = item.type || '';
  let kind = 'FILE';
  if (type.indexOf('image/') === 0) kind = 'IMG';
  else if (type.indexOf('video/') === 0) kind = 'VID';
  else if (type.indexOf('audio/') === 0) kind = 'AUD';
  else if (type.indexOf('pdf') !== -1) kind = 'PDF';
  else if (type.indexOf('zip') !== -1 || type.indexOf('compressed') !== -1) kind = 'ZIP';
  else if (type.indexOf('text/') === 0 || type.indexOf('json') !== -1) kind = 'TXT';
  return kind;
}

function render() {
  applyStaticI18n(document);
  applyTheme();
  renderChrome();
  renderBrowser();
  renderLinks();
}

function renderChrome() {
  const c = counts();
  const crumbKey = state.view === 'images' ? 'navImages' : state.view === 'recent' ? 'navRecent' : 'navFiles';
  const crumb = $('crumb-current');
  if (crumb) crumb.textContent = t(crumbKey);

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.setAttribute('aria-current', btn.getAttribute('data-view') === state.view ? 'page' : 'false');
  });

  $('view-grid').setAttribute('aria-pressed', state.layout === 'grid' ? 'true' : 'false');
  $('view-list').setAttribute('aria-pressed', state.layout === 'list' ? 'true' : 'false');
  $('sort-select').value = state.sort;

  const push = $('push-changes');
  const pushLabel = $('push-label');
  const canPush = !state.pushing && state.items.some((i) => (i.status === 'pending' || i.status === 'failed') && i.file);
  push.disabled = !canPush;
  pushLabel.textContent = state.pushing ? t('pushing') : t('pushChanges');

  const stagingCount = $('staging-count');
  const stagingCopy = $('staging-copy');
  if (stagingCount) stagingCount.textContent = String(c.pending);
  if (stagingCopy) stagingCopy.textContent = c.pending ? plural('pendingBanner', c.pending) : t('stagingEmpty');

  const pendingBar = $('pending-bar');
  const pendingTitle = $('pending-title');
  if (c.pending || c.failed) {
    pendingBar.hidden = false;
    pendingTitle.textContent = c.pending ? plural('pendingBanner', c.pending) : plural('statusBarFailed', c.failed);
  } else {
    pendingBar.hidden = true;
  }
  $('retry-failed').hidden = c.failed === 0;

  $('visible-count').textContent = t('fileCount', { n: visibleItems().length });
  $('status-files').textContent = plural('statusBarFiles', c.total);
  $('status-pending').textContent = c.pending ? t('statusBarPending', { n: c.pending }) : '';
  $('status-failed').textContent = c.failed ? t('statusBarFailed', { n: c.failed }) : '';
  $('status-synced').textContent = c.synced ? t('statusBarSynced', { n: c.synced }) : '';
  $('status-selection').textContent = state.selected.size ? t('selectedCount', { n: state.selected.size }) : '';

  const clear = $('search-clear');
  if (clear) clear.hidden = !state.query;
}

function renderBrowser() {
  const stage = $('file-stage');
  const items = visibleItems();
  if (!items.length) {
    const empty = emptyCopy();
    stage.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'empty';
    wrap.innerHTML = '<div class="empty-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v8A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-10z"/></svg></div>';
    const h = document.createElement('h2');
    h.textContent = empty.title;
    const p = document.createElement('p');
    p.textContent = empty.body;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn tonal';
    btn.style.marginTop = '16px';
    btn.textContent = t('addFiles');
    btn.addEventListener('click', () => $('file-input').click());
    wrap.appendChild(h);
    wrap.appendChild(p);
    wrap.appendChild(btn);
    stage.appendChild(wrap);
    return;
  }

  if (state.layout === 'list') {
    renderList(stage, items);
  } else {
    renderGrid(stage, items);
  }
}

function emptyCopy() {
  if (state.query) return { title: t('emptySearchTitle'), body: t('emptySearchBody') };
  if (state.view === 'images') return { title: t('emptyImagesTitle'), body: t('emptyImagesBody') };
  if (state.view === 'recent') return { title: t('emptyRecentTitle'), body: t('emptyRecentBody') };
  return { title: t('emptyFilesTitle'), body: t('emptyFilesBody') };
}

function renderGrid(stage, items) {
  const grid = document.createElement('div');
  grid.className = 'file-grid';
  items.forEach((item) => grid.appendChild(buildCard(item)));
  stage.replaceChildren(grid);
}

function buildCard(item) {
  const card = document.createElement('article');
  card.className = 'file-card' + (state.selected.has(item.id) ? ' selected' : '') + (item.status === 'failed' ? ' failed' : '') + (item.status === 'pushing' ? ' pushing' : '');
  card.dataset.id = item.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', item.name);

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  thumb.appendChild(thumbContent(item, true));

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'card-check';
  check.checked = state.selected.has(item.id);
  check.setAttribute('aria-label', t('selectFile', { name: item.name }));
  check.addEventListener('click', (event) => event.stopPropagation());
  check.addEventListener('change', () => toggleSelect(item.id, check.checked));

  const chip = document.createElement('span');
  chip.className = 'status-chip ' + item.status;
  chip.dataset.role = 'status';
  chip.textContent = statusLabel(item.status);

  const progress = document.createElement('div');
  progress.className = 'progress';
  progress.hidden = item.status !== 'pushing';
  const bar = document.createElement('i');
  bar.style.width = (item.progress || 0) + '%';
  progress.appendChild(bar);

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  if (item.url) {
    actions.appendChild(iconAction('copy', t('copyOneAria', { name: item.name }), () => copyText(formatLink(item, state.format))));
  }
  actions.appendChild(iconAction('more', t('cardMenuAria', { name: item.name }), (event) => {
    event.stopPropagation();
    openItemMenu(item, event.currentTarget);
  }));

  thumb.appendChild(check);
  thumb.appendChild(chip);
  thumb.appendChild(progress);
  thumb.appendChild(actions);

  const body = document.createElement('div');
  body.className = 'card-body';
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = item.name;
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.textContent = formatSize(item.size) + ' · ' + (item.status === 'synced' ? t('locationRemote') : t('locationLocal'));
  body.appendChild(name);
  body.appendChild(meta);

  card.appendChild(thumb);
  card.appendChild(body);
  bindItemOpen(card, item);
  card.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openItemMenu(item, null, event.clientX, event.clientY);
  });
  return card;
}

function iconAction(kind, label, handler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.setAttribute('aria-label', label);
  btn.innerHTML = kind === 'copy'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M6 15.5H5.4A1.9 1.9 0 0 1 3.5 13.6V5.4A1.9 1.9 0 0 1 5.4 3.5h8.2A1.9 1.9 0 0 1 15.5 5.4V6"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/></svg>';
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    handler(event);
  });
  return btn;
}

function thumbContent(item, large) {
  if (isImage(item)) {
    const src = item.status === 'synced' ? item.url : localPreview(item);
    if (src) {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = src;
      return img;
    }
  }
  const glyphWrap = document.createElement('div');
  glyphWrap.className = 'file-glyph';
  const ext = document.createElement('span');
  ext.className = 'ext';
  ext.textContent = extOf(item.name) || glyph(item);
  if (!large) {
    ext.style.fontSize = '10px';
    ext.style.padding = '1px 5px';
  }
  glyphWrap.appendChild(ext);
  return glyphWrap;
}

function renderList(stage, items) {
  const list = document.createElement('div');
  list.className = 'file-list';
  const head = document.createElement('div');
  head.className = 'list-head';
  head.innerHTML = '<span></span><span></span><span>' + escapeHtml(t('colName')) + '</span><span class="hide-sm">' + escapeHtml(t('colSize')) + '</span><span class="hide-sm">' + escapeHtml(t('colType')) + '</span><span class="hide-sm">' + escapeHtml(t('colAdded')) + '</span><span>' + escapeHtml(t('colStatus')) + '</span><span></span>';
  list.appendChild(head);
  items.forEach((item) => list.appendChild(buildRow(item)));
  stage.replaceChildren(list);
}

function buildRow(item) {
  const row = document.createElement('div');
  row.className = 'list-row' + (state.selected.has(item.id) ? ' selected' : '');
  row.dataset.id = item.id;
  row.tabIndex = 0;
  row.setAttribute('role', 'row');

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = state.selected.has(item.id);
  check.setAttribute('aria-label', t('selectFile', { name: item.name }));
  check.addEventListener('click', (event) => event.stopPropagation());
  check.addEventListener('change', () => toggleSelect(item.id, check.checked));

  const thumb = document.createElement('div');
  thumb.className = 'list-thumb';
  thumb.appendChild(thumbContent(item, false));

  const name = document.createElement('div');
  name.className = 'list-name';
  name.textContent = item.name;

  const size = document.createElement('div');
  size.className = 'list-cell hide-sm';
  size.textContent = formatSize(item.size);

  const type = document.createElement('div');
  type.className = 'list-cell hide-sm';
  type.textContent = item.type || t('unknownType');

  const added = document.createElement('div');
  added.className = 'list-cell hide-sm';
  added.textContent = formatWhen(item.addedAt);

  const status = document.createElement('span');
  status.className = 'status-chip ' + item.status;
  status.dataset.role = 'status';
  status.textContent = statusLabel(item.status);

  const more = iconAction('more', t('cardMenuAria', { name: item.name }), (event) => {
    event.stopPropagation();
    openItemMenu(item, event.currentTarget);
  });

  row.appendChild(check);
  row.appendChild(thumb);
  row.appendChild(name);
  row.appendChild(size);
  row.appendChild(type);
  row.appendChild(added);
  row.appendChild(status);
  row.appendChild(more);
  bindItemOpen(row, item);
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openItemMenu(item, null, event.clientX, event.clientY);
  });
  return row;
}

function bindItemOpen(el, item) {
  el.addEventListener('click', (event) => {
    if (event.target.closest('input, button, a')) return;
    openPreview(item.id);
  });
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPreview(item.id);
    }
  });
}

function toggleSelect(id, on) {
  if (on) state.selected.add(id);
  else state.selected.delete(id);
  render();
}

function renderLinks() {
  const synced = state.items.filter((item) => item.url);
  const panel = $('results-card');
  const output = $('link-output');
  if (!synced.length) {
    panel.hidden = true;
    output.value = '';
    return;
  }
  panel.hidden = false;
  const selectedSynced = synced.filter((item) => state.selected.has(item.id));
  const source = selectedSynced.length ? selectedSynced : synced;
  output.value = source.map((item) => formatLink(item, state.format)).join('\n');
}

function openPreview(id) {
  const item = findItem(id);
  if (!item) return;
  lastFocus = document.activeElement;
  const dialog = $('preview-dialog');
  $('preview-title').textContent = item.name;
  $('meta-name').textContent = item.name;
  $('meta-dims').textContent = item.width && item.height ? item.width + ' × ' + item.height : t('noDimensions');
  $('meta-mime').textContent = item.type || t('unknownType');
  $('meta-size').textContent = formatSize(item.size);
  $('meta-status').textContent = statusLabel(item.status) + (item.error ? ' — ' + item.error : '');
  const urlInput = $('meta-url');
  urlInput.value = item.url || t('noPublicUrl');

  const stage = $('preview-stage');
  stage.replaceChildren();
  if (isImage(item)) {
    const src = item.url || localPreview(item);
    if (src) {
      const img = document.createElement('img');
      img.alt = item.name;
      img.src = src;
      stage.appendChild(img);
    }
  } else {
    const glyphWrap = document.createElement('div');
    glyphWrap.className = 'file-glyph';
    glyphWrap.style.height = '180px';
    const ext = document.createElement('span');
    ext.className = 'ext';
    ext.textContent = extOf(item.name);
    glyphWrap.appendChild(ext);
    stage.appendChild(glyphWrap);
  }

  const copyBtn = $('preview-copy');
  copyBtn.disabled = !item.url;
  copyBtn.onclick = () => item.url && copyText(formatLink(item, state.format));

  const dl = $('preview-download');
  dl.onclick = () => downloadItem(item);

  const retry = $('preview-retry');
  retry.hidden = item.status !== 'failed';
  retry.onclick = () => {
    closeDialogs();
    pushItems([item.id]);
  };

  openOverlayDialog(dialog);
}

function downloadItem(item) {
  const href = item.url || localPreview(item);
  if (!href && !item.file) return;
  const a = document.createElement('a');
  if (item.file && !item.url) {
    a.href = localPreview(item) || URL.createObjectURL(item.file);
  } else {
    a.href = href;
  }
  a.download = item.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openItemMenu(item, anchor, x, y) {
  const menu = $('context-menu');
  menu.innerHTML = '';
  const add = (label, fn, disabled) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = label;
    btn.disabled = !!disabled;
    btn.addEventListener('click', () => { closeMenus(); fn(); });
    menu.appendChild(btn);
  };
  add(t('openPreview'), () => openPreview(item.id));
  add(t('copyOne'), () => copyText(formatLink(item, state.format)), !item.url);
  add(t('download'), () => downloadItem(item), !(item.url || item.file));
  if (item.status === 'failed') add(t('retry'), () => pushItems([item.id]));
  const sep = document.createElement('div');
  sep.className = 'sep';
  menu.appendChild(sep);
  add(t('remove'), () => askRemove(item), item.status === 'pushing');
  placeMenu(menu, anchor, x, y);
}

function askRemove(item) {
  $('confirm-body').textContent = item.status === 'synced' ? t('confirmRemoveSynced') : t('confirmRemovePending');
  lastFocus = document.activeElement;
  openOverlayDialog($('confirm-dialog'));
  confirmResolver = (ok) => {
    if (ok) removeItem(item.id);
  };
}

function openOverlayDialog(dialog) {
  closeMenus();
  $('overlay').hidden = false;
  $('overlay').classList.add('open');
  dialog.hidden = false;
  dialog.classList.add('open');
  const focusable = dialog.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable) focusable.focus();
}

function closeDialogs() {
  ['preview-dialog', 'confirm-dialog'].forEach((id) => {
    const el = $(id);
    el.classList.remove('open');
    el.hidden = true;
  });
  $('overlay').classList.remove('open');
  $('overlay').hidden = true;
  if (confirmResolver) {
    const resolver = confirmResolver;
    confirmResolver = null;
    resolver(false);
  }
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

function closeMenus() {
  ['context-menu', 'lang-menu', 'overflow-menu'].forEach((id) => {
    const el = $(id);
    el.classList.remove('open');
    el.hidden = true;
  });
  activeMenu = null;
}

function placeMenu(menu, anchor, x, y) {
  closeMenus();
  menu.hidden = false;
  menu.classList.add('open');
  activeMenu = menu;
  const pad = 8;
  let left = x;
  let top = y;
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    left = rect.left;
    top = rect.bottom + 4;
  }
  requestAnimationFrame(() => {
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
    if (left < pad) left = pad;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    const first = menu.querySelector('button:not([disabled])');
    if (first) first.focus();
  });
}

function openLangMenu(anchor) {
  const menu = $('lang-menu');
  menu.innerHTML = '';
  [
    { id: 'en', label: t('langEn') },
    { id: 'id', label: t('langId') },
  ].forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitemradio');
    btn.setAttribute('aria-checked', getLanguage() === opt.id ? 'true' : 'false');
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      setLanguage(opt.id);
      closeMenus();
    });
    menu.appendChild(btn);
  });
  const rect = anchor.getBoundingClientRect();
  placeMenu(menu, null, rect.left, rect.bottom + 4);
}

function menuLink(href, label, extra) {
  const link = document.createElement('a');
  link.href = href;
  link.setAttribute('role', 'menuitem');
  link.style.cssText = 'display:flex;align-items:center;min-height:40px;padding:0 16px;text-decoration:none;color:inherit';
  link.textContent = label;
  if (extra) Object.assign(link, extra);
  return link;
}

function openOverflowMenu(anchor) {
  const menu = $('overflow-menu');
  menu.innerHTML = '';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.setAttribute('role', 'menuitem');
  refresh.textContent = t('refresh');
  refresh.addEventListener('click', () => { closeMenus(); refreshWorkspace(); });
  menu.appendChild(refresh);
  const lang = document.createElement('button');
  lang.type = 'button';
  lang.setAttribute('role', 'menuitem');
  lang.textContent = t('language');
  lang.addEventListener('click', () => openLangMenu(anchor));
  menu.appendChild(lang);
  menu.appendChild(menuLink('/admin.html', t('dashboard')));
  menu.appendChild(menuLink('https://github.com/cf-pages/Telegraph-Image', t('github'), { target: '_blank', rel: 'noopener' }));
  const sep = document.createElement('div');
  sep.className = 'sep';
  menu.appendChild(sep);
  menu.appendChild(menuLink('/index-nuxt.html', t('classicUploader')));
  const rect = anchor.getBoundingClientRect();
  placeMenu(menu, null, rect.right - 220, rect.bottom + 4);
}

async function refreshWorkspace() {
  try {
    await loadConfig();
    showToast(t('refreshed'));
  } catch (_) {
    showToast(t('refreshFailed'));
  }
  render();
}

async function loadConfig() {
  const res = await fetch('/api/config', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('config');
  const config = await res.json();
  state.config = config;
  if (config.siteName) $('site-name').textContent = config.siteName;
  if (config.siteTitle) document.title = config.siteTitle;
  const admin = $('admin-link');
  if (admin && config.showAdminEntry === false) admin.remove();
  renderSetup(config);
}

function renderSetup(config) {
  const box = $('setup-notice');
  box.replaceChildren();
  const problems = (config && config.problems) || [];
  problems.forEach((problem) => {
    const el = document.createElement('div');
    el.className = 'problem ' + (problem.severity || 'info');
    const label = document.createElement('b');
    const titles = { error: t('setupNeedsAttention'), warning: t('setupWarning'), info: t('setupInfo') };
    label.textContent = titles[problem.severity] || titles.info;
    el.appendChild(label);
    el.appendChild(document.createTextNode(problem.message));
    box.appendChild(el);
  });
  if (config && config.uploadRequiresAuth) {
    const el = document.createElement('div');
    el.className = 'problem warning';
    const label = document.createElement('b');
    label.textContent = t('setupWarning');
    el.appendChild(label);
    el.appendChild(document.createTextNode(t('uploadProtected')));
    box.appendChild(el);
  }
}

function wireEvents() {
  const fileInput = $('file-input');
  const openPicker = () => fileInput.click();
  $('add-files').addEventListener('click', openPicker);
  $('fab-add').addEventListener('click', openPicker);
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  $('push-changes').addEventListener('click', () => pushItems());
  $('retry-failed').addEventListener('click', () => {
    const ids = state.items.filter((i) => i.status === 'failed').map((i) => i.id);
    pushItems(ids);
  });
  $('refresh-btn').addEventListener('click', refreshWorkspace);
  $('theme-btn').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    savePrefs();
    applyTheme();
  });
  $('lang-btn').addEventListener('click', (event) => openLangMenu(event.currentTarget));
  $('overflow-btn').addEventListener('click', (event) => openOverflowMenu(event.currentTarget));

  $('view-grid').addEventListener('click', () => { state.layout = 'grid'; savePrefs(); render(); });
  $('view-list').addEventListener('click', () => { state.layout = 'list'; savePrefs(); render(); });
  $('sort-select').addEventListener('change', (event) => {
    state.sort = event.target.value;
    savePrefs();
    render();
  });

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.view = btn.getAttribute('data-view');
      savePrefs();
      render();
    });
  });

  const search = $('search');
  search.addEventListener('input', () => {
    state.query = search.value;
    renderChrome();
    renderBrowser();
  });
  $('search-clear').addEventListener('click', () => {
    search.value = '';
    state.query = '';
    $('search-wrap').classList.remove('expanded');
    render();
    search.focus();
  });
  $('mobile-search-toggle').addEventListener('click', () => {
    $('search-wrap').classList.add('expanded');
    search.focus();
  });

  $('format-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-format]');
    if (!button) return;
    state.format = button.dataset.format;
    $('format-tabs').querySelectorAll('button').forEach((other) => {
      const on = other === button;
      other.classList.toggle('active', on);
      other.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderLinks();
  });
  $('copy-all').addEventListener('click', () => {
    if ($('link-output').value) copyText($('link-output').value);
  });

  $('preview-close').addEventListener('click', closeDialogs);
  $('overlay').addEventListener('click', closeDialogs);
  $('confirm-cancel').addEventListener('click', closeDialogs);
  $('confirm-ok').addEventListener('click', () => {
    const resolver = confirmResolver;
    confirmResolver = null;
    closeDialogs();
    if (resolver) resolver(true);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (activeMenu) { closeMenus(); return; }
      if (!$('preview-dialog').hidden || !$('confirm-dialog').hidden) {
        closeDialogs();
        return;
      }
      if ($('search-wrap').classList.contains('expanded')) {
        $('search-wrap').classList.remove('expanded');
      }
    }
    if (activeMenu && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const items = Array.prototype.slice.call(activeMenu.querySelectorAll('button, a'));
      if (!items.length) return;
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown'
        ? items[(index + 1 + items.length) % items.length]
        : items[(index - 1 + items.length) % items.length];
      next.focus();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!state.pushing) pushItems();
    }
    if ((event.metaKey || event.ctrlKey) && (event.key === 'u' || event.key === 'U')) {
      event.preventDefault();
      fileInput.click();
    }
    if (event.key === '/' && !isTyping(event.target)) {
      event.preventDefault();
      search.focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (activeMenu && !activeMenu.contains(event.target) && !event.target.closest('#lang-btn, #overflow-btn')) {
      closeMenus();
    }
  });

  wireDragAndPaste();
}

function isTyping(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

function wireDragAndPaste() {
  const zone = $('dropzone');
  const prevent = (event) => { event.preventDefault(); event.stopPropagation(); };
  ['dragenter', 'dragover'].forEach((type) => {
    zone.addEventListener(type, (event) => {
      prevent(event);
      zone.classList.add('dragover');
    });
    document.addEventListener(type, (event) => {
      if (hasFiles(event)) event.preventDefault();
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    zone.addEventListener(type, (event) => {
      prevent(event);
      if (type === 'dragleave' && event.target !== zone && zone.contains(event.relatedTarget)) return;
      zone.classList.remove('dragover');
    });
  });
  zone.addEventListener('drop', (event) => {
    zone.classList.remove('dragover');
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
      addFiles(event.dataTransfer.files);
    }
  });

  document.addEventListener('paste', (event) => {
    if (isTyping(event.target)) return;
    if (!event.clipboardData) return;
    const files = [];
    for (let i = 0; i < event.clipboardData.items.length; i++) {
      const item = event.clipboardData.items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) addFiles(files);
  });
}

function hasFiles(event) {
  const types = event.dataTransfer && event.dataTransfer.types;
  if (!types) return false;
  return Array.prototype.indexOf.call(types, 'Files') !== -1;
}

async function restoreLocal() {
  const records = await idbAll();
  state.items = records.map((record) => {
    const item = {
      id: record.id,
      name: record.name,
      type: record.type || '',
      size: record.size || 0,
      addedAt: record.addedAt || Date.now(),
      pushedAt: record.pushedAt || null,
      status: record.status || (record.url ? 'synced' : 'pending'),
      src: record.src || null,
      url: record.url || null,
      error: record.error || null,
      progress: 0,
      width: record.width || null,
      height: record.height || null,
      file: record.blob || null,
      previewUrl: null,
    };
    if (item.status === 'pushing') item.status = 'pending';
    return item;
  }).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

function trapFocus(event) {
  const open = !$('preview-dialog').hidden ? $('preview-dialog')
    : !$('confirm-dialog').hidden ? $('confirm-dialog')
    : null;
  if (!open || event.key !== 'Tab') return;
  const nodes = open.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const list = Array.prototype.filter.call(nodes, (el) => !el.disabled && el.getAttribute('aria-hidden') !== 'true');
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function boot() {
  const prefs = loadPrefs();
  state.theme = detectTheme(prefs);
  state.layout = prefs.layout === 'list' ? 'list' : 'grid';
  state.sort = prefs.sort || 'date:desc';
  state.view = ['files', 'images', 'recent'].indexOf(prefs.view) !== -1 ? prefs.view : 'files';

  initI18n();
  applyTheme();
  onLanguageChange(() => render());
  wireEvents();
  document.addEventListener('keydown', trapFocus);

  await restoreLocal();
  render();

  try { await loadConfig(); render(); }
  catch (_) { /* defaults already painted */ }
}

boot();
