import { jsonResponse } from "../../../utils/http.js";
import {
  authConfigured,
  authenticateRequest,
} from "../../../utils/session.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (!authConfigured(env)) {
    return jsonResponse({ authenticated: true, authEnabled: false, user: null }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const identity = await authenticateRequest(request, env);
  if (identity) {
    return jsonResponse({
      authenticated: true,
      authEnabled: true,
      user: identity.user,
      method: identity.basic ? 'basic' : 'session',
      expiresAt: identity.expiresAt || null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return jsonResponse({ authenticated: false, authEnabled: true }, {
    status: 401,
    headers: { 'Cache-Control': 'no-store' },
  });
}
