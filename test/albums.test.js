const assert = require('assert');
const { createMockKV, makeContext } = require('./helpers');

/**
 * Album layer: pure tree model + the narrowly-scoped management API.
 * These tests pin the invariants that keep albums an organizational layer:
 * stable ids, no cycles, non-destructive deletes and untouched object identity.
 */
describe('album model', function () {
  let A;

  before(async function () {
    A = await import('../functions/utils/albums.js');
  });

  const album = (id, name, parentId = null) => ({
    id, name, parentId, createdAt: 1, updatedAt: 1,
  });

  describe('identity', function () {
    it('mints prefixed, url-safe ids that cannot shadow API sub-routes', function () {
      const id = A.newAlbumId();
      assert.ok(/^alb_[0-9a-f]{24}$/.test(id), id);
      assert.ok(A.isValidAlbumId(id));
      assert.ok(!A.isValidAlbumId('assign'));
      assert.ok(!A.isValidAlbumId('root'));
      assert.ok(!A.isValidAlbumId('../etc'));
      assert.notStrictEqual(A.newAlbumId(), A.newAlbumId());
    });

    it('keeps album records out of the object list via the internal key prefix', async function () {
      const { isInternalKey } = await import('../functions/utils/kv-keys.js');
      assert.ok(isInternalKey(A.albumKey(A.newAlbumId())));
      assert.ok(!isInternalKey('cat.png'));
      assert.strictEqual(A.albumIdFromKey('album:alb_1'), 'alb_1');
      assert.strictEqual(A.albumIdFromKey('cat.png'), null);
    });
  });

  describe('names', function () {
    it('trims, collapses whitespace and rejects empty or oversized names', function () {
      assert.strictEqual(A.validateAlbumName('  Website   Assets ').name, 'Website Assets');
      assert.strictEqual(A.validateAlbumName('   ').ok, false);
      assert.strictEqual(A.validateAlbumName('x'.repeat(65)).error, 'name_too_long');
      assert.strictEqual(A.validateAlbumName('a/b').error, 'name_invalid');
      assert.strictEqual(A.validateAlbumName(undefined).error, 'name_required');
    });

    it('accepts non-ASCII display names', function () {
      assert.strictEqual(A.validateAlbumName('Foto Liburan · 2026').name, 'Foto Liburan · 2026');
    });
  });

  describe('tree', function () {
    const albums = [
      album('alb_projects', 'Projects'),
      album('alb_web', 'Website', 'alb_projects'),
      album('alb_shots', 'Screenshots', 'alb_web'),
      album('alb_other', 'Archive'),
    ];

    it('builds a root-to-node path', function () {
      const index = A.indexAlbums(albums);
      assert.deepStrictEqual(
        A.pathOf(index, 'alb_shots').map((a) => a.name),
        ['Projects', 'Website', 'Screenshots'],
      );
      assert.strictEqual(A.depthOf(index, 'alb_shots'), 3);
      assert.strictEqual(A.depthOf(index, 'root'), 0);
    });

    it('lists children of the root and of a node', function () {
      assert.deepStrictEqual(A.childrenOf(albums, null).map((a) => a.id), ['alb_projects', 'alb_other']);
      assert.deepStrictEqual(A.childrenOf(albums, 'alb_web').map((a) => a.id), ['alb_shots']);
      assert.deepStrictEqual(A.childrenOf(albums, 'alb_shots'), []);
    });

    it('detects descendants', function () {
      const index = A.indexAlbums(albums);
      assert.ok(A.isDescendant(index, 'alb_shots', 'alb_projects'));
      assert.ok(A.isDescendant(index, 'alb_web', 'alb_projects'));
      assert.ok(!A.isDescendant(index, 'alb_projects', 'alb_shots'));
      assert.ok(!A.isDescendant(index, 'alb_other', 'alb_projects'));
    });

    it('survives a corrupt cyclic record without hanging', function () {
      const cyclic = A.indexAlbums([album('a', 'A', 'b'), album('b', 'B', 'a')]);
      const path = A.pathOf(cyclic, 'a');
      assert.ok(path.length <= A.MAX_ALBUM_DEPTH + 2);
      assert.strictEqual(A.isDescendant(cyclic, 'a', 'zzz'), false);
    });

    it('rejects invalid destinations', function () {
      assert.strictEqual(A.validateParent(albums, 'alb_projects', 'alb_projects').error, 'self_parent');
      assert.strictEqual(A.validateParent(albums, 'alb_projects', 'alb_shots').error, 'cycle');
      assert.strictEqual(A.validateParent(albums, 'alb_web', 'alb_missing').error, 'parent_not_found');
      assert.strictEqual(A.validateParent(albums, 'alb_web', 'alb_other').ok, true);
      assert.strictEqual(A.validateParent(albums, 'alb_web', null).ok, true);
    });

    it('refuses duplicate sibling names but allows the same name elsewhere', function () {
      assert.strictEqual(A.validateParent(albums, null, null, 'Projects').error, 'duplicate_name');
      assert.strictEqual(A.validateParent(albums, null, null, 'projects').error, 'duplicate_name');
      assert.strictEqual(A.validateParent(albums, null, 'alb_web', 'Projects').ok, true);
      // Renaming an album to its own name is not a clash with itself.
      assert.strictEqual(A.validateParent(albums, 'alb_projects', null, 'Projects').ok, true);
    });

    it('keeps the tree within the practical depth limit', function () {
      const deep = [];
      let parent = null;
      for (let i = 0; i < A.MAX_ALBUM_DEPTH; i++) {
        const id = 'alb_d' + i;
        deep.push(album(id, 'L' + i, parent));
        parent = id;
      }
      assert.strictEqual(A.validateParent(deep, null, parent, 'One more').error, 'too_deep');
      assert.strictEqual(A.validateParent(deep, null, 'alb_d0', 'Fine').ok, true);
      // Moving a subtree accounts for its own height, not just the node.
      assert.strictEqual(A.subtreeHeight(deep, 'alb_d0'), A.MAX_ALBUM_DEPTH);
      assert.strictEqual(A.validateParent(deep, 'alb_d0', 'alb_d' + (A.MAX_ALBUM_DEPTH - 1)).error, 'cycle');
    });

    it('resolves memberships that point at a deleted album back to the root', function () {
      const index = A.indexAlbums(albums);
      assert.strictEqual(A.resolveMembership(index, 'alb_web'), 'alb_web');
      assert.strictEqual(A.resolveMembership(index, 'alb_gone'), null);
      assert.strictEqual(A.resolveMembership(index, 'root'), null);
      assert.strictEqual(A.resolveMembership(index, undefined), null);
    });
  });
});

describe('album management API', function () {
  const objectMeta = {
    TimeStamp: 1710000000000,
    ListType: 'White',
    Label: 'None',
    liked: true,
    fileName: 'cat.png',
    fileSize: 123,
    shortId: 'AbC123',
    provider: 'telegram',
  };

  const post = (url, body) => new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

  async function createAlbum(env, body) {
    const { onRequest } = await import('../functions/api/manage/albums/index.js');
    const res = await onRequest(makeContext({
      env,
      request: post('https://example.com/api/manage/albums', body),
    }));
    return { res, data: await res.json() };
  }

  it('creates an album at the root and lists it back', async function () {
    const img_url = createMockKV({});
    const env = { img_url };
    const { res, data } = await createAlbum(env, { name: ' Projects ' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.album.name, 'Projects');
    assert.strictEqual(data.album.parentId, null);
    assert.ok(data.album.id.startsWith('alb_'));

    const { onRequest } = await import('../functions/api/manage/albums/index.js');
    const listRes = await onRequest(makeContext({
      env,
      request: new Request('https://example.com/api/manage/albums'),
    }));
    const list = await listRes.json();
    assert.strictEqual(list.albums.length, 1);
    assert.strictEqual(list.albums[0].name, 'Projects');
    assert.strictEqual(list.list_complete, true);
  });

  it('creates nested albums and rejects an unknown parent', async function () {
    const img_url = createMockKV({});
    const env = { img_url };
    const { data: root } = await createAlbum(env, { name: 'Projects' });
    const { data: child } = await createAlbum(env, { name: 'Website', parentId: root.album.id });
    assert.strictEqual(child.album.parentId, root.album.id);

    const { res } = await createAlbum(env, { name: 'Ghost', parentId: 'alb_missing' });
    assert.strictEqual(res.status, 400);
  });

  it('is idempotent when the client retries with the same id', async function () {
    const img_url = createMockKV({});
    const env = { img_url };
    const id = 'alb_' + 'a'.repeat(24);
    const first = await createAlbum(env, { id, name: 'Website' });
    const second = await createAlbum(env, { id, name: 'Website' });
    assert.strictEqual(first.data.created, true);
    assert.strictEqual(second.data.created, false);
    assert.strictEqual(second.data.album.id, id);
    const { albums } = await (await import('../functions/utils/albums.js')).listAlbums(env);
    assert.strictEqual(albums.length, 1);
  });

  it('renames an album without touching its children or memberships', async function () {
    const A = await import('../functions/utils/albums.js');
    const detail = await import('../functions/api/manage/albums/[id].js');
    const img_url = createMockKV({
      'album:alb_parent0000000000000000': { kind: 'album', name: 'Projects', parentId: null, createdAt: 1, updatedAt: 1 },
      'album:alb_child00000000000000000': { kind: 'album', name: 'Website', parentId: 'alb_parent0000000000000000', createdAt: 1, updatedAt: 1 },
      'cat.png': { ...objectMeta, albumId: 'alb_child00000000000000000' },
    });
    const env = { img_url };

    const res = await detail.onRequest(makeContext({
      env,
      params: { id: 'alb_parent0000000000000000' },
      request: new Request('https://example.com/x', { method: 'PATCH', body: JSON.stringify({ name: 'Client work' }) }),
    }));
    assert.strictEqual(res.status, 200);
    const { album } = await res.json();
    assert.strictEqual(album.name, 'Client work');
    assert.strictEqual(album.id, 'alb_parent0000000000000000');

    const { albums } = await A.listAlbums(env);
    const child = albums.find((a) => a.id === 'alb_child00000000000000000');
    assert.strictEqual(child.parentId, 'alb_parent0000000000000000', 'the child still references the stable id');
    assert.strictEqual(img_url.snapshot('cat.png').metadata.albumId, 'alb_child00000000000000000');
  });

  it('refuses to move an album into its own descendant', async function () {
    const detail = await import('../functions/api/manage/albums/[id].js');
    const img_url = createMockKV({
      'album:alb_parent0000000000000000': { kind: 'album', name: 'Projects', parentId: null },
      'album:alb_child00000000000000000': { kind: 'album', name: 'Website', parentId: 'alb_parent0000000000000000' },
    });
    const res = await detail.onRequest(makeContext({
      env: { img_url },
      params: { id: 'alb_parent0000000000000000' },
      request: new Request('https://example.com/x', { method: 'PATCH', body: JSON.stringify({ parentId: 'alb_child00000000000000000' }) }),
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).error, 'cycle');
  });

  it('deletes album organization only: objects and their metadata survive', async function () {
    const detail = await import('../functions/api/manage/albums/[id].js');
    const img_url = createMockKV({
      'album:alb_parent0000000000000000': { kind: 'album', name: 'Projects', parentId: null },
      'album:alb_child00000000000000000': { kind: 'album', name: 'Website', parentId: 'alb_parent0000000000000000' },
      'cat.png': { ...objectMeta, albumId: 'alb_parent0000000000000000' },
    });
    const before = img_url.snapshot('cat.png');

    const res = await detail.onRequest(makeContext({
      env: { img_url },
      params: { id: 'alb_parent0000000000000000' },
      request: new Request('https://example.com/x', { method: 'DELETE' }),
    }));
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.objectsDeleted, false);
    assert.deepStrictEqual(data.reparented, ['alb_child00000000000000000']);

    // The object itself is untouched — same key, same public identity.
    assert.deepStrictEqual(img_url.snapshot('cat.png'), before);
    assert.ok(!img_url.operations.delete.includes('cat.png'));
    // The child album was lifted to the deleted album's parent (the root).
    const A = await import('../functions/utils/albums.js');
    const { albums } = await A.listAlbums({ img_url });
    assert.deepStrictEqual(albums.map((a) => [a.id, a.parentId]), [['alb_child00000000000000000', null]]);
    // A membership pointing at the removed album now resolves to the root.
    assert.strictEqual(A.resolveMembership(A.indexAlbums(albums), 'alb_parent0000000000000000'), null);
  });

  it('assigns objects to an album without changing their identity', async function () {
    const { onRequest } = await import('../functions/api/manage/albums/assign.js');
    const img_url = createMockKV({
      'album:alb_child00000000000000000': { kind: 'album', name: 'Website', parentId: null },
      'cat.png': objectMeta,
    });
    const res = await onRequest(makeContext({
      env: { img_url },
      request: post('https://example.com/api/manage/albums/assign', {
        albumId: 'alb_child00000000000000000',
        ids: ['cat.png', 'missing.png'],
      }),
    }));
    const data = await res.json();
    assert.deepStrictEqual(data.updated, ['cat.png']);
    assert.deepStrictEqual(data.missing, ['missing.png']);

    const meta = img_url.snapshot('cat.png').metadata;
    assert.strictEqual(meta.albumId, 'alb_child00000000000000000');
    assert.strictEqual(meta.fileName, 'cat.png');
    assert.strictEqual(meta.shortId, 'AbC123', 'short link (public URL) is preserved');
    assert.strictEqual(meta.ListType, 'White', 'moderation is preserved');
    assert.strictEqual(meta.liked, true);
    assert.strictEqual(meta.fileSize, 123);
    assert.strictEqual(meta.provider, 'telegram');
    assert.strictEqual(meta.TimeStamp, objectMeta.TimeStamp);
  });

  it('clears membership when moving an object back to the root', async function () {
    const { onRequest } = await import('../functions/api/manage/albums/assign.js');
    const img_url = createMockKV({ 'cat.png': { ...objectMeta, albumId: 'alb_x' } });
    const res = await onRequest(makeContext({
      env: { img_url },
      request: post('https://example.com/api/manage/albums/assign', { albumId: null, ids: ['cat.png'] }),
    }));
    assert.strictEqual(res.status, 200);
    assert.ok(!('albumId' in img_url.snapshot('cat.png').metadata));
  });

  it('rejects assignment to a missing album and oversized batches', async function () {
    const { onRequest } = await import('../functions/api/manage/albums/assign.js');
    const img_url = createMockKV({ 'cat.png': objectMeta });
    const bad = await onRequest(makeContext({
      env: { img_url },
      request: post('https://example.com/api/manage/albums/assign', { albumId: 'alb_gone', ids: ['cat.png'] }),
    }));
    assert.strictEqual(bad.status, 404);
    assert.strictEqual(img_url.snapshot('cat.png').metadata.albumId, undefined);

    const huge = await onRequest(makeContext({
      env: { img_url },
      request: post('https://example.com/api/manage/albums/assign', { ids: new Array(500).fill('cat.png') }),
    }));
    assert.strictEqual(huge.status, 400);
  });

  it('keeps album keys hidden from the object list endpoint', async function () {
    const { onRequest } = await import('../functions/api/manage/list.js');
    const img_url = createMockKV({
      'album:alb_child00000000000000000': { kind: 'album', name: 'Website' },
      'cat.png': objectMeta,
    });
    const res = await onRequest(makeContext({
      env: { img_url },
      request: new Request('https://example.com/api/manage/list'),
    }));
    const data = await res.json();
    assert.deepStrictEqual(data.keys.map((k) => k.name), ['cat.png']);
  });
});
