import { jsonResponse } from '../../../utils/http.js';
import { getMetadata, normalizeMetadata, putMetadata } from '../../../utils/metadata.js';
import { MAX_ASSIGN_BATCH, ROOT_ALBUM_ID, getAlbum } from '../../../utils/albums.js';

/**
 * /api/manage/albums/assign
 *
 * POST { albumId: string|null, ids: string[] }
 *
 * Sets (or clears, when albumId is null/"root") the album membership of the
 * given objects. This is the ONLY write this feature performs against object
 * metadata: the object id, filename, public URL, storage provider, short link,
 * like state and moderation fields are copied through untouched, so moving an
 * object between albums is invisible to `/file/...` and to moderation.
 *
 * Re-sending the same assignment is a no-op, which keeps client retries and
 * the workspace Push flow idempotent.
 */
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'invalid_body' }, { status: 400 });
  }

  const ids = Array.isArray(body && body.ids) ? body.ids.filter((id) => typeof id === 'string' && id) : [];
  if (!ids.length) return jsonResponse({ error: 'ids_required' }, { status: 400 });
  if (ids.length > MAX_ASSIGN_BATCH) return jsonResponse({ error: 'too_many_ids' }, { status: 400 });

  const raw = body.albumId;
  const albumId = raw && raw !== ROOT_ALBUM_ID ? String(raw) : null;
  if (albumId) {
    const album = await getAlbum(env, albumId);
    if (!album) return jsonResponse({ error: 'album_not_found' }, { status: 404 });
  }

  const updated = [];
  const missing = [];
  for (const id of ids) {
    const metadata = await getMetadata(env, id);
    if (!metadata) {
      missing.push(id);
      continue;
    }
    const next = normalizeMetadata(metadata, id);
    if (albumId) next.albumId = albumId;
    else delete next.albumId;
    await putMetadata(env, id, next);
    updated.push(id);
  }

  return jsonResponse({ albumId, updated, missing });
}
