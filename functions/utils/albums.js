/**
 * Albums — a lightweight organizational layer over the existing object store.
 *
 * Design constraints (deliberate, do not relax without re-reading the docs):
 *
 *  - Albums NEVER touch storage keys, object ids, public `/file/...` URLs,
 *    upload behaviour or moderation semantics. Moving an object between albums
 *    only rewrites the `albumId` field of its KV metadata.
 *  - Album definitions live in the existing `img_url` KV namespace under the
 *    reserved `album:` prefix. `functions/utils/kv-keys.js` already treats any
 *    `<namespace>:<rest>` key as internal bookkeeping, so albums are invisible
 *    to the object list without touching that filter.
 *  - No new binding is required. A deployment that never creates an album
 *    behaves exactly as before.
 *  - Tree operations are bounded: parent walks stop at MAX_ALBUM_DEPTH and the
 *    album listing is capped, so there are no unbounded recursive queries.
 *  - Deleting an album is an organizational operation only. Objects are never
 *    deleted, and memberships that point at a missing album are resolved to the
 *    root at read time instead of triggering an expensive full-store rewrite.
 */

export const ALBUM_PREFIX = 'album:';
export const ROOT_ALBUM_ID = 'root';
export const MAX_ALBUM_DEPTH = 8;
export const MAX_ALBUM_NAME = 64;
export const MAX_ALBUMS = 500;
export const MAX_ASSIGN_BATCH = 200;

/* ----------------------------- key helpers ----------------------------- */

export function albumKey(id) {
  return ALBUM_PREFIX + id;
}

export function isAlbumKey(name) {
  return typeof name === 'string' && name.startsWith(ALBUM_PREFIX) && name.length > ALBUM_PREFIX.length;
}

export function albumIdFromKey(key) {
  return isAlbumKey(key) ? key.slice(ALBUM_PREFIX.length) : null;
}

/** Stable, URL-safe album id. Names are display-only; ids are the reference. */
export function newAlbumId() {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return 'alb_' + hex;
}

// Ids are always `alb_<token>`. Requiring the prefix keeps them distinct from
// the static sub-routes of /api/manage/albums (e.g. `assign`) and from the
// root sentinel, so a client-supplied id can never shadow an API path.
const ID_PATTERN = /^alb_[A-Za-z0-9_-]{4,60}$/;

export function isValidAlbumId(id) {
  return typeof id === 'string' && id !== ROOT_ALBUM_ID && ID_PATTERN.test(id);
}

/* ------------------------------ normalizing ---------------------------- */

export function normalizeAlbumName(name) {
  if (typeof name !== 'string') return '';
  // Collapse whitespace so " Website " and "Website" cannot become ambiguous
  // siblings. Control characters and path separators are rejected outright.
  return name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
}

export function validateAlbumName(name) {
  const clean = normalizeAlbumName(name);
  if (!clean) return { ok: false, error: 'name_required' };
  if (clean.length > MAX_ALBUM_NAME) return { ok: false, error: 'name_too_long' };
  if (clean === '/' || clean.includes('/')) return { ok: false, error: 'name_invalid' };
  return { ok: true, name: clean };
}

/** Normalizes a raw KV metadata blob into the album record shape. */
export function normalizeAlbumRecord(id, metadata) {
  const meta = metadata || {};
  const parentId = meta.parentId && meta.parentId !== ROOT_ALBUM_ID ? String(meta.parentId) : null;
  return {
    id,
    name: normalizeAlbumName(meta.name) || id,
    parentId,
    createdAt: Number(meta.createdAt) || Date.now(),
    updatedAt: Number(meta.updatedAt) || Number(meta.createdAt) || Date.now(),
  };
}

/* --------------------------- pure tree helpers ------------------------- */

export function indexAlbums(albums) {
  const index = new Map();
  for (const album of albums || []) {
    if (album && album.id) index.set(album.id, album);
  }
  return index;
}

export function childrenOf(albums, parentId) {
  const target = parentId && parentId !== ROOT_ALBUM_ID ? parentId : null;
  return (albums || []).filter((a) => (a.parentId || null) === target);
}

/**
 * Root → node chain. Bounded by MAX_ALBUM_DEPTH and a visited set so a corrupt
 * record can never spin forever.
 */
export function pathOf(index, id) {
  const chain = [];
  const seen = new Set();
  let current = index.get(id);
  let guard = 0;
  while (current && guard++ <= MAX_ALBUM_DEPTH + 1) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? index.get(current.parentId) : null;
  }
  return chain;
}

export function depthOf(index, id) {
  if (!id || id === ROOT_ALBUM_ID) return 0;
  return pathOf(index, id).length;
}

/** True when `candidateId` sits anywhere below `ancestorId`. */
export function isDescendant(index, candidateId, ancestorId) {
  if (!candidateId || !ancestorId) return false;
  let current = index.get(candidateId);
  let guard = 0;
  const seen = new Set();
  while (current && guard++ <= MAX_ALBUM_DEPTH + 1) {
    if (current.parentId === ancestorId) return true;
    if (!current.parentId || seen.has(current.parentId)) return false;
    seen.add(current.parentId);
    current = index.get(current.parentId);
  }
  return false;
}

/** Deepest level below `id`, used to keep moves inside MAX_ALBUM_DEPTH. */
export function subtreeHeight(albums, id) {
  const byParent = new Map();
  for (const album of albums) {
    const key = album.parentId || ROOT_ALBUM_ID;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(album);
  }
  let height = 1;
  let level = byParent.get(id) || [];
  let guard = 0;
  while (level.length && guard++ <= MAX_ALBUM_DEPTH + 1) {
    height += 1;
    const next = [];
    for (const node of level) next.push(...(byParent.get(node.id) || []));
    level = next;
  }
  return height;
}

/**
 * Validates a create/move destination.
 * `id` is null when creating a brand new album.
 */
export function validateParent(albums, id, parentId, name) {
  const index = indexAlbums(albums);
  const target = parentId && parentId !== ROOT_ALBUM_ID ? String(parentId) : null;

  if (target) {
    if (!index.has(target)) return { ok: false, error: 'parent_not_found' };
    if (id && target === id) return { ok: false, error: 'self_parent' };
    if (id && isDescendant(index, target, id)) return { ok: false, error: 'cycle' };
  }

  const parentDepth = target ? depthOf(index, target) : 0;
  const height = id ? subtreeHeight(albums, id) : 1;
  if (parentDepth + height > MAX_ALBUM_DEPTH) return { ok: false, error: 'too_deep' };

  if (name) {
    const clash = albums.some((a) => (
      a.id !== id
      && (a.parentId || null) === target
      && a.name.toLowerCase() === String(name).toLowerCase()
    ));
    if (clash) return { ok: false, error: 'duplicate_name' };
  }

  return { ok: true, parentId: target };
}

/* --------------------------- KV persistence ---------------------------- */

export async function listAlbums(env) {
  const albums = [];
  let cursor;
  let complete = false;
  // Bounded: at most MAX_ALBUMS records across a handful of KV pages.
  for (let page = 0; page < 5; page++) {
    const result = await env.img_url.list({ prefix: ALBUM_PREFIX, limit: 200, cursor });
    for (const key of result.keys || []) {
      const id = albumIdFromKey(key.name);
      if (!id) continue;
      albums.push(normalizeAlbumRecord(id, key.metadata));
      if (albums.length >= MAX_ALBUMS) return { albums, list_complete: false };
    }
    complete = !!result.list_complete;
    cursor = result.cursor;
    if (complete || !cursor) break;
  }
  return { albums, list_complete: complete };
}

export async function getAlbum(env, id) {
  if (!isValidAlbumId(id)) return null;
  const record = await env.img_url.getWithMetadata(albumKey(id));
  if (!record || !record.metadata) return null;
  return normalizeAlbumRecord(id, record.metadata);
}

export async function putAlbum(env, album) {
  const metadata = {
    kind: 'album',
    name: album.name,
    parentId: album.parentId || null,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
  };
  await env.img_url.put(albumKey(album.id), '', { metadata });
  return normalizeAlbumRecord(album.id, metadata);
}

export async function deleteAlbum(env, id) {
  await env.img_url.delete(albumKey(id));
}

/**
 * Deleting an album removes organization only. Direct child albums are lifted
 * to the deleted album's parent so nothing is orphaned; contained objects are
 * left untouched and simply resolve to the root until they are moved again.
 */
export async function reparentChildren(env, albums, id, newParentId) {
  const moved = [];
  for (const child of childrenOf(albums, id)) {
    const updated = { ...child, parentId: newParentId || null, updatedAt: Date.now() };
    await putAlbum(env, updated);
    moved.push(updated);
  }
  return moved;
}

/** Resolves a stored membership: unknown albums fall back to the root. */
export function resolveMembership(index, albumId) {
  if (!albumId || albumId === ROOT_ALBUM_ID) return null;
  return index.has(albumId) ? albumId : null;
}
