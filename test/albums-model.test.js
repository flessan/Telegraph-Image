const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/**
 * The shared frontend album model (js/albums.js) is what both the public
 * workspace and the console use to build trees, validate destinations and
 * count objects. These tests pin the rules that keep the hierarchy sane.
 */
describe('shared album model (js/albums.js)', function () {
  let A;

  before(async function () {
    A = await import('../js/albums.js');
  });

  const tree = () => [
    { id: 'alb_p', name: 'Projects', parentId: null, createdAt: 1, updatedAt: 1, synced: true },
    { id: 'alb_w', name: 'Website', parentId: 'alb_p', createdAt: 2, updatedAt: 2, synced: true },
    { id: 'alb_s', name: 'Screenshots', parentId: 'alb_w', createdAt: 3, updatedAt: 3, synced: false },
    { id: 'alb_a', name: 'Archive', parentId: null, createdAt: 4, updatedAt: 4, synced: true },
  ];

  it('creates albums with stable ids and normalized names', function () {
    const album = A.createAlbum('  Holiday   Photos ', null);
    assert.strictEqual(album.name, 'Holiday Photos');
    assert.strictEqual(album.parentId, null);
    assert.strictEqual(album.synced, false);
    assert.ok(/^alb_[0-9a-f]{24}$/.test(album.id));
    assert.strictEqual(A.createAlbum('X', 'root').parentId, null);
  });

  it('validates names the same way the backend does', function () {
    assert.strictEqual(A.validateName('').error, 'name_required');
    assert.strictEqual(A.validateName('a'.repeat(65)).error, 'name_too_long');
    assert.strictEqual(A.validateName('a/b').error, 'name_invalid');
    assert.strictEqual(A.validateName(' Ok ').name, 'Ok');
  });

  it('builds a breadcrumb path and a display label', function () {
    const index = A.indexAlbums(tree());
    assert.deepStrictEqual(A.pathOf(index, 'alb_s').map((a) => a.name), ['Projects', 'Website', 'Screenshots']);
    assert.strictEqual(A.pathLabel(index, 'alb_s'), 'Projects / Website / Screenshots');
    assert.strictEqual(A.pathLabel(index, 'alb_s', { rootLabel: 'Storage' }), 'Storage / Projects / Website / Screenshots');
    assert.strictEqual(A.pathLabel(index, null, { rootLabel: 'Storage' }), 'Storage');
  });

  it('flattens the tree with collapsed branches skipped', function () {
    const rows = A.flattenTree(tree(), { expanded: new Set(['alb_p']) });
    assert.deepStrictEqual(rows.map((r) => [r.album.name, r.depth]), [
      ['Archive', 0], ['Projects', 0], ['Website', 1],
    ]);
    const all = A.flattenTree(tree());
    assert.strictEqual(all.length, 4, 'no expanded set means fully expanded');
    assert.strictEqual(all[0].hasChildren, false);
  });

  it('reports ancestors so a tree can auto-expand to the open album', function () {
    const index = A.indexAlbums(tree());
    assert.deepStrictEqual(A.ancestorIds(index, 'alb_s'), ['alb_p', 'alb_w']);
    assert.deepStrictEqual(A.ancestorIds(index, 'alb_p'), []);
  });

  it('refuses cycles, self-parenting, unknown parents and duplicate siblings', function () {
    const albums = tree();
    assert.strictEqual(A.canMove(albums, 'alb_p', 'alb_p').error, 'self_parent');
    assert.strictEqual(A.canMove(albums, 'alb_p', 'alb_s').error, 'cycle');
    assert.strictEqual(A.canMove(albums, 'alb_w', 'alb_nope').error, 'parent_not_found');
    assert.strictEqual(A.canMove(albums, null, null, 'Archive').error, 'duplicate_name');
    assert.strictEqual(A.canMove(albums, 'alb_w', 'alb_a').ok, true);
    assert.strictEqual(A.canMove(albums, 'alb_w', null).ok, true);
  });

  it('keeps nesting within the practical depth limit', function () {
    const deep = [];
    let parent = null;
    for (let i = 0; i < A.MAX_DEPTH; i++) {
      deep.push({ id: 'alb_' + i, name: 'L' + i, parentId: parent });
      parent = 'alb_' + i;
    }
    assert.strictEqual(A.canMove(deep, null, parent, 'More').error, 'too_deep');
    assert.strictEqual(A.canMove(deep, null, 'alb_0', 'More').ok, true);
  });

  it('renaming does not change ids, so children and members stay attached', function () {
    const albums = tree();
    const renamed = albums.map((a) => (a.id === 'alb_w' ? { ...a, name: 'Marketing site' } : a));
    const index = A.indexAlbums(renamed);
    assert.deepStrictEqual(A.pathOf(index, 'alb_s').map((a) => a.id), ['alb_p', 'alb_w', 'alb_s']);
    assert.strictEqual(A.pathLabel(index, 'alb_s'), 'Projects / Marketing site / Screenshots');
  });

  it('collects a subtree for scoped counting', function () {
    assert.deepStrictEqual(Array.from(A.subtreeIds(tree(), 'alb_p')).sort(), ['alb_p', 'alb_s', 'alb_w']);
    assert.deepStrictEqual(Array.from(A.subtreeIds(tree(), 'alb_a')), ['alb_a']);
  });

  it('counts only the objects present in the local catalog', function () {
    const albums = tree();
    const items = [
      { id: '1', albumId: 'alb_w' },
      { id: '2', albumId: 'alb_s' },
      { id: '3', albumId: null },
      { id: '4', albumId: 'alb_a' },
    ];
    assert.strictEqual(A.countObjects(items, 'alb_w'), 1);
    assert.strictEqual(A.countObjects(items, 'alb_w', { albums, recursive: true }), 2);
    assert.strictEqual(A.countObjects(items, null), 1, 'root holds unfiled objects');
  });

  it('lists objects in an album and treats deleted albums as the root', function () {
    const index = A.indexAlbums(tree());
    const items = [
      { id: '1', albumId: 'alb_w' },
      { id: '2', albumId: 'alb_deleted' },
      { id: '3', albumId: null },
    ];
    assert.deepStrictEqual(A.objectsIn(items, 'alb_w', { index }).map((i) => i.id), ['1']);
    assert.deepStrictEqual(A.objectsIn(items, null, { index }).map((i) => i.id), ['2', '3']);
    assert.strictEqual(A.resolveAlbumId(index, 'alb_deleted'), null);
  });

  it('sorts siblings by display name for the current locale', function () {
    const albums = [
      { id: 'a', name: 'zeta', parentId: null },
      { id: 'b', name: 'Alpha', parentId: null },
      { id: 'c', name: 'beta 10', parentId: null },
      { id: 'd', name: 'beta 2', parentId: null },
    ];
    assert.deepStrictEqual(A.childrenOf(albums, null, 'en').map((a) => a.name), ['Alpha', 'beta 2', 'beta 10', 'zeta']);
  });

  it('serializes without runtime state and merges remote definitions', function () {
    const local = [
      A.createAlbum('Draft', null),
      { id: 'alb_w', name: 'Website (local edit)', parentId: null, updatedAt: 5000, synced: false },
    ];
    const remote = [{ id: 'alb_w', name: 'Website', parentId: 'alb_p', updatedAt: 1000 }];
    const merged = A.mergeRemoteAlbums(local, remote);
    const website = merged.find((a) => a.id === 'alb_w');
    assert.strictEqual(website.name, 'Website (local edit)', 'newer unsynced local edits survive a refresh');
    assert.strictEqual(merged.length, 2, 'stable ids prevent duplicate records after a retry');

    const older = A.mergeRemoteAlbums(
      [{ id: 'alb_w', name: 'Old', parentId: null, updatedAt: 10, synced: false }],
      [{ id: 'alb_w', name: 'Website', parentId: null, updatedAt: 99 }],
    );
    assert.strictEqual(older[0].name, 'Website');
    assert.strictEqual(older[0].synced, true);

    const snapshot = A.serializeAlbum(A.createAlbum('X', null));
    assert.deepStrictEqual(Object.keys(snapshot).sort(), ['createdAt', 'id', 'name', 'parentId', 'synced', 'updatedAt']);
  });

  it('mirrors the backend rules it shares invariants with', async function () {
    const B = await import('../functions/utils/albums.js');
    assert.strictEqual(A.MAX_DEPTH, B.MAX_ALBUM_DEPTH);
    assert.strictEqual(A.MAX_NAME, B.MAX_ALBUM_NAME);
    assert.strictEqual(A.ROOT_ID, B.ROOT_ALBUM_ID);
    const albums = tree();
    for (const [id, parent] of [['alb_p', 'alb_s'], ['alb_p', 'alb_p'], ['alb_w', 'alb_missing']]) {
      assert.strictEqual(
        A.canMove(albums, id, parent).error,
        B.validateParent(albums, id, parent).error,
        `${id} -> ${parent}`,
      );
    }
  });
});

describe('album localization', function () {
  const source = read('js/i18n.js');

  function tableKeys(lang) {
    // The dictionary is a plain object literal per language; read the key names
    // between `  <lang>: {` and its closing brace.
    const start = source.indexOf(`\n  ${lang}: {`);
    assert.ok(start > -1, `missing ${lang} table`);
    const end = source.indexOf('\n  },', start);
    const body = source.slice(start, end);
    return body.match(/^\s{4}([A-Za-z0-9_]+):/gm).map((m) => m.trim().replace(':', ''));
  }

  const en = tableKeys('en');
  const id = tableKeys('id');

  it('has English/Indonesian parity for every key', function () {
    const missingId = en.filter((k) => !id.includes(k));
    const missingEn = id.filter((k) => !en.includes(k));
    assert.deepStrictEqual(missingId, [], 'keys missing from the Indonesian table');
    assert.deepStrictEqual(missingEn, [], 'keys missing from the English table');
  });

  it('defines every album string in both languages', function () {
    const required = [
      'navAlbums', 'newAlbum', 'renameAlbum', 'deleteAlbum', 'moveToAlbum', 'moveHere',
      'createInside', 'albumRoot', 'moveToParent', 'emptyAlbumTitle', 'objectsInAlbum',
      'albumPathLabel', 'albumUnsynced', 'dropMoveHere', 'dropReparent', 'dropInvalidSelf',
      'albumErrorCycle', 'albumErrorDuplicate', 'albumErrorDepth', 'deleteAlbumTitle',
      'deleteAlbumBody', 'albumCreated', 'albumMoved', 'commandNewAlbum', 'commandMoveToAlbum',
      'commandGoRoot', 'albumTreeAria', 'albumPickerAria', 'openAlbumAria', 'albumMenuAria',
      'albumSyncUnauthenticated', 'metaAlbum', 'albumUnfiled', 'albumCountRemote', 'albumUnsyncedCount',
    ];
    for (const key of required) {
      assert.ok(en.includes(key), `English is missing ${key}`);
      assert.ok(id.includes(key), `Indonesian is missing ${key}`);
    }
  });

  it('does not leave placeholder or untranslated album copy in the Indonesian table', function () {
    const start = source.indexOf('\n  id: {');
    const body = source.slice(start, source.indexOf('\n  },', start));
    const albumLines = body.split('\n').filter((line) => /^\s{4}(album|nav|move|drop|create|delete|command)/i.test(line));
    assert.ok(albumLines.length > 20, 'expected a substantial Indonesian album section');
    for (const line of albumLines) {
      assert.ok(!/TODO|FIXME/i.test(line), `placeholder left in: ${line.trim()}`);
    }
    // Indonesian copy must not be a verbatim copy of the English sentence.
    assert.ok(body.includes('Hanya albumnya yang dihapus'), 'delete semantics must be explained in Indonesian');
  });

  it('keeps the same interpolation placeholders in both languages', function () {
    const grab = (lang) => {
      const start = source.indexOf(`\n  ${lang}: {`);
      const body = source.slice(start, source.indexOf('\n  },', start));
      const map = new Map();
      for (const line of body.split('\n')) {
        const m = line.match(/^\s{4}([A-Za-z0-9_]+):\s*'(.*)',?\s*$/);
        if (!m) continue;
        map.set(m[1], (m[2].match(/\{\w+\}/g) || []).sort().join(','));
      }
      return map;
    };
    const enMap = grab('en');
    const idMap = grab('id');
    for (const [key, vars] of enMap) {
      if (!idMap.has(key)) continue;
      assert.strictEqual(idMap.get(key), vars, `placeholders differ for ${key}`);
    }
  });
});
