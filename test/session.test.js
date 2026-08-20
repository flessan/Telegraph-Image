const assert = require('assert');
const { makeContext, muteConsole } = require('./helpers');

const env = { BASIC_USER: 'admin', BASIC_PASS: 'secret' };

describe('session authentication', function () {
  let restoreConsole;
  beforeEach(function () { restoreConsole = muteConsole(); });
  afterEach(function () { restoreConsole(); });

  it('creates and verifies an HMAC session token', async function () {
    const s = await import('../functions/utils/session.js');
    const token = await s.createSession(env, 'admin');
    const verified = await s.verifySession(env, token);
    assert.ok(verified);
    assert.strictEqual(verified.user, 'admin');
    assert.ok(verified.expiresAt > Date.now());
  });

  it('rejects tampered or malformed tokens', async function () {
    const s = await import('../functions/utils/session.js');
    const token = await s.createSession(env, 'admin');
    const [body, sig] = token.split('.');
    assert.strictEqual(await s.verifySession(env, token + 'x'), null);
    assert.strictEqual(await s.verifySession(env, body + '.aaaa'), null);
    assert.strictEqual(await s.verifySession(env, 'garbage'), null);
    assert.strictEqual(await s.verifySession(env, null), null);
  });

  it('validates credentials with a constant-time comparison', function () {
    return import('../functions/utils/session.js').then(s => {
      assert.strictEqual(s.credentialsMatch(env, 'admin', 'secret'), true);
      assert.strictEqual(s.credentialsMatch(env, 'admin', 'wrong'), false);
      assert.strictEqual(s.credentialsMatch(env, '', ''), false);
      // Auth disabled -> any/no credentials accepted.
      assert.strictEqual(s.credentialsMatch({}, '', ''), true);
    });
  });

  it('issues an HttpOnly session cookie on POST login', async function () {
    const { onRequest } = await import('../functions/api/manage/login.js');
    const request = new Request('http://localhost:8080/api/manage/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'admin', password: 'secret' }),
    });
    const res = await onRequest(makeContext({ request, env }));
    assert.strictEqual(res.status, 200);
    const cookie = res.headers.get('Set-Cookie');
    assert.ok(cookie.includes('ti_session='));
    assert.ok(cookie.includes('HttpOnly'));
    assert.ok(cookie.includes('SameSite=Lax'));
    assert.ok(!cookie.includes('Secure'), 'Secure must be omitted over http for local dev');
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.ok, true);
  });

  it('marks the cookie Secure when the request is forwarded over https', async function () {
    const { onRequest } = await import('../functions/api/manage/login.js');
    const request = new Request('https://example.com/api/manage/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ user: 'admin', password: 'secret' }),
    });
    const res = await onRequest(makeContext({ request, env }));
    assert.ok(res.headers.get('Set-Cookie').includes('Secure'));
  });

  it('redirects legacy GET login navigation to the canonical GUI route', async function () {
    const { onRequest } = await import('../functions/api/manage/login.js');
    const request = new Request('https://example.com/api/manage/login');
    const res = await onRequest(makeContext({ request, env }));
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('Location'), 'https://example.com/login');
    assert.strictEqual(res.headers.get('WWW-Authenticate'), null);
  });

  it('rejects invalid login credentials with 401', async function () {
    const { onRequest } = await import('../functions/api/manage/login.js');
    const request = new Request('https://example.com/api/manage/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'admin', password: 'nope' }),
    });
    const res = await onRequest(makeContext({ request, env }));
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.headers.get('Set-Cookie'), null);
    assert.deepStrictEqual(JSON.parse(await res.text()), { ok: false, error: 'invalid_credentials' });
  });

  it('reports authenticated=true for a valid session cookie', async function () {
    const s = await import('../functions/utils/session.js');
    const { onRequest } = await import('../functions/api/manage/session/index.js');
    const token = await s.createSession(env, 'admin');
    const request = new Request('https://example.com/api/manage/session', {
      headers: { Cookie: `ti_session=${token}` },
    });
    const res = await onRequest(makeContext({ request, env }));
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.strictEqual(body.authenticated, true);
    assert.strictEqual(body.user, 'admin');
  });

  it('reports authenticated=false without a session', async function () {
    const { onRequest } = await import('../functions/api/manage/session/index.js');
    const request = new Request('https://example.com/api/manage/session');
    const res = await onRequest(makeContext({ request, env }));
    assert.strictEqual(res.status, 401);
    assert.strictEqual(JSON.parse(await res.text()).authenticated, false);
  });

  it('clears legacy GET logout and redirects to the canonical GUI login', async function () {
    const { onRequest } = await import('../functions/api/manage/logout.js');
    const request = new Request('https://example.com/api/manage/logout');
    const res = await onRequest(makeContext({ request, env }));
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('Location'), 'https://example.com/login');
    assert.ok(res.headers.get('Set-Cookie').includes('Max-Age=0'));
  });

  it('clears the session cookie on POST logout', async function () {
    const { onRequest } = await import('../functions/api/manage/logout.js');
    const request = new Request('https://example.com/api/manage/logout', { method: 'POST' });
    const res = await onRequest(makeContext({ request, env }));
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('Set-Cookie').includes('ti_session=;'));
    assert.ok(res.headers.get('Set-Cookie').includes('Max-Age=0'));
  });

  it('authenticates a request with a valid session cookie through authenticateRequest', async function () {
    const s = await import('../functions/utils/session.js');
    const token = await s.createSession(env, 'admin');
    const request = new Request('https://example.com/api/manage/list', {
      headers: { Cookie: `ti_session=${token}` },
    });
    const identity = await s.authenticateRequest(request, env);
    assert.strictEqual(identity.user, 'admin');
  });
});
