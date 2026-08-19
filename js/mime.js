/**
 * MIME awareness for previews and generated output.
 *
 * One source of truth for "what kind of thing is this object?" shared by the
 * public workspace and the Remote Storage Console. Everything here is pure and
 * DOM-free so it can be unit tested and reused on both surfaces.
 *
 * Rules:
 *  - The declared MIME type is authoritative (`File.type` locally, stored
 *    metadata remotely). The filename extension is only a fallback for when no
 *    usable MIME type exists.
 *  - Generated snippets are for copy/paste into other systems, so every value
 *    interpolated into them is escaped for its own syntax.
 *  - Nothing here knows about storage, uploads or URLs beyond receiving the
 *    already-built public URL.
 */

export const CATEGORY = {
  IMAGE: 'image',
  AUDIO: 'audio',
  VIDEO: 'video',
  PDF: 'pdf',
  TEXT: 'text',
  ARCHIVE: 'archive',
  FILE: 'file',
};

const EXTENSION_CATEGORIES = {
  // images
  jpg: CATEGORY.IMAGE, jpeg: CATEGORY.IMAGE, png: CATEGORY.IMAGE, gif: CATEGORY.IMAGE,
  webp: CATEGORY.IMAGE, bmp: CATEGORY.IMAGE, tif: CATEGORY.IMAGE, tiff: CATEGORY.IMAGE,
  ico: CATEGORY.IMAGE, svg: CATEGORY.IMAGE, avif: CATEGORY.IMAGE, heic: CATEGORY.IMAGE,
  heif: CATEGORY.IMAGE, jfif: CATEGORY.IMAGE,
  // audio
  mp3: CATEGORY.AUDIO, wav: CATEGORY.AUDIO, flac: CATEGORY.AUDIO, aac: CATEGORY.AUDIO,
  m4a: CATEGORY.AUDIO, oga: CATEGORY.AUDIO, opus: CATEGORY.AUDIO, wma: CATEGORY.AUDIO,
  // video
  mp4: CATEGORY.VIDEO, webm: CATEGORY.VIDEO, mov: CATEGORY.VIDEO, m4v: CATEGORY.VIDEO,
  avi: CATEGORY.VIDEO, mkv: CATEGORY.VIDEO, mpeg: CATEGORY.VIDEO, mpg: CATEGORY.VIDEO,
  // ogg is ambiguous; treat the bare container as video, which degrades to a
  // player that can still play audio-only streams.
  ogg: CATEGORY.VIDEO, ogv: CATEGORY.VIDEO,
  // documents
  pdf: CATEGORY.PDF,
  txt: CATEGORY.TEXT, md: CATEGORY.TEXT, csv: CATEGORY.TEXT, log: CATEGORY.TEXT,
  json: CATEGORY.TEXT, xml: CATEGORY.TEXT, yml: CATEGORY.TEXT, yaml: CATEGORY.TEXT,
  // archives
  zip: CATEGORY.ARCHIVE, rar: CATEGORY.ARCHIVE, '7z': CATEGORY.ARCHIVE, tar: CATEGORY.ARCHIVE,
  gz: CATEGORY.ARCHIVE, tgz: CATEGORY.ARCHIVE, bz2: CATEGORY.ARCHIVE, xz: CATEGORY.ARCHIVE,
  zst: CATEGORY.ARCHIVE,
};

const ARCHIVE_MIME = /^application\/(zip|x-zip-compressed|x-rar-compressed|vnd\.rar|x-7z-compressed|x-tar|gzip|x-gzip|x-bzip2|zstd)$/;
const TEXT_MIME = /^application\/(json|ld\+json|xml|xhtml\+xml|yaml|x-yaml|javascript|x-ndjson)$/;

/** Normalizes a MIME type: lowercased, parameters and whitespace removed. */
export function normalizeMime(mime) {
  if (typeof mime !== 'string') return '';
  const value = mime.split(';')[0].trim().toLowerCase();
  // "application/octet-stream" carries no information; treat it as unknown so
  // the extension fallback can do better.
  if (!value || value === 'application/octet-stream' || value === 'binary/octet-stream') return '';
  return value;
}

export function extensionOf(name) {
  const base = String(name || '').split(/[?#]/)[0];
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Resolves the semantic category of an object.
 * `mime` wins whenever it is usable; the extension is a conservative fallback.
 */
export function categorize({ mime, name } = {}) {
  const type = normalizeMime(mime);
  if (type) {
    if (type.startsWith('image/')) return CATEGORY.IMAGE;
    if (type.startsWith('audio/')) return CATEGORY.AUDIO;
    if (type.startsWith('video/')) return CATEGORY.VIDEO;
    if (type === 'application/pdf' || type === 'application/x-pdf') return CATEGORY.PDF;
    if (ARCHIVE_MIME.test(type)) return CATEGORY.ARCHIVE;
    if (type.startsWith('text/') || TEXT_MIME.test(type)) return CATEGORY.TEXT;
    return CATEGORY.FILE;
  }
  const ext = extensionOf(name);
  return EXTENSION_CATEGORIES[ext] || CATEGORY.FILE;
}

/** True when the declared MIME type (not the filename) decided the category. */
export function isMimeAuthoritative(mime) {
  return normalizeMime(mime) !== '';
}

/** Categories the product can render inline. */
export function isPlayable(category) {
  return category === CATEGORY.AUDIO || category === CATEGORY.VIDEO;
}

/**
 * Which preview surface to render. Text is deliberately not inlined: the
 * product has no sanitized text viewer, so text files get the generic surface.
 */
export function previewKind(input) {
  const category = typeof input === 'string' ? input : categorize(input);
  switch (category) {
    case CATEGORY.IMAGE: return 'image';
    case CATEGORY.AUDIO: return 'audio';
    case CATEGORY.VIDEO: return 'video';
    case CATEGORY.PDF: return 'pdf';
    default: return 'file';
  }
}

/** Object URLs are only worth creating for surfaces that can render them. */
export function canPreviewLocally(category) {
  return category === CATEGORY.IMAGE || category === CATEGORY.AUDIO
    || category === CATEGORY.VIDEO || category === CATEGORY.PDF;
}

/* ------------------------------ escaping ------------------------------ */

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** URLs inside HTML attributes: escape the delimiters, keep the URL usable. */
export function escapeHtmlUrl(url) {
  return escapeHtml(String(url == null ? '' : url));
}

/** Escapes the characters that would break Markdown link/label syntax. */
export function escapeMarkdown(value) {
  return String(value == null ? '' : value).replace(/([\\`*_{}[\]()#+\-.!|<>])/g, '\\$1');
}

/**
 * Markdown URLs: angle-bracket form when the URL contains characters that would
 * terminate the link early, with those characters percent-encoded.
 */
export function markdownUrl(url) {
  // encodeURIComponent leaves parentheses alone, so encode the link-breaking
  // characters explicitly instead.
  const MAP = { ' ': '%20', '(': '%28', ')': '%29', '<': '%3C', '>': '%3E', '"': '%22' };
  return String(url == null ? '' : url).replace(/[()\s<>"]/g, (c) => MAP[c] || encodeURIComponent(c));
}

/**
 * BBCode has no escape syntax; forum software universally renders numeric HTML
 * entities, so brackets in a label become entities instead of breaking tags.
 */
export function escapeBbcode(value) {
  return String(value == null ? '' : value)
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;');
}

export function bbcodeUrl(url) {
  return String(url == null ? '' : url).replace(/\[/g, '%5B').replace(/\]/g, '%5D');
}

/* --------------------------- output formatting ------------------------ */

export const FORMATS = ['url', 'markdown', 'bbcode', 'html'];

/**
 * Builds a copy/paste snippet for an object.
 *
 * @param {{url: string, name: string, mime?: string, category?: string}} object
 * @param {'url'|'markdown'|'bbcode'|'html'} format
 */
export function formatOutput(object, format) {
  const url = String((object && object.url) || '');
  if (!url) return '';
  const name = String((object && object.name) || '') || url.split('/').pop() || 'file';
  const category = (object && object.category) || categorize({ mime: object && object.mime, name });

  switch (format) {
    case 'markdown': return markdownFor(category, url, name);
    case 'bbcode': return bbcodeFor(category, url, name);
    case 'html': return htmlFor(category, url, name);
    case 'url':
    default:
      // The direct URL is always the untouched public URL.
      return url;
  }
}

function markdownFor(category, url, name) {
  const label = escapeMarkdown(name);
  const href = markdownUrl(url);
  // Image syntax is reserved for images; everything else is a normal link so
  // it never renders as a broken image.
  return category === CATEGORY.IMAGE ? `![${label}](${href})` : `[${label}](${href})`;
}

function bbcodeFor(category, url, name) {
  const href = bbcodeUrl(url);
  if (category === CATEGORY.IMAGE) return `[img]${href}[/img]`;
  return `[url=${href}]${escapeBbcode(name)}[/url]`;
}

function htmlFor(category, url, name) {
  const href = escapeHtmlUrl(url);
  const label = escapeHtml(name);
  switch (category) {
    case CATEGORY.IMAGE:
      return `<img src="${href}" alt="${label}" loading="lazy">`;
    case CATEGORY.AUDIO:
      return `<audio controls preload="metadata" src="${href}">${label}</audio>`;
    case CATEGORY.VIDEO:
      return `<video controls preload="metadata" src="${href}">${label}</video>`;
    case CATEGORY.PDF:
      // An iframe embeds the browser's own PDF viewer and degrades to the link
      // inside it when embedding is blocked.
      return `<iframe src="${href}" title="${label}" width="100%" height="600" loading="lazy"></iframe>`;
    default:
      return `<a href="${href}" download>${label}</a>`;
  }
}

/** i18n key describing the category, for chips and preview labels. */
export function categoryLabelKey(category) {
  return {
    [CATEGORY.IMAGE]: 'typeImage',
    [CATEGORY.AUDIO]: 'typeAudio',
    [CATEGORY.VIDEO]: 'typeVideo',
    [CATEGORY.PDF]: 'typePdf',
    [CATEGORY.TEXT]: 'typeText',
    [CATEGORY.ARCHIVE]: 'typeArchive',
    [CATEGORY.FILE]: 'typeFile',
  }[category] || 'typeFile';
}
