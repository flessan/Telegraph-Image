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
async function boot({ page, module: modulePath, language = 'en', routes = {}, prefs = {} }) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true });
  const win = dom.window;

  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  win.URL.createObjectURL = () => 'blob:mock';
  win.URL.revokeObjectURL = () => {};
  win.scrollTo = () => {};
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
  class MockXHR {
    constructor() { this.upload = {}; this.status = 200; }
    open(method, url) { this.method = method; this.url = url; }
    send(body) {
      uploads.push({ url: this.url, body });
      setTimeout(() => {
        const id = 'r2-' + (++counter) + '.png';
        this.responseText = JSON.stringify([{ src: '/file/' + id }]);
        this.status = 200;
        this.onload && this.onload();
      }, 0);
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
