import { jsonResponse } from '../../../utils/http.js';
import {
  listAlbums,
  newAlbumId,
  isValidAlbumId,
  putAlbum,
  validateAlbumName,
  validateParent,
} from '../../../utils/albums.js';

/**
 * /api/manage/albums
 *
 *   GET  → { albums: [...], list_complete: boolean }
 *   POST → create an album. Body: { name, parentId?, id? }
 *
 * Passing a client-generated `id` makes creation idempotent: a retry with the
 * same id returns the existing record instead of producing a duplicate.
 * Sits behind the existing manage middleware — no new auth surface.
 */
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const { albums, list_complete } = await listAlbums(env);
    return jsonResponse({ albums, list_complete });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'invalid_body' }, { status: 400 });
  }

  const nameCheck = validateAlbumName(body && body.name);
  if (!nameCheck.ok) return jsonResponse({ error: nameCheck.error }, { status: 400 });

  const { albums } = await listAlbums(env);

  const requestedId = body && body.id ? String(body.id) : null;
  if (requestedId && !isValidAlbumId(requestedId)) {
    return jsonResponse({ error: 'invalid_id' }, { status: 400 });
  }
  const existing = requestedId ? albums.find((a) => a.id === requestedId) : null;
  if (existing) {
    // Idempotent retry — do not create a second record.
    return jsonResponse({ album: existing, created: false });
  }

  const parentCheck = validateParent(albums, null, body && body.parentId, nameCheck.name);
  if (!parentCheck.ok) return jsonResponse({ error: parentCheck.error }, { status: 400 });

  const now = Date.now();
  const album = await putAlbum(env, {
    id: requestedId || newAlbumId(),
    name: nameCheck.name,
    parentId: parentCheck.parentId,
    createdAt: now,
    updatedAt: now,
  });

  return jsonResponse({ album, created: true }, { status: 201 });
}
