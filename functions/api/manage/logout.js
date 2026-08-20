import { jsonResponse } from "../../utils/http.js";
import { clearSessionCookie } from "../../utils/session.js";

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (request.method !== 'POST') {
    // Legacy browser navigation to /api/manage/logout: clear the cookie and
    // send the user to the GUI login.
    return new Response(null, {
      status: 302,
      headers: {
        Location: url.origin + '/login',
        'Set-Cookie': clearSessionCookie(request),
      },
    });
  }

  return jsonResponse({ ok: true }, {
    headers: {
      'Set-Cookie': clearSessionCookie(request),
      'Cache-Control': 'no-store',
    },
  });
}
