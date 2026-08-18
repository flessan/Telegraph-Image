const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Static guards for the admin console's visual layer. These cover regressions
// that were only visible in a browser (an unsized SVG that covered the
// sidebar, a sidebar bound to the 80px rail width, ad-hoc z-index values) and
// that are cheap to assert against the source.

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const appCss = read('css/app.css');
const adminCss = read('css/admin.css');
const workspaceCss = read('css/workspace.css');
const adminHtml = read('admin.html');
const loginHtml = read('login.html');
const indexHtml = read('index.html');
const adminJs = read('js/admin.js');
const i18nJs = read('js/i18n.js');

describe('admin console visual layer', () => {
  describe('shared design foundation', () => {
    it('defines the brand lockup in the shared layer, not only in workspace.css', () => {
      // admin.html and login.html load app.css but not workspace.css, so the
      // brand mark must be sized here or its viewBox-only SVG fills the page.
      assert.ok(/^\.brand-mark\s*\{/m.test(appCss), 'app.css should define .brand-mark');
      assert.ok(/\.brand-mark svg\s*\{[^}]*width:\s*\d+px/.test(appCss), '.brand-mark svg needs an explicit width');
      assert.ok(/\.brand-mark svg\s*\{[^}]*height:\s*\d+px/.test(appCss), '.brand-mark svg needs an explicit height');
    });

    it('keeps the brand primitives available to every page that renders them', () => {
      for (const [name, html] of [['admin.html', adminHtml], ['login.html', loginHtml]]) {
        if (!html.includes('brand-mark')) continue;
        assert.ok(html.includes('/css/app.css'), `${name} must load the shared foundation`);
      }
      // The public workspace still loads its own layer on top of the shared one.
      assert.ok(indexHtml.includes('/css/app.css'), 'index.html must load app.css');
      assert.ok(indexHtml.includes('/css/workspace.css'), 'index.html must load workspace.css');
    });

    it('makes the hidden attribute win over component display rules', () => {
      // .login-error/.spinner set display:flex/inline-block, which previously
      // defeated `hidden` and left an empty error banner on the login page.
      assert.ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(appCss),
        'app.css needs a global [hidden] guard');
    });

    it('sizes menu glyphs explicitly', () => {
      assert.ok(/\.menu button svg[^{]*\{[^}]*width:\s*20px/.test(appCss),
        'menu icons must be constrained');
    });
  });

  describe('layering', () => {
    it('declares a single ordered stacking scale', () => {
      const tokens = ['--z-app-header', '--z-nav-drawer', '--z-sheet', '--z-dialog', '--z-menu', '--z-palette', '--z-snackbar'];
      for (const token of tokens) {
        assert.ok(appCss.includes(token + ':'), `app.css should define ${token}`);
      }
    });

    it('orders overlays above the application shell', () => {
      const valueOf = (token) => {
        const m = appCss.match(new RegExp(`${token}:\\s*(\\d+)`));
        assert.ok(m, `${token} must have a numeric value`);
        return Number(m[1]);
      };
      const header = valueOf('--z-app-header');
      const drawer = valueOf('--z-nav-drawer');
      const sheet = valueOf('--z-sheet');
      const dialog = valueOf('--z-dialog');
      const menu = valueOf('--z-menu');
      const palette = valueOf('--z-palette');
      const snackbar = valueOf('--z-snackbar');
      assert.ok(header < drawer, 'the drawer must sit above the header');
      assert.ok(drawer < sheet, 'sheets must sit above the drawer');
      assert.ok(sheet < dialog, 'dialogs must sit above sheets');
      assert.ok(dialog < menu, 'menus must sit above dialogs');
      assert.ok(menu < palette, 'the palette must sit above menus');
      assert.ok(palette < snackbar, 'notifications sit on top');
    });

    it('does not scatter arbitrary z-index values through the stylesheets', () => {
      for (const [name, css] of [['app.css', appCss], ['admin.css', adminCss]]) {
        const values = [...css.matchAll(/z-index:\s*(-?\d+)/g)].map(m => Number(m[1]));
        for (const value of values) {
          assert.ok(value <= 3, `${name} should use layering tokens, found raw z-index: ${value}`);
        }
      }
    });
  });

  describe('shell layout', () => {
    it('gives the sidebar a deliberate readable width, not the icon rail width', () => {
      const m = adminCss.match(/--console-sidebar-w:\s*(\d+)px/);
      assert.ok(m, 'admin.css must define --console-sidebar-w');
      const width = Number(m[1]);
      assert.ok(width >= 220 && width <= 250, `sidebar width should be 220-250px, got ${width}px`);
      assert.ok(!/grid-template-columns:\s*var\(--rail-w/.test(adminCss),
        'the console grid must not be sized from the icon rail token');
    });

    it('builds the shell from grid tracks rather than absolute positioning', () => {
      const shell = adminCss.match(/\.console\s*\{[^}]*\}/)[0];
      assert.ok(shell.includes('display: grid'), 'the shell must be a grid');
      assert.ok(shell.includes('grid-template-areas'), 'the shell must name its regions');
      const nav = adminCss.match(/\.console-nav\s*\{[^}]*\}/)[0];
      assert.ok(nav.includes('grid-area: nav'), 'the sidebar must occupy a grid track');
      assert.ok(!/position:\s*(absolute|fixed)/.test(nav),
        'the desktop sidebar must not be positioned out of flow');
    });

    it('constrains main content and keeps a shared page gutter', () => {
      assert.ok(/--console-content-max:/.test(adminCss), 'content needs a max width');
      assert.ok(/--console-gutter:/.test(adminCss), 'pages need a shared gutter token');
      const page = adminCss.match(/^\.page\s*\{[^}]*\}/m)[0];
      assert.ok(page.includes('max-width: var(--console-content-max)'));
      assert.ok(page.includes('margin: 0 auto'));
    });

    it('turns the sidebar into a drawer below the desktop breakpoint', () => {
      assert.ok(/@media \(max-width: 1023\.98px\)/.test(adminCss),
        'a tablet/mobile breakpoint must exist');
      assert.ok(/\.nav-scrim/.test(adminCss), 'the drawer needs its own scrim');
      assert.ok(adminHtml.includes('id="nav-toggle"'), 'a drawer toggle must exist');
      assert.ok(adminHtml.includes('id="nav-close"'), 'the drawer must be closable');
      assert.ok(adminHtml.includes('aria-controls="side-nav"'), 'the toggle must be wired for a11y');
    });

    it('does not shrink navigation typography to make labels fit', () => {
      const navItem = adminCss.match(/^\.nav-item\s*\{[^}]*\}/m)[0];
      assert.ok(navItem.includes('font: var(--type-label-lg)'),
        'nav items should keep the normal label size');
      const label = adminCss.match(/\.nav-item \.nav-label\s*\{[^}]*\}/)[0];
      assert.ok(/overflow-wrap:\s*anywhere/.test(label),
        'long labels must wrap instead of being clipped');
    });
  });

  describe('overview', () => {
    it('renders statistics as flow content inside their own card', () => {
      assert.ok(adminJs.includes('class="stat-card"'));
      assert.ok(adminJs.includes('class="stat-value"'));
      assert.ok(adminJs.includes('class="stat-label"'));
      assert.ok(adminJs.includes('class="stat-hint"'));
      const card = adminCss.match(/^\.stat-card\s*\{[^}]*\}/m)[0];
      assert.ok(!/position:\s*absolute/.test(card), 'stat cards must stay in flow');
      assert.ok(card.includes('display: flex'), 'stat cards should lay out their own children');
      const grid = adminCss.match(/^\.stat-grid\s*\{[^}]*\}/m)[0];
      assert.ok(grid.includes('align-items: stretch'), 'stat cards must share one height');
    });

    it('separates the page heading from the statistics region', () => {
      // The heading and the stat grid are siblings inside .page, which is a
      // flex column with a gap — they cannot overlap.
      const page = adminCss.match(/^\.page\s*\{[^}]*\}/m)[0];
      assert.ok(page.includes('flex-direction: column'));
      assert.ok(/gap:\s*var\(--console-section-gap\)/.test(page));
      assert.ok(/<header class="page-head">[\s\S]*<section class="stat-grid"/.test(adminJs),
        'the heading and stats must be separate regions');
    });

    it('does not invent statistics beyond the truthful counts', () => {
      const metrics = ['statObjects', 'statImages', 'statOthers', 'statWhitelisted', 'statBlacklisted'];
      for (const key of metrics) assert.ok(adminJs.includes(key), `${key} should be rendered`);
      assert.ok(!/<canvas|chart/i.test(adminJs), 'no decorative charts');
    });
  });

  describe('object browser', () => {
    it('gives each view mode its own layout rules', () => {
      for (const selector of ['.obj-grid', '.obj-list', '.obj-waterfall']) {
        assert.ok(adminCss.includes(selector + ' {'), `${selector} needs explicit rules`);
      }
    });

    it('aligns list header and body on one column template', () => {
      const row = adminCss.match(/^\.obj-row\s*\{[^}]*\}/m)[0];
      assert.ok(row.includes('display: grid'));
      assert.ok(row.includes('grid-template-columns'));
      // The head row reuses .obj-row, so the columns cannot drift apart.
      assert.ok(adminJs.includes('class="obj-row head"'));
    });

    it('keeps filenames from overflowing or colliding with controls', () => {
      const name = adminCss.match(/^\.obj-name\s*\{[^}]*\}/m)[0];
      assert.ok(name.includes('text-overflow: ellipsis'));
      assert.ok(name.includes('overflow: hidden'));
      const meta = adminCss.match(/^\.obj-meta\s*\{[^}]*\}/m)[0];
      assert.ok(meta.includes('display: grid'), 'metadata and actions need separate tracks');
      assert.ok(meta.includes('minmax(0, 1fr) auto'));
    });

    it('gives masonry tiles a static caption instead of an overlay', () => {
      assert.ok(adminJs.includes('class="wf-caption"'), 'masonry tiles need a caption row');
      assert.ok(!adminJs.includes('wf-overlay'), 'the hover overlay should be gone');
      const caption = adminCss.match(/^\.wf-caption\s*\{[^}]*\}/m)[0];
      assert.ok(caption.includes('display: grid'));
    });

    it('keeps selection controls reachable on touch devices', () => {
      assert.ok(/@media \(hover: none\)\s*\{[^}]*\.card-select\s*\{\s*opacity:\s*1/.test(adminCss),
        'checkboxes must be visible where hover does not exist');
    });

    it('marks the active view mode', () => {
      assert.ok(adminJs.includes('aria-pressed="${state.layout === \'grid\'}"'));
      assert.ok(/\.segmented button\[aria-pressed="true"\]/.test(appCss),
        'the active segment needs a selected style');
    });
  });

  describe('states', () => {
    it('keeps skeletons dimensionally close to the real cards', () => {
      assert.ok(adminJs.includes('skeleton-media'), 'skeletons should mirror the media box');
      const media = adminCss.match(/\.skeleton-media\s*\{[^}]*\}/)[0];
      const thumb = adminCss.match(/^\.obj-thumb\s*\{[^}]*\}/m)[0];
      const ratio = /aspect-ratio:\s*([^;]+);/.exec(media)[1].trim();
      const thumbRatio = /aspect-ratio:\s*([^;]+);/.exec(thumb)[1].trim();
      assert.strictEqual(ratio, thumbRatio, 'skeleton and card media must share an aspect ratio');
    });

    it('reserves room for the load-more control so the page does not jump', () => {
      const row = adminCss.match(/\.load-more-row\s*\{[^}]*\}/)[0];
      assert.ok(/min-height/.test(row), 'the load-more row needs a stable height');
    });

    it('keeps empty and error states in normal flow', () => {
      const surface = adminCss.match(/\.state-surface\s*\{[^}]*\}/)[0];
      assert.ok(!/position:\s*(absolute|fixed)/.test(surface));
      assert.ok(/min-height/.test(surface), 'states need a stable minimum height');
    });
  });

  describe('overlays and dialogs', () => {
    it('keeps dialogs inside the viewport', () => {
      const dialog = appCss.match(/^\.dialog\s*\{[^}]*\}/m)[0];
      assert.ok(/max-height/.test(dialog));
      assert.ok(/width:\s*min\(/.test(dialog), 'dialog width must be viewport-aware');
    });

    it('makes sheets full-width on small screens', () => {
      assert.ok(/@media \(max-width: 600px\)[\s\S]*?\.sheet\s*\{\s*width:\s*100vw/.test(appCss));
    });

    it('wraps long metadata and URLs safely', () => {
      const dd = adminCss.match(/\.detail-dl dd\s*\{[^}]*\}/)[0];
      assert.ok(dd.includes('overflow-wrap: anywhere'));
      const raw = adminCss.match(/\.detail-raw\s*\{[^}]*\}/)[0];
      assert.ok(raw.includes('overflow-wrap: anywhere'));
      assert.ok(raw.includes('white-space: pre-wrap'));
    });

    it('positions menus from measured geometry rather than a guessed height', () => {
      assert.ok(adminJs.includes('menu.offsetHeight'), 'menu placement must measure the menu');
      assert.ok(!adminJs.includes('top + 300 > window.innerHeight'), 'the hardcoded guess should be gone');
    });
  });

  describe('behaviour preserved', () => {
    it('still exposes every management action', () => {
      const required = [
        'copyUrl', 'copyMarkdown', 'copyBbcode', 'copyHtml', 'download', 'rename',
        'whitelist', 'blacklist', 'deleteObject', 'toggleLike',
      ];
      for (const key of required) {
        assert.ok(adminJs.includes(`t('${key}')`), `${key} must still be offered`);
      }
    });

    it('defines every function the command palette references', () => {
      // bulkDelete was referenced by the palette and the bulk bar but never
      // defined, which threw while building the command list.
      const referenced = ['bulkCopy', 'bulkDelete', 'bulkModerate', 'bulkDownload', 'checkBroken', 'logout'];
      for (const name of referenced) {
        const defined = new RegExp(`(async )?function ${name}\\b|const ${name}\\s*=`).test(adminJs);
        assert.ok(defined, `${name} is referenced but never defined`);
      }
    });

    it('binds the detail sheet template to a defined object', () => {
      const body = adminJs.slice(adminJs.indexOf('function openDetail('), adminJs.indexOf('function closeDetail('));
      assert.ok(/const o = state\.objects\.find/.test(body),
        'openDetail must bind the object the template reads');
    });
  });

  describe('localization', () => {
    const keysFor = (lang) => {
      const start = i18nJs.indexOf(`  ${lang}: {`);
      assert.ok(start > -1, `${lang} block must exist`);
      const rest = i18nJs.slice(start);
      const end = rest.indexOf('\n  },');
      return new Set([...rest.slice(0, end).matchAll(/^\s{4}([A-Za-z0-9_]+):/gm)].map(m => m[1]));
    };

    it('translates every admin string into both languages', () => {
      const en = keysFor('en');
      const id = keysFor('id');
      const missing = [...en].filter(k => !id.has(k));
      assert.deepStrictEqual(missing, [], `Indonesian is missing: ${missing.join(', ')}`);
    });

    it('provides the keys the redesigned shell renders', () => {
      const en = keysFor('en');
      const id = keysFor('id');
      for (const key of ['navSectionLibrary', 'closeNav', 'viewModeGroup', 'detailShare', 'detailProperties',
        'subtitleAllFiles', 'subtitleImages', 'subtitleWhitelist', 'subtitleBlacklist']) {
        assert.ok(en.has(key), `en is missing ${key}`);
        assert.ok(id.has(key), `id is missing ${key}`);
      }
    });

    it('keeps the admin surfaces free of Chinese strings', () => {
      const cjk = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
      for (const [name, source] of [
        ['admin.html', adminHtml], ['login.html', loginHtml],
        ['js/admin.js', adminJs], ['js/i18n.js', i18nJs],
        ['css/admin.css', adminCss], ['css/app.css', appCss],
      ]) {
        assert.ok(!cjk.test(source), `${name} should not contain Chinese text`);
      }
    });

    it('does not hard-code widths that only fit English labels', () => {
      // Text-bearing blocks must be sized by content/tokens, never by a pixel
      // width tuned to short English strings. Fixed-size icon boxes are fine.
      const textBlocks = ['.nav-item .nav-label', '.nav-item .nav-count', '.stat-card', '.stat-card .stat-label', '.page-head h1'];
      for (const selector of textBlocks) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rule = adminCss.match(new RegExp(`^${escaped}\\s*\\{[^}]*\\}`, 'm'));
        if (!rule) continue;
        assert.ok(!/(?<!max-|min-)width:\s*\d+px/.test(rule[0]),
          `${selector} must not use a fixed pixel width`);
      }
      // The sidebar itself is a single token, so translations resize one value.
      const shell = adminCss.match(/\.console\s*\{[^}]*\}/)[0];
      assert.ok(shell.includes('var(--console-sidebar-w)'),
        'the sidebar track must come from a token');
    });
  });

  describe('public workspace is not regressed', () => {
    it('leaves the workspace shell tokens in place', () => {
      for (const token of ['--sidebar-w', '--rail-w', '--header-h', '--status-h', '--bottom-nav-h']) {
        assert.ok(appCss.includes(token + ':'), `${token} must remain defined`);
      }
      assert.ok(/\.shell\s*\{[\s\S]*grid-template-columns:\s*var\(--sidebar-w\)/.test(workspaceCss),
        'the workspace shell must still use --sidebar-w');
    });

    it('keeps the shared primitives the workspace relies on', () => {
      for (const selector of ['.btn', '.icon-btn', '.chip', '.card', '.field-control', '.segmented', '.sr-only']) {
        assert.ok(appCss.includes(selector), `${selector} must remain in the shared layer`);
      }
    });
  });
});
