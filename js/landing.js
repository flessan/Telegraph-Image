import { applyStaticI18n, getLanguage, initI18n, onLanguageChange, setLanguage, t } from './i18n.js';

const PREFS_KEY = 'ti.prefs';
const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

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
  const button = $('theme-btn');
  button.classList.add('theme-switching');
  theme = theme === 'dark' ? 'light' : 'dark';
  setPrefs({ theme });
  paint();
  window.setTimeout(() => button.classList.remove('theme-switching'), 560);
});

$('lang-btn').addEventListener('click', () => setLanguage(getLanguage() === 'en' ? 'id' : 'en'));

function scheduleFrame(callback) {
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(callback);
  else window.setTimeout(callback, 0);
}

function setupEntranceAndReveals() {
  const revealNodes = Array.from(document.querySelectorAll('.reveal-on-scroll'));
  if (reducedMotion.matches) {
    document.body.classList.add('landing-ready');
    revealNodes.forEach((node) => node.classList.add('is-visible'));
    return;
  }

  document.body.classList.add('motion-ready');
  scheduleFrame(() => document.body.classList.add('landing-ready'));

  if (typeof window.IntersectionObserver !== 'function') {
    revealNodes.forEach((node) => node.classList.add('is-visible'));
    return;
  }

  const observer = new window.IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });

  revealNodes.forEach((node) => observer.observe(node));
}

function setupScrollFeedback() {
  const header = $('landing-header');
  const progress = $('scroll-progress-bar');
  let queued = false;
  const paintScroll = () => {
    queued = false;
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const viewport = Number(window.innerHeight) || 1;
    const pageHeight = Number(document.documentElement.scrollHeight) || viewport;
    const scrollable = Math.max(1, pageHeight - viewport);
    header.classList.toggle('is-scrolled', y > 18);
    progress.style.transform = `scaleX(${Math.min(1, Math.max(0, y / scrollable))})`;
  };
  const onScroll = () => {
    if (queued) return;
    queued = true;
    scheduleFrame(paintScroll);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  paintScroll();
}

function setupVisualParallax() {
  const visual = $('storage-visual');
  if (!visual || reducedMotion.matches || !window.matchMedia
    || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  visual.addEventListener('pointermove', (event) => {
    const rect = visual.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    visual.style.setProperty('--visual-rx', `${(-y * 3.2).toFixed(2)}deg`);
    visual.style.setProperty('--visual-ry', `${(x * 4.2).toFixed(2)}deg`);
  });
  visual.addEventListener('pointerleave', () => {
    visual.style.setProperty('--visual-rx', '0deg');
    visual.style.setProperty('--visual-ry', '0deg');
  });
}

setupEntranceAndReveals();
setupScrollFeedback();
setupVisualParallax();

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
