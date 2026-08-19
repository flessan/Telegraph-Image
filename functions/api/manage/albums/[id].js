import { jsonResponse } from '../../../utils/http.js';
import {
  deleteAlbum,
  indexAlbums,
  listAlbums,
  pathOf,
  putAlbum,
  reparentChildren,
  validateAlbumName,
  validateParent,
} from '../../../utils/albums.js';

/**
 * /api/manage/albums/:id
 *
 *   GET    → { album, path, children }
 *   PATCH  → rename and/or move. Body: { name?, parentId? }
 *   DELETE → remove the album record only.
 *
 * DELETE is explicitly non-destructive for objects: contained objects keep
 * their id, public URL, storage location and moderation state, and simply
 * resolve back to the root. Direct child albums are lifted to the deleted
 * album's parent so no subtree is orphaned. There is deliberately no
 * "delete objects too" mode in this API; object deletion stays in
 * /api/manage/delete/:id where it is already explicit.
 */
export async function onRequest(context) {
  const { request, env, params } = context;
  const id = params.id;

  const { albums } = await listAlbums(env);
  const index = indexAlbums(albums);
  const album = index.get(id);
  if (!album) return jsonResponse({ error: 'album_not_found' }, { status: 404 });

  if (request.method === 'GET') {
    return jsonResponse({
      album,
      path: pathOf(index, id),
      children: albums.filter((a) => a.parentId === id),
    });
  }

  if (request.method === 'PATCH' || request.method === 'PUT') {
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return jsonResponse({ error: 'invalid_body' }, { status: 400 });
    }

    let name = album.name;
    if (body && body.name !== undefined) {
      const check = validateAlbumName(body.name);
      if (!check.ok) return jsonResponse({ error: check.error }, { status: 400 });
      name = check.name;
    }

    let parentId = album.parentId;
    if (body && body.parentId !== undefined) {
      const check = validateParent(albums, id, body.parentId, name);
      if (!check.ok) return jsonResponse({ error: check.error }, { status: 400 });
      parentId = check.parentId;
    } else if (name !== album.name) {
      const check = validateParent(albums, id, album.parentId, name);
      if (!check.ok) return jsonResponse({ error: check.error }, { status: 400 });
    }

    const updated = await putAlbum(env, {
      ...album,
      name,
      parentId,
      updatedAt: Date.now(),
    });
    // Renaming or moving never rewrites children or object memberships: they
    // reference the stable album id, not its name or path.
    return jsonResponse({ album: updated });
  }

  if (request.method === 'DELETE') {
    const moved = await reparentChildren(env, albums, id, album.parentId);
    await deleteAlbum(env, id);
    return jsonResponse({
      deleted: id,
      objectsDeleted: false,
      reparented: moved.map((a) => a.id),
    });
  }

  return jsonResponse({ error: 'method_not_allowed' }, { status: 405 });
}
