import { applyStaticI18n, getLanguage, initI18n, onLanguageChange, setLanguage, t } from './i18n.js';

const PREFS_KEY = 'ti.prefs';
const $ = (id) => document.getElementById(id);

function prefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; }
  catch (_) { return {}; }
}

function setPrefs(patch) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs(), ...patch })); }
  catch (_) { /* storage can be unavailable in private mode */ }
}

function preferredTheme() {
  const saved = prefs().theme;
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let theme = preferredTheme();

function paint() {
  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = getLanguage();
  applyStaticI18n(document);
  $('lang-code').textContent = getLanguage().toUpperCase();
  const themeButton = $('theme-btn');
  themeButton.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  themeButton.setAttribute('aria-label', t(theme === 'dark' ? 'themeDark' : 'themeLight'));
}

initI18n();
paint();
onLanguageChange(paint);

$('theme-btn').addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  setPrefs({ theme });
  paint();
});

$('lang-btn').addEventListener('click', () => setLanguage(getLanguage() === 'en' ? 'id' : 'en'));

function safeBackgroundUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value), window.location.origin);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    // URL serialization percent-encodes quotes and control characters. Keeping
    // the value quoted also makes CSS delimiters in filenames inert.
    return parsed.href;
  } catch (_) {
    return null;
  }
}

// Keep the fork's existing public site customization contract without making
// the landing page depend on it: defaults remain fully usable if config fails.
fetch('/api/config', { headers: { Accept: 'application/json' } })
  .then((response) => response.ok ? response.json() : null)
  .then((config) => {
    if (!config) return;
    if (config.siteName) $('site-name').textContent = config.siteName;
    if (config.siteTitle) document.title = config.siteTitle;
    const background = safeBackgroundUrl(config.backgroundImage);
    if (background) {
      document.body.style.setProperty('--landing-background-image', `url(${JSON.stringify(background)})`);
      document.body.classList.add('has-custom-background');
    }
  })
  .catch(() => { /* the static landing page remains available offline */ });
