const assert = require('assert');
const { boot, teardown, click, fire, tick } = require('./dom-harness');

describe('focused GUI login (DOM)', function () {
  this.timeout(8000);
  let ctx;

  afterEach(function () {
    teardown();
    ctx = null;
  });

  async function start(options = {}) {
    ctx = await boot({ page: 'login.html', module: 'js/login.js', ...options });
    await tick(20);
    return ctx;
  }

  it('validates required credentials without a native authentication challenge', async function () {
    await start();
    fire(ctx.$('login-form'), 'submit');
    await tick(15);
    assert.strictEqual(ctx.calls.length, 0);
    assert.strictEqual(ctx.$('login-error').hidden, false);
    assert.match(ctx.$('login-error-text').textContent, /username and password/i);
  });

  it('posts credentials to the existing login endpoint and shows an inline 401 error', async function () {
    await start({
      routes: {
        '/api/manage/login': () => ({ status: 401, body: { ok: false, error: 'invalid_credentials' } }),
      },
    });
    ctx.$('username').value = 'admin';
    ctx.$('password').value = 'wrong';
    fire(ctx.$('login-form'), 'submit');
    await tick(35);
    assert.strictEqual(ctx.calls.length, 1);
    assert.strictEqual(ctx.calls[0].url, '/api/manage/login');
    assert.strictEqual(ctx.calls[0].method, 'POST');
    assert.deepStrictEqual(ctx.calls[0].body, { user: 'admin', password: 'wrong' });
    assert.strictEqual(ctx.$('login-error').hidden, false);
    assert.match(ctx.$('login-error-text').textContent, /incorrect/i);
    assert.strictEqual(ctx.$('submit-btn').disabled, false);
  });

  it('reveals and hides the password with an accessible toggle', async function () {
    await start();
    assert.strictEqual(ctx.$('password').type, 'password');
    click(ctx.$('toggle-pass'));
    assert.strictEqual(ctx.$('password').type, 'text');
    assert.strictEqual(ctx.$('toggle-pass').getAttribute('aria-pressed'), 'true');
    click(ctx.$('toggle-pass'));
    assert.strictEqual(ctx.$('password').type, 'password');
    assert.strictEqual(ctx.$('toggle-pass').getAttribute('aria-pressed'), 'false');
  });

  it('shares persisted theme and natural Indonesian with the other surfaces', async function () {
    await start({ language: 'id', prefs: { theme: 'dark', layout: 'list' } });
    assert.strictEqual(ctx.doc.documentElement.lang, 'id');
    assert.strictEqual(ctx.doc.documentElement.dataset.theme, 'dark');
    assert.match(ctx.$('submit-label').textContent, /Masuk/);
    click(ctx.$('theme-btn'));
    const prefs = JSON.parse(ctx.win.localStorage.getItem('ti.prefs'));
    assert.strictEqual(prefs.theme, 'light');
    assert.strictEqual(prefs.layout, 'list');
  });
});
