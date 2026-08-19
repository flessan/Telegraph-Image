const assert = require('assert');
const { boot, teardown, click, fire, tick } = require('./dom-harness');

/**
 * Remote Storage Console album tests. The console always shows remote state:
 * album records come from the album API and memberships from the object
 * metadata already loaded, so counts describe the loaded page only.
 */
describe('console albums (DOM)', function () {
  this.timeout(10000);

  let ctx;
  let albums;
  let objects;

  function albumRecord(id, name, parentId = null) {
    return { id, name, parentId, createdAt: 1, updatedAt: 1 };
  }
  function objectRecord(name, extra = {}) {
    return {
      name,
      metadata: {
        TimeStamp: 1710000000000, ListType: 'None', Label: 'None', liked: false,
        fileName: name, fileSize: 1024, ...extra,
      },
    };
  }

  function routes() {
    return {
      '/api/manage/session': () => ({ body: { authenticated: true, authEnabled: true, user: 'admin' } }),
      '/api/manage/albums/assign': ({ init }) => {
        const body = JSON.parse(init.body);
        for (const id of body.ids) {
          const obj = objects.find((o) => o.name === id);
          if (obj) {
            if (body.albumId) obj.metadata.albumId = body.albumId;
            else delete obj.metadata.albumId;
          }
        }
        return { body: { albumId: body.albumId, updated: body.ids, missing: [] } };
      },
      '/api/manage/albums/': ({ url, init }) => {
        const id = decodeURIComponent(url.split('/api/manage/albums/')[1].split('?')[0]);
        const album = albums.find((a) => a.id === id);
        if (!album) return { status: 404, body: { error: 'album_not_found' } };
        if ((init.method || 'GET').toUpperCase() === 'DELETE') {
          albums = albums.filter((a) => a.id !== id).map((a) => (a.parentId === id ? { ...a, parentId: album.parentId } : a));
          return { body: { deleted: id, objectsDeleted: false, reparented: [] } };
        }
        const patch = JSON.parse(init.body || '{}');
        Object.assign(album, patch);
        return { body: { album } };
      },
      '/api/manage/albums': ({ init }) => {
        if ((init.method || 'GET').toUpperCase() === 'POST') {
          const body = JSON.parse(init.body);
          const album = albumRecord(body.id || 'alb_new' + (albums.length + 1), body.name, body.parentId || null);
          albums.push(album);
          return { status: 201, body: { album, created: true } };
        }
        return { body: { albums, list_complete: true } };
      },
      '/api/manage/list': () => ({ body: { keys: objects, list_complete: true } }),
    };
  }

  async function start(options = {}) {
    ctx = await boot({ page: 'admin.html', module: 'js/admin.js', routes: routes(), ...options });
    await tick(60);
    return ctx;
  }

  function crumbText() {
    // Separators are their own nodes, so normalize spacing before matching.
    return Array.from(ctx.doc.querySelector('.album-crumbs').childNodes)
      .map((n) => n.textContent.trim())
      .filter(Boolean)
      .join(' ');
  }

  async function openAlbums() {
    click(ctx.doc.querySelector('.nav-item[data-view="albums"]'));
    await tick(40);
  }

  beforeEach(function () {
    albums = [
      albumRecord('alb_projects', 'Projects'),
      albumRecord('alb_website', 'Website', 'alb_projects'),
      albumRecord('alb_archive', 'Archive'),
    ];
    objects = [
      objectRecord('r2-one.png', { albumId: 'alb_website' }),
      objectRecord('r2-two.png', { albumId: 'alb_projects', ListType: 'White' }),
      objectRecord('r2-three.png'),
    ];
  });

  afterEach(function () {
    teardown();
    ctx = null;
  });

  it('loads the remote album tree into the console navigation', async function () {
    await start();
    assert.deepStrictEqual(ctx.errors, []);
    const names = ctx.all('#album-tree .album-row-name').map((el) => el.textContent);
    assert.deepStrictEqual(names, ['Archive', 'Projects'], 'collapsed roots first');
    assert.strictEqual(ctx.$('count-albums').textContent, '3');
    assert.ok(ctx.calls.some((c) => c.url.includes('/api/manage/albums') && c.method === 'GET'));
  });

  it('scopes the object browser to the open album and shows a breadcrumb', async function () {
    await start();
    await openAlbums();
    assert.match(ctx.doc.querySelector('.album-crumbs').textContent, /Root/);
    // Root shows unfiled objects only.
    assert.deepStrictEqual(ctx.all('#browser .obj-name').map((e) => e.textContent), ['r2-three.png']);
    assert.deepStrictEqual(ctx.all('.album-card-name').map((e) => e.textContent), ['Archive', 'Projects']);

    const projects = ctx.all('.album-card').find((c) => c.textContent.includes('Projects'));
    click(projects);
    await tick(40);
    assert.deepStrictEqual(ctx.all('#browser .obj-name').map((e) => e.textContent), ['r2-two.png']);
    assert.match(crumbText(), /Root \/ Projects/);

    // Nested album is reachable and the breadcrumb keeps growing.
    click(ctx.doc.querySelector('.album-card'));
    await tick(40);
    assert.match(crumbText(), /Root \/ Projects \/ Website/);
    assert.deepStrictEqual(ctx.all('#browser .obj-name').map((e) => e.textContent), ['r2-one.png']);
  });

  it('is honest that counts come from the loaded page of the index', async function () {
    await start();
    await openAlbums();
    assert.match(ctx.doc.querySelector('.filter-note').textContent, /objects loaded so far/i);
    const projectsCard = ctx.all('.album-card').find((c) => c.textContent.includes('Projects'));
    assert.match(projectsCard.textContent, /2 in the loaded index/);
  });

  it('creates a remote album inside the open album', async function () {
    await start();
    await openAlbums();
    const projects = ctx.all('.album-card').find((c) => c.textContent.includes('Projects'));
    click(projects);
    await tick(40);
    click(ctx.doc.querySelector('#album-create'));
    await tick(30);
    ctx.doc.querySelector('#album-name-input').value = 'Screenshots';
    click(ctx.all('#dialog-actions .btn').pop());
    await tick(50);

    const post = ctx.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/manage/albums')).pop();
    assert.strictEqual(post.body.name, 'Screenshots');
    assert.strictEqual(post.body.parentId, 'alb_projects');
    assert.ok(ctx.all('.album-card-name').some((e) => e.textContent === 'Screenshots'));
  });

  it('moves an object to another album without touching its identity', async function () {
    await start();
    await openAlbums();
    const projects = ctx.all('.album-card').find((c) => c.textContent.includes('Projects'));
    click(projects);
    await tick(40);

    click(ctx.doc.querySelector('[data-menu]'));
    await tick(20);
    const moveItem = ctx.all('.menu button').find((b) => b.textContent.includes('Move to album'));
    assert.ok(moveItem, 'the object menu offers Move to album');
    click(moveItem);
    await tick(30);
    const archive = ctx.all('.album-picker-row').find((r) => r.textContent.includes('Archive'));
    click(archive);
    await tick();
    click(ctx.all('#dialog-actions .btn').pop());
    await tick(50);

    const assign = ctx.calls.filter((c) => c.url.includes('/albums/assign')).pop();
    assert.deepStrictEqual(assign.body, { albumId: 'alb_archive', ids: ['r2-two.png'] });
    const moved = objects.find((o) => o.name === 'r2-two.png');
    assert.strictEqual(moved.metadata.ListType, 'White', 'moderation is untouched by an album move');
    assert.strictEqual(moved.metadata.fileName, 'r2-two.png', 'the object identity is untouched');
  });

  it('moves objects by dragging them onto an album card', async function () {
    await start();
    await openAlbums();
    const card = ctx.doc.querySelector('#browser [data-id]');
    const archive = ctx.all('.album-card').find((c) => c.textContent.includes('Archive'));
    fire(card, 'dragstart', { dataTransfer: ctx.dataTransfer() });
    const over = fire(archive, 'dragover', { dataTransfer: ctx.dataTransfer() });
    assert.ok(over.defaultPrevented);
    assert.ok(archive.classList.contains('drop-target'));
    assert.match(ctx.$('drag-hint').textContent, /Move to Archive/);
    fire(archive, 'drop', { dataTransfer: ctx.dataTransfer() });
    await tick(60);
    const assign = ctx.calls.filter((c) => c.url.includes('/albums/assign')).pop();
    assert.strictEqual(assign.body.albumId, 'alb_archive');
    assert.strictEqual(objects.find((o) => o.name === 'r2-three.png').metadata.albumId, 'alb_archive');
  });

  it('refuses to re-parent an album into its own descendant', async function () {
    await start();
    await openAlbums();
    const rows = ctx.all('#album-tree .album-row');
    const projects = rows.find((r) => r.textContent.includes('Projects'));
    fire(projects, 'keydown', { key: 'ArrowRight' }); // expand
    await tick(20);
    const website = ctx.all('#album-tree .album-row').find((r) => r.textContent.includes('Website'));
    fire(projects, 'dragstart', { dataTransfer: ctx.dataTransfer() });
    fire(website, 'dragover', { dataTransfer: ctx.dataTransfer() });
    assert.ok(website.classList.contains('drop-invalid'));
    fire(website, 'drop', { dataTransfer: ctx.dataTransfer() });
    await tick(30);
    assert.ok(!ctx.calls.some((c) => c.method === 'PATCH'), 'no request is sent for an invalid move');
    assert.strictEqual(albums.find((a) => a.id === 'alb_projects').parentId, null);
  });

  it('renames an album remotely and keeps children attached', async function () {
    await start();
    await openAlbums();
    const projects = ctx.all('.album-card').find((c) => c.textContent.includes('Projects'));
    click(projects);
    await tick(40);
    click(ctx.doc.querySelector('#album-rename'));
    await tick(30);
    ctx.doc.querySelector('#album-name-input').value = 'Client work';
    click(ctx.all('#dialog-actions .btn').pop());
    await tick(50);

    const patch = ctx.calls.filter((c) => c.method === 'PATCH').pop();
    assert.deepStrictEqual(patch.body, { name: 'Client work' });
    assert.strictEqual(albums.find((a) => a.id === 'alb_website').parentId, 'alb_projects');
    assert.match(ctx.doc.querySelector('.album-crumbs').textContent, /Client work/);
  });

  it('deletes an album without deleting its objects', async function () {
    await start();
    await openAlbums();
    const archive = ctx.all('.album-card').find((c) => c.textContent.includes('Archive'));
    click(archive.querySelector('[data-album-menu]'));
    await tick(20);
    click(ctx.all('.menu button').find((b) => b.textContent.includes('Delete album')));
    await tick(30);
    assert.match(ctx.$('dialog-body').textContent, /Only the album is removed/);
    click(ctx.all('#dialog-actions .btn').pop());
    await tick(60);

    assert.ok(ctx.calls.some((c) => c.method === 'DELETE' && c.url.includes('alb_archive')));
    assert.ok(!ctx.calls.some((c) => c.url.includes('/api/manage/delete/')), 'no object delete is issued');
    assert.strictEqual(objects.length, 3, 'objects are untouched');
    assert.ok(!ctx.all('.album-card-name').some((e) => e.textContent === 'Archive'));
  });

  it('shows the album path in the object detail sheet', async function () {
    await start();
    await openAlbums();
    const projects = ctx.all('.album-card').find((c) => c.textContent.includes('Projects'));
    click(projects);
    await tick(40);
    click(ctx.doc.querySelector('#browser [data-open]'));
    await tick(40);
    const detail = ctx.$('detail-body').textContent.replace(/\s+/g, ' ');
    assert.match(detail, /AlbumRoot \/ Projects/);
    assert.ok(ctx.$('detail-actions').textContent.includes('Move to album'));
  });

  it('keeps moderation independent from album placement', async function () {
    await start();
    await openAlbums();
    click(ctx.doc.querySelector('.nav-item[data-view="whitelist"]'));
    await tick(40);
    // The whitelisted object lives in an album and is still listed here.
    assert.deepStrictEqual(ctx.all('.obj-name').map((e) => e.textContent), ['r2-two.png']);
  });

  it('renders the same hierarchy in Bahasa Indonesia', async function () {
    await start({ language: 'id' });
    await openAlbums();
    assert.match(ctx.doc.querySelector('.page-head').textContent, /Album/);
    assert.deepStrictEqual(ctx.all('.album-card-name').map((e) => e.textContent), ['Archive', 'Projects']);
    assert.match(ctx.doc.querySelector('.album-crumbs').textContent, /Akar/);
    assert.match(ctx.doc.querySelector('.filter-note').textContent, /objek yang sudah dimuat/i);
  });
});

/**
 * The console must present remote objects as what they are. The upload
 * endpoint stores no MIME field, so remotely the filename is the only signal
 * available — which is exactly the documented extension fallback.
 */
describe('console MIME-aware output (DOM)', function () {
  this.timeout(10000);

  let ctx;
  const objects = [
    { name: 'r2-photo.png', metadata: { fileName: 'photo.png', fileSize: 10, TimeStamp: 1, ListType: 'None', Label: 'None', liked: false } },
    { name: 'r2-song.mp3', metadata: { fileName: 'song.mp3', fileSize: 20, TimeStamp: 2, ListType: 'None', Label: 'None', liked: false } },
    { name: 'r2-clip.mp4', metadata: { fileName: 'clip.mp4', fileSize: 30, TimeStamp: 3, ListType: 'None', Label: 'None', liked: false } },
    { name: 'r2-manual.pdf', metadata: { fileName: 'manual.pdf', fileSize: 40, TimeStamp: 4, ListType: 'None', Label: 'None', liked: false } },
    { name: 'r2-bundle.zip', metadata: { fileName: 'pack[v2].zip', fileSize: 50, TimeStamp: 5, ListType: 'None', Label: 'None', liked: false } },
  ];

  async function start(language = 'en') {
    ctx = await boot({
      page: 'admin.html',
      module: 'js/admin.js',
      language,
      routes: {
        '/api/manage/session': () => ({ body: { authenticated: true, authEnabled: true } }),
        '/api/manage/albums': () => ({ body: { albums: [], list_complete: true } }),
        '/api/manage/list': () => ({ body: { keys: objects, list_complete: true } }),
      },
    });
    await tick(80);
    click(ctx.doc.querySelector('.nav-item[data-view="all"]'));
    await tick(40);
    return ctx;
  }

  async function copyVia(name, label) {
    const row = ctx.all('[data-menu]').find((b) => b.getAttribute('aria-label').includes(name));
    click(row);
    await tick(20);
    const item = ctx.all('.menu button').find((b) => b.textContent.includes(label));
    click(item);
    await tick(30);
    return ctx.copied();
  }

  afterEach(function () {
    teardown();
    ctx = null;
  });

  it('builds HTML snippets from the object category, not from "everything is an image"', async function () {
    await start();
    assert.match(await copyVia('photo.png', 'Copy HTML'), /^<img src="[^"]+\/file\/r2-photo\.png" alt="photo\.png" loading="lazy">$/);
    assert.match(await copyVia('song.mp3', 'Copy HTML'), /^<audio controls preload="metadata" src="[^"]+">song\.mp3<\/audio>$/);
    assert.match(await copyVia('clip.mp4', 'Copy HTML'), /^<video controls preload="metadata" src="[^"]+">clip\.mp4<\/video>$/);
    assert.match(await copyVia('manual.pdf', 'Copy HTML'), /^<iframe src="[^"]+" title="manual\.pdf"/);
    assert.match(await copyVia('pack[v2].zip', 'Copy HTML'), /^<a href="[^"]+" download>pack\[v2\]\.zip<\/a>$/);
  });

  it('never emits Markdown image syntax or [img] for a non-image', async function () {
    await start();
    assert.ok((await copyVia('photo.png', 'Copy Markdown')).startsWith('!['));
    for (const name of ['song.mp3', 'clip.mp4', 'manual.pdf', 'pack[v2].zip']) {
      const md = await copyVia(name, 'Copy Markdown');
      assert.ok(!md.startsWith('!['), `${name} → ${md}`);
      const bb = await copyVia(name, 'Copy BBCode');
      assert.ok(!bb.includes('[img]'), `${name} → ${bb}`);
      assert.ok(bb.startsWith('[url='), bb);
    }
    assert.ok((await copyVia('photo.png', 'Copy BBCode')).startsWith('[img]'));
  });

  it('escapes bracket characters in BBCode labels', async function () {
    await start();
    const bb = await copyVia('pack[v2].zip', 'Copy BBCode');
    assert.ok(bb.includes('pack&#91;v2&#93;.zip'), bb);
  });

  it('keeps the direct URL action byte-identical to the public URL', async function () {
    await start();
    const url = await copyVia('song.mp3', 'Copy URL');
    assert.strictEqual(url, 'http://localhost:8788/file/r2-song.mp3');
  });

  it('renders a matching preview surface in the detail sheet', async function () {
    await start();
    const open = async (name) => {
      const target = ctx.all('[data-open]').find((el) => el.getAttribute('aria-label').includes(name));
      click(target);
      await tick(40);
      return ctx.$('detail-body').querySelector('.detail-preview');
    };
    assert.ok((await open('photo.png')).querySelector('img'));
    assert.ok((await open('song.mp3')).querySelector('audio[controls]'));
    assert.ok((await open('clip.mp4')).querySelector('video[controls]'));
    const pdf = await open('manual.pdf');
    assert.ok(pdf.querySelector('iframe'), 'pdf → embedded viewer');
    assert.strictEqual(pdf.querySelector('img'), null);
    const zip = await open('pack[v2].zip');
    assert.strictEqual(zip.querySelector('img'), null, 'an archive is never rendered as an image');
    assert.match(zip.textContent, /Archive/);
  });

  it('labels categories precisely in both languages', async function () {
    await start();
    assert.match(ctx.$('main').textContent, /PDF document/);
    assert.match(ctx.$('main').textContent, /Archive/);
    teardown();
    await start('id');
    assert.match(ctx.$('main').textContent, /Dokumen PDF/);
    assert.match(ctx.$('main').textContent, /Arsip/);
  });
});
