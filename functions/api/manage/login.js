import { jsonResponse, textResponse } from "../../utils/http.js";
import {
  authConfigured,
  createSession,
  credentialsMatch,
  sessionCookie,
} from "../../utils/session.js";

async function readCredentials(request) {
  const type = request.headers.get('Content-Type') || '';
  if (type.includes('application/json')) {
    try {
      const body = await request.json();
      return { user: String(body.user || body.username || ''), pass: String(body.password || '') };
    } catch (_) {
      return { user: '', pass: '' };
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    return {
      user: String(form.get('user') || form.get('username') || ''),
      pass: String(form.get('password') || ''),
    };
  }
  return { user: '', pass: '' };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // The GUI posts credentials; browsers hitting the legacy path still get a
  // redirect to the Material login screen.
  if (request.method !== 'POST') {
    return Response.redirect(url.origin + '/login.html', 302);
  }

  if (!authConfigured(env)) {
    return jsonResponse({ ok: true, authEnabled: false, user: null }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const { user, pass } = await readCredentials(request);
  if (!credentialsMatch(env, user, pass)) {
    return jsonResponse({ ok: false, error: 'invalid_credentials' }, {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const token = await createSession(env, user);
  return jsonResponse({ ok: true, user }, {
    headers: {
      'Set-Cookie': sessionCookie(request, token),
      'Cache-Control': 'no-store',
    },
  });
}
