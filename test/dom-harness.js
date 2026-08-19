const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');

/**
 * Minimal browser harness for the two front-end surfaces.
 *
 * The pages are real (index.html / admin.html) and the real ES modules are
 * imported, so these tests exercise the shipped code path: rendering, event
 * wiring, dialogs and the network calls each action does (or deliberately does
 * not) make.
 */

let saved = null;
let counter = 0;

function stubImage(win) {
  // jsdom cannot decode images; resolve dimensions asynchronously as "unknown".
  win.Image = class {
    set src(_value) { setTimeout(() => this.onerror && this.onerror(), 0); }
    get src() { return ''; }
  };
}

function makeFile(win, name, type, content) {
  return new win.File([content || 'x'], name, { type: type || 'text/plain' });
}

/** A DataTransfer good enough for the drag handlers under test. */
function dataTransfer({ files = [], types } = {}) {
  const store = new Map();
  return {
    files,
    types: types || (files.length ? ['Files'] : []),
    dropEffect: '',
    effectAllowed: '',
    setData(kind, value) { store.set(kind, value); },
    getData(kind) { return store.get(kind) || ''; },
  };
}

function fire(el, type, extra = {}) {
  const win = el.defaultView || el.ownerDocument.defaultView;
  const event = new win.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, extra);
  el.dispatchEvent(event);
  return event;
}

function click(el) {
  if (!el) throw new Error('cannot click a missing element');
  const win = el.ownerDocument.defaultView;
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function tick(ms = 12) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Boots a page with the given module and returns handles plus a fetch log.
 * `routes` maps a URL matcher to a handler returning `{ status, body }`.
 */
async function boot(options = {}) {
  const { page, module: modulePath, language = 'en', routes = {}, prefs = {} } = options;
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true });
  const win = dom.window;

  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  win.URL.createObjectURL = () => 'blob:mock';
  win.URL.revokeObjectURL = () => {};
  win.scrollTo = () => {};
  // Both surfaces fall back to execCommand('copy') when the async clipboard is
  // unavailable (it is, under jsdom). Capture what would have been copied.
  win.__copied = null;
  win.document.execCommand = (command) => {
    if (command !== 'copy') return false;
    const areas = win.document.querySelectorAll('textarea');
    const last = areas[areas.length - 1];
    win.__copied = last ? last.value : null;
    return true;
  };
  stubImage(win);
  win.localStorage.setItem('ti.lang', language);
  if (Object.keys(prefs).length) win.localStorage.setItem('ti.prefs', JSON.stringify(prefs));

  const calls = [];
  const uploads = [];
  const fetchImpl = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, method: (init.method || 'GET').toUpperCase(), body: init.body ? JSON.parse(init.body) : null });
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        const result = await handler({ url, init });
        return new Response(JSON.stringify(result.body ?? {}), {
          status: result.status || 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  };

  // XHR is only used by the workspace push; capture it instead of networking.
  // `xhrScript(call)` may return { status, body, headers, delayMs, networkError,
  // bytes } to script transient failures, rate limits and slow uploads.
  const script = typeof options.xhrScript === 'function' ? options.xhrScript : null;
  class MockXHR {
    constructor() { this.upload = {}; this.status = 200; this._headers = {}; }
    open(method, url) { this.method = method; this.url = url; }
    getResponseHeader(name) {
      const key = String(name).toLowerCase();
      const found = Object.keys(this._headers).find((k) => k.toLowerCase() === key);
      return found ? String(this._headers[found]) : null;
    }
    send(body) {
      const index = uploads.length;
      const file = body && typeof body.get === 'function' ? body.get('file') : null;
      const call = {
        url: this.url,
        body,
        index,
        name: (file && file.name) || null,
        size: (file && file.size) || 0,
        at: Date.now(),
      };
      uploads.push(call);
      const plan = (script && script(call)) || {};
      const delay = plan.delayMs == null ? 0 : plan.delayMs;
      setTimeout(() => {
        if (plan.networkError) {
          this.status = 0;
          this.onerror && this.onerror();
          return;
        }
        if (this.upload.onprogress) {
          const total = call.size || 1;
          this.upload.onprogress({ lengthComputable: true, loaded: total, total });
        }
        const id = plan.id || ('r2-' + (++counter) + '.png');
        this._headers = plan.headers || {};
        this.status = plan.status == null ? 200 : plan.status;
        this.responseText = plan.body != null
          ? (typeof plan.body === 'string' ? plan.body : JSON.stringify(plan.body))
          : JSON.stringify([{ src: '/file/' + id }]);
        call.finishedAt = Date.now();
        this.onload && this.onload();
      }, delay);
    }
  }
  win.XMLHttpRequest = MockXHR;

  saved = {
    keys: ['window', 'document', 'localStorage', 'location', 'fetch', 'XMLHttpRequest', 'requestAnimationFrame',
      'cancelAnimationFrame', 'Image', 'File', 'FormData', 'Event', 'MouseEvent', 'CSS', 'getComputedStyle',
      'HTMLElement', 'URL'],
    values: {},
    dom,
  };
  for (const key of saved.keys) saved.values[key] = globalThis[key];

  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.localStorage = win.localStorage;
  globalThis.location = win.location;
  globalThis.fetch = fetchImpl;
  globalThis.XMLHttpRequest = MockXHR;
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.Image = win.Image;
  globalThis.File = win.File;
  globalThis.FormData = win.FormData;
  globalThis.Event = win.Event;
  globalThis.MouseEvent = win.MouseEvent;
  globalThis.CSS = win.CSS || { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
  globalThis.getComputedStyle = win.getComputedStyle.bind(win);
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.URL = win.URL;

  const errors = [];
  win.addEventListener('error', (e) => errors.push(String(e.message)));

  await import(path.join(root, modulePath) + '?boot=' + (++counter));
  await tick(30);

  const $ = (id) => win.document.getElementById(id);
  const all = (sel) => Array.from(win.document.querySelectorAll(sel));
  const text = () => win.document.body.textContent;

  return {
    win, doc: win.document, $, all, text, calls, uploads, errors,
    file: (name, type, content) => makeFile(win, name, type, content),
    copied: () => win.__copied,
    dataTransfer,
    fire, click, tick,
  };
}

function teardown() {
  if (!saved) return;
  for (const key of saved.keys) {
    if (saved.values[key] === undefined) delete globalThis[key];
    else globalThis[key] = saved.values[key];
  }
  saved.dom.window.close();
  saved = null;
}

module.exports = { boot, teardown, click, fire, tick, dataTransfer };
