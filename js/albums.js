/**
 * Shared album model for the public workspace and the Remote Storage Console.
 *
 * Albums are an organizational layer only: an album record is
 * `{ id, name, parentId, createdAt, updatedAt, synced }` and an object simply
 * carries an `albumId`. Nothing here knows about storage keys, public URLs or
 * upload behaviour — moving something between albums never changes its
 * identity.
 *
 * Everything in this module is pure and DOM-free so both surfaces (and the
 * unit tests) can share exactly one implementation of the tree rules.
 */

export const ROOT_ID = 'root';
export const MAX_DEPTH = 8;
export const MAX_NAME = 64;

export function newAlbumId() {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return 'alb_' + hex;
}

export function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
}

/** Returns `{ ok, name }` or `{ ok: false, error }` with a stable error code. */
export function validateName(name) {
  const clean = normalizeName(name);
  if (!clean) return { ok: false, error: 'name_required' };
  if (clean.length > MAX_NAME) return { ok: false, error: 'name_too_long' };
  if (clean.includes('/')) return { ok: false, error: 'name_invalid' };
  return { ok: true, name: clean };
}

/** Normalizes any album-ish record (local draft or API payload). */
export function normalizeAlbum(raw) {
  if (!raw || !raw.id) return null;
  const parentId = raw.parentId && raw.parentId !== ROOT_ID ? String(raw.parentId) : null;
  return {
    id: String(raw.id),
    name: normalizeName(raw.name) || String(raw.id),
    parentId,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
    synced: raw.synced === true,
  };
}

export function createAlbum(name, parentId, { id } = {}) {
  const now = Date.now();
  return {
    id: id || newAlbumId(),
    name: normalizeName(name),
    parentId: parentId && parentId !== ROOT_ID ? String(parentId) : null,
    createdAt: now,
    updatedAt: now,
    synced: false,
  };
}

export function indexAlbums(albums) {
  const map = new Map();
  for (const album of albums || []) if (album && album.id) map.set(album.id, album);
  return map;
}

export function sortAlbums(albums, locale) {
  return (albums || []).slice().sort((a, b) => (
    String(a.name).localeCompare(String(b.name), locale || undefined, { sensitivity: 'base', numeric: true })
    || String(a.id).localeCompare(String(b.id))
  ));
}

export function childrenOf(albums, parentId, locale) {
  const target = parentId && parentId !== ROOT_ID ? parentId : null;
  return sortAlbums((albums || []).filter((a) => (a.parentId || null) === target), locale);
}

/** Root → node chain, cycle- and depth-guarded. */
export function pathOf(index, id) {
  const chain = [];
  const seen = new Set();
  let current = index.get(id);
  let guard = 0;
  while (current && guard++ <= MAX_DEPTH + 1) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? index.get(current.parentId) : null;
  }
  return chain;
}

/** "Projects / Website / Screenshots" — display only, never an identifier. */
export function pathLabel(index, id, { rootLabel, separator = ' / ' } = {}) {
  const chain = pathOf(index, id).map((a) => a.name);
  if (rootLabel) chain.unshift(rootLabel);
  return chain.join(separator);
}

export function depthOf(index, id) {
  if (!id || id === ROOT_ID) return 0;
  return pathOf(index, id).length;
}

export function isDescendant(index, candidateId, ancestorId) {
  if (!candidateId || !ancestorId) return false;
  let current = index.get(candidateId);
  const seen = new Set();
  let guard = 0;
  while (current && guard++ <= MAX_DEPTH + 1) {
    if (current.parentId === ancestorId) return true;
    if (!current.parentId || seen.has(current.parentId)) return false;
    seen.add(current.parentId);
    current = index.get(current.parentId);
  }
  return false;
}

export function subtreeHeight(albums, id) {
  const byParent = new Map();
  for (const album of albums || []) {
    const key = album.parentId || ROOT_ID;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(album);
  }
  let height = 1;
  let level = byParent.get(id) || [];
  let guard = 0;
  while (level.length && guard++ <= MAX_DEPTH + 1) {
    height += 1;
    const next = [];
    for (const node of level) next.push(...(byParent.get(node.id) || []));
    level = next;
  }
  return height;
}

/** Collects an album and everything below it (bounded by MAX_DEPTH). */
export function subtreeIds(albums, id) {
  const ids = new Set([id]);
  let frontier = [id];
  let guard = 0;
  while (frontier.length && guard++ <= MAX_DEPTH + 1) {
    const next = [];
    for (const album of albums || []) {
      if (album.parentId && frontier.includes(album.parentId) && !ids.has(album.id)) {
        ids.add(album.id);
        next.push(album.id);
      }
    }
    frontier = next;
  }
  return ids;
}

/**
 * Can `id` become a child of `parentId`? `id` may be null when creating.
 * Returns `{ ok: true, parentId }` or `{ ok: false, error }` where error is one
 * of: parent_not_found | self_parent | cycle | too_deep | duplicate_name.
 */
export function canMove(albums, id, parentId, name) {
  const index = indexAlbums(albums);
  const target = parentId && parentId !== ROOT_ID ? String(parentId) : null;

  if (target) {
    if (!index.has(target)) return { ok: false, error: 'parent_not_found' };
    if (id && target === id) return { ok: false, error: 'self_parent' };
    if (id && isDescendant(index, target, id)) return { ok: false, error: 'cycle' };
  }

  const parentDepth = target ? depthOf(index, target) : 0;
  const height = id ? subtreeHeight(albums, id) : 1;
  if (parentDepth + height > MAX_DEPTH) return { ok: false, error: 'too_deep' };

  const wanted = name === undefined && id ? (index.get(id) || {}).name : name;
  if (wanted) {
    const clash = (albums || []).some((a) => (
      a.id !== id
      && (a.parentId || null) === target
      && String(a.name).toLowerCase() === String(wanted).toLowerCase()
    ));
    if (clash) return { ok: false, error: 'duplicate_name' };
  }

  return { ok: true, parentId: target };
}

/** Memberships pointing at an unknown album resolve to the root. */
export function resolveAlbumId(index, albumId) {
  if (!albumId || albumId === ROOT_ID) return null;
  return index.has(albumId) ? albumId : null;
}

/**
 * Flattens the tree for rendering: `{ album, depth, hasChildren }`, parents
 * before children, with collapsed subtrees skipped.
 */
export function flattenTree(albums, { expanded, locale } = {}) {
  const rows = [];
  const isOpen = (id) => !expanded || expanded.has(id);
  const walk = (parentId, depth) => {
    if (depth > MAX_DEPTH) return;
    for (const album of childrenOf(albums, parentId, locale)) {
      const kids = childrenOf(albums, album.id, locale);
      rows.push({ album, depth, hasChildren: kids.length > 0 });
      if (kids.length && isOpen(album.id)) walk(album.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** Ancestors of `id`, used to auto-expand a tree down to the open album. */
export function ancestorIds(index, id) {
  return pathOf(index, id).slice(0, -1).map((a) => a.id);
}

/**
 * Truthful counts from the data actually loaded on this device. Callers must
 * not present these as global remote totals when the index is partial.
 */
export function countObjects(items, albumId, { getAlbumId, albums, recursive = false } = {}) {
  const read = getAlbumId || ((item) => item.albumId || null);
  const target = albumId && albumId !== ROOT_ID ? albumId : null;
  const scope = recursive && target && albums ? subtreeIds(albums, target) : null;
  let n = 0;
  for (const item of items || []) {
    const value = read(item) || null;
    if (scope ? (value && scope.has(value)) : value === target) n++;
  }
  return n;
}

/** Objects directly inside an album (root = everything unfiled). */
export function objectsIn(items, albumId, { getAlbumId, index } = {}) {
  const read = getAlbumId || ((item) => item.albumId || null);
  const target = albumId && albumId !== ROOT_ID ? albumId : null;
  return (items || []).filter((item) => {
    const raw = read(item) || null;
    const value = index ? resolveAlbumId(index, raw) : raw;
    return value === target;
  });
}

/** Serializable snapshot (drops runtime-only fields). */
export function serializeAlbum(album) {
  return {
    id: album.id,
    name: album.name,
    parentId: album.parentId || null,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
    synced: !!album.synced,
  };
}

export function mergeRemoteAlbums(local, remote) {
  const map = new Map();
  for (const album of local || []) {
    const normalized = normalizeAlbum(album);
    if (normalized) map.set(normalized.id, normalized);
  }
  for (const album of remote || []) {
    const normalized = normalizeAlbum(album);
    if (!normalized) continue;
    const existing = map.get(normalized.id);
    // The remote copy wins unless the local one has newer unsynced edits.
    if (existing && !existing.synced && existing.updatedAt > normalized.updatedAt) continue;
    map.set(normalized.id, { ...normalized, synced: true });
  }
  return Array.from(map.values());
}
