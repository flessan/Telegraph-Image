const assert = require('assert');

/**
 * MIME categorization and the generated output snippets. The rule under test
 * everywhere: an object is treated as what it actually is, and every value
 * interpolated into a snippet is escaped for that snippet's syntax.
 */
describe('mime awareness', function () {
  let M;

  before(async function () {
    M = await import('../js/mime.js');
  });

  const URL_ = 'https://cdn.example.com/file/r2-abc123.png';

  describe('categorization', function () {
    it('uses the declared MIME type as the authority', function () {
      assert.strictEqual(M.categorize({ mime: 'image/png', name: 'weird.bin' }), 'image');
      assert.strictEqual(M.categorize({ mime: 'audio/mpeg', name: 'song.png' }), 'audio');
      assert.strictEqual(M.categorize({ mime: 'video/mp4', name: 'clip.jpg' }), 'video');
      assert.strictEqual(M.categorize({ mime: 'application/pdf', name: 'doc.png' }), 'pdf');
      assert.strictEqual(M.categorize({ mime: 'text/plain', name: 'notes.zip' }), 'text');
      assert.strictEqual(M.categorize({ mime: 'application/zip', name: 'a.txt' }), 'archive');
      assert.strictEqual(M.categorize({ mime: 'application/vnd.ms-excel', name: 'a.png' }), 'file');
    });

    it('normalizes parameters and casing', function () {
      assert.strictEqual(M.normalizeMime('IMAGE/PNG'), 'image/png');
      assert.strictEqual(M.normalizeMime('text/plain; charset=UTF-8'), 'text/plain');
      assert.strictEqual(M.normalizeMime('  '), '');
      assert.strictEqual(M.categorize({ mime: 'Text/Plain; charset=utf-8', name: 'x' }), 'text');
    });

    it('falls back to the extension only when no usable MIME type exists', function () {
      assert.strictEqual(M.isMimeAuthoritative('image/png'), true);
      assert.strictEqual(M.isMimeAuthoritative('application/octet-stream'), false, 'octet-stream carries no information');
      assert.strictEqual(M.isMimeAuthoritative(undefined), false);

      assert.strictEqual(M.categorize({ name: 'photo.JPG' }), 'image');
      assert.strictEqual(M.categorize({ mime: '', name: 'track.flac' }), 'audio');
      assert.strictEqual(M.categorize({ mime: 'application/octet-stream', name: 'movie.mkv' }), 'video');
      assert.strictEqual(M.categorize({ name: 'manual.pdf' }), 'pdf');
      assert.strictEqual(M.categorize({ name: 'bundle.7z' }), 'archive');
      assert.strictEqual(M.categorize({ name: 'readme.md' }), 'text');
      assert.strictEqual(M.categorize({ name: 'installer.exe' }), 'file');
      assert.strictEqual(M.categorize({ name: 'no-extension' }), 'file');
      assert.strictEqual(M.categorize({}), 'file');
    });

    it('ignores query strings and dotfiles in the extension fallback', function () {
      assert.strictEqual(M.extensionOf('photo.png?v=2'), 'png');
      assert.strictEqual(M.extensionOf('.gitignore'), '');
      assert.strictEqual(M.extensionOf('archive.tar.gz'), 'gz');
      assert.strictEqual(M.extensionOf('trailing.'), '');
    });

    it('maps categories to preview surfaces', function () {
      assert.strictEqual(M.previewKind({ mime: 'image/webp' }), 'image');
      assert.strictEqual(M.previewKind({ mime: 'audio/ogg' }), 'audio');
      assert.strictEqual(M.previewKind({ mime: 'video/webm' }), 'video');
      assert.strictEqual(M.previewKind({ mime: 'application/pdf' }), 'pdf');
      // Text has no sanitized viewer in this product: generic surface.
      assert.strictEqual(M.previewKind({ mime: 'text/plain' }), 'file');
      assert.strictEqual(M.previewKind({ mime: 'application/zip' }), 'file');
      assert.strictEqual(M.previewKind({ mime: 'application/x-msdownload' }), 'file');
      assert.strictEqual(M.previewKind('image'), 'image');
    });

    it('only creates local object URLs for renderable categories', function () {
      assert.strictEqual(M.canPreviewLocally('image'), true);
      assert.strictEqual(M.canPreviewLocally('audio'), true);
      assert.strictEqual(M.canPreviewLocally('video'), true);
      assert.strictEqual(M.canPreviewLocally('pdf'), true);
      assert.strictEqual(M.canPreviewLocally('archive'), false);
      assert.strictEqual(M.canPreviewLocally('file'), false);
    });
  });

  describe('direct URL output', function () {
    it('returns the public URL untouched for every category', function () {
      for (const mime of ['image/png', 'audio/mpeg', 'video/mp4', 'application/pdf', 'application/zip', undefined]) {
        assert.strictEqual(M.formatOutput({ url: URL_, name: 'a b.png', mime }, 'url'), URL_);
      }
    });

    it('returns an empty string when there is no URL yet', function () {
      assert.strictEqual(M.formatOutput({ name: 'staged.png', mime: 'image/png' }, 'html'), '');
      assert.strictEqual(M.formatOutput({ url: '' }, 'url'), '');
    });
  });

  describe('HTML output', function () {
    const html = (mime, name = 'file.bin') => M.formatOutput({ url: URL_, name, mime }, 'html');

    it('uses a semantic element per category', function () {
      assert.strictEqual(html('image/png', 'cat.png'), `<img src="${URL_}" alt="cat.png" loading="lazy">`);
      assert.strictEqual(html('audio/mpeg', 'song.mp3'), `<audio controls preload="metadata" src="${URL_}">song.mp3</audio>`);
      assert.strictEqual(html('video/mp4', 'clip.mp4'), `<video controls preload="metadata" src="${URL_}">clip.mp4</video>`);
      assert.strictEqual(html('application/pdf', 'doc.pdf'),
        `<iframe src="${URL_}" title="doc.pdf" width="100%" height="600" loading="lazy"></iframe>`);
      assert.strictEqual(html('application/zip', 'bundle.zip'), `<a href="${URL_}" download>bundle.zip</a>`);
      assert.strictEqual(html('text/plain', 'notes.txt'), `<a href="${URL_}" download>notes.txt</a>`);
      assert.strictEqual(html(undefined, 'thing.bin'), `<a href="${URL_}" download>thing.bin</a>`);
    });

    it('never emits an <img> for a non-image', function () {
      for (const mime of ['audio/mpeg', 'video/mp4', 'application/pdf', 'text/plain', 'application/zip', 'application/x-msdownload']) {
        assert.ok(!html(mime).includes('<img'), mime);
      }
    });

    it('escapes filenames so a snippet can never inject markup', function () {
      const evil = '"><script>alert(1)</script>.png';
      const out = M.formatOutput({ url: URL_, name: evil, mime: 'image/png' }, 'html');
      assert.ok(!out.includes('<script'), out);
      assert.ok(out.includes('&lt;script&gt;'), out);
      assert.ok(out.startsWith(`<img src="${URL_}" alt="&quot;&gt;`), out);

      const quoted = M.formatOutput({ url: URL_, name: `a'b"c&d<e>.zip`, mime: 'application/zip' }, 'html');
      assert.strictEqual(quoted, `<a href="${URL_}" download>a&#39;b&quot;c&amp;d&lt;e&gt;.zip</a>`);
    });

    it('escapes the URL as an attribute value too', function () {
      const nasty = 'https://x.test/file/a"><img src=x onerror=alert(1)>.png';
      const out = M.formatOutput({ url: nasty, name: 'a.png', mime: 'image/png' }, 'html');
      assert.ok(!/<img[^>]*onerror/.test(out.slice(4)), out);
      assert.ok(out.includes('&quot;&gt;&lt;img'), out);
    });

    it('keeps unicode filenames readable', function () {
      const out = M.formatOutput({ url: URL_, name: 'foto liburan – Bali 🇮🇩.png', mime: 'image/png' }, 'html');
      assert.ok(out.includes('alt="foto liburan – Bali 🇮🇩.png"'), out);
    });
  });

  describe('Markdown output', function () {
    const md = (mime, name) => M.formatOutput({ url: URL_, name, mime }, 'markdown');

    it('uses image syntax for images only', function () {
      assert.strictEqual(md('image/png', 'cat.png'), `![cat\\.png](${URL_})`);
      assert.strictEqual(md('audio/mpeg', 'song.mp3'), `[song\\.mp3](${URL_})`);
      assert.strictEqual(md('video/mp4', 'clip.mp4'), `[clip\\.mp4](${URL_})`);
      assert.strictEqual(md('application/pdf', 'doc.pdf'), `[doc\\.pdf](${URL_})`);
      assert.strictEqual(md('application/zip', 'b.zip'), `[b\\.zip](${URL_})`);
      assert.strictEqual(md(undefined, 'thing.bin'), `[thing\\.bin](${URL_})`);
    });

    it('never emits image syntax for a non-image', function () {
      for (const mime of ['audio/mpeg', 'video/mp4', 'application/pdf', 'text/plain', 'application/zip']) {
        assert.ok(!md(mime, 'x.bin').startsWith('!'), mime);
      }
    });

    it('escapes Markdown-sensitive characters in filenames', function () {
      assert.strictEqual(md('image/png', 'a[b](c).png'), `![a\\[b\\]\\(c\\)\\.png](${URL_})`);
      assert.strictEqual(md('application/zip', 'we*ird_name!.zip'), `[we\\*ird\\_name\\!\\.zip](${URL_})`);
    });

    it('encodes URL characters that would terminate the link', function () {
      const spaced = M.formatOutput({ url: 'https://x.test/file/my file (1).png', name: 'a.png', mime: 'image/png' }, 'markdown');
      assert.ok(!/[()\s]/.test(spaced.slice(spaced.indexOf('](') + 2, -1)), spaced);
      assert.ok(spaced.includes('%20') && spaced.includes('%28'), spaced);
    });
  });

  describe('BBCode output', function () {
    const bb = (mime, name) => M.formatOutput({ url: URL_, name, mime }, 'bbcode');

    it('uses [img] for images and [url] for everything else', function () {
      assert.strictEqual(bb('image/png', 'cat.png'), `[img]${URL_}[/img]`);
      assert.strictEqual(bb('audio/mpeg', 'song.mp3'), `[url=${URL_}]song.mp3[/url]`);
      assert.strictEqual(bb('video/mp4', 'clip.mp4'), `[url=${URL_}]clip.mp4[/url]`);
      assert.strictEqual(bb('application/pdf', 'doc.pdf'), `[url=${URL_}]doc.pdf[/url]`);
      assert.strictEqual(bb(undefined, 'thing.bin'), `[url=${URL_}]thing.bin[/url]`);
    });

    it('does not invent unsupported media tags', function () {
      const out = bb('audio/mpeg', 'song.mp3') + bb('video/mp4', 'clip.mp4');
      assert.ok(!/\[audio|\[video|\[media/.test(out), out);
    });

    it('escapes brackets in labels and URLs so tags cannot be broken', function () {
      assert.strictEqual(bb('application/zip', 'pack[v2].zip'), `[url=${URL_}]pack&#91;v2&#93;.zip[/url]`);
      const bracketUrl = M.formatOutput({ url: 'https://x.test/file/a]b[c.png', name: 'a.png', mime: 'image/png' }, 'bbcode');
      assert.strictEqual(bracketUrl, '[img]https://x.test/file/a%5Db%5Bc.png[/img]');
    });
  });

  describe('consistency between preview and output', function () {
    const cases = [
      { mime: 'image/png', name: 'a.png', preview: 'image', tag: '<img' },
      { mime: 'audio/mpeg', name: 'a.mp3', preview: 'audio', tag: '<audio' },
      { mime: 'video/mp4', name: 'a.mp4', preview: 'video', tag: '<video' },
      { mime: 'application/pdf', name: 'a.pdf', preview: 'pdf', tag: '<iframe' },
      { mime: 'text/plain', name: 'a.txt', preview: 'file', tag: '<a ' },
      { mime: 'application/zip', name: 'a.zip', preview: 'file', tag: '<a ' },
      { mime: 'application/x-thing', name: 'a.thing', preview: 'file', tag: '<a ' },
    ];

    it('renders the same idea in the preview and in the snippet', function () {
      for (const c of cases) {
        assert.strictEqual(M.previewKind(c), c.preview, c.mime);
        const html = M.formatOutput({ url: URL_, name: c.name, mime: c.mime }, 'html');
        assert.ok(html.startsWith(c.tag), `${c.mime} → ${html}`);
      }
    });

    it('exposes a translatable label key per category', function () {
      assert.strictEqual(M.categoryLabelKey('image'), 'typeImage');
      assert.strictEqual(M.categoryLabelKey('audio'), 'typeAudio');
      assert.strictEqual(M.categoryLabelKey('pdf'), 'typePdf');
      assert.strictEqual(M.categoryLabelKey('archive'), 'typeArchive');
      assert.strictEqual(M.categoryLabelKey('nonsense'), 'typeFile');
    });

    it('accepts a precomputed category without re-sniffing', function () {
      const out = M.formatOutput({ url: URL_, name: 'mystery', category: 'audio' }, 'html');
      assert.ok(out.startsWith('<audio'), out);
    });
  });
});
