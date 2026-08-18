import { isEmptyBinding } from './http.js';

// Lightweight stateless session support for the admin GUI.
//
// The session is an HMAC-signed token carried in an HttpOnly cookie. It only
// proves that the holder supplied the configured BASIC_USER/BASIC_PASS at
// login; it is not a new account system. The signing secret is taken from
// SESSION_SECRET when provided, otherwise derived deterministically from the
// basic-auth credentials so existing deployments keep working without any new
// environment variable.

export const SESSION_COOKIE = 'ti_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const encoder = new TextEncoder();

function b64url(bytes) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  let str = '';
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function deriveSecret(env) {
  if (!isEmptyBinding(env.SESSION_SECRET)) return String(env.SESSION_SECRET);
  // Fallback: derive a stable secret from the configured credentials so no new
  // env var is strictly required. Operators should set SESSION_SECRET so that
  // rotating the password does not invalidate existing sessions unexpectedly.
  const material = `ti-session:${env.BASIC_USER || ''}:${env.BASIC_PASS || ''}`;
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(material));
  return b64url(digest);
}

async function getKey(env) {
  const secret = await deriveSecret(env);
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export function credentialsMatch(env, user, pass) {
  if (isEmptyBinding(env.BASIC_USER)) return true; // auth disabled
  const expectedUser = String(env.BASIC_USER);
  const expectedPass = String(env.BASIC_PASS);
  return timingSafeEqual(user, expectedUser) && timingSafeEqual(pass, expectedPass);
}

export function authConfigured(env) {
  return !isEmptyBinding(env.BASIC_USER);
}

export async function createSession(env, user) {
  const payload = {
    u: user || 'admin',
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const key = await getKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(env, token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const key = await getKey(env);
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sig),
      encoder.encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return { user: payload.u, expiresAt: payload.exp };
  } catch (_) {
    return null;
  }
}

export function readSessionCookie(request) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (name === SESSION_COOKIE) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function isSecureRequest(request) {
  const url = new URL(request.url);
  if (url.protocol === 'https:') return true;
  // Cloudflare terminates TLS at the edge; respect the forwarded protocol.
  const forwarded = request.headers.get('X-Forwarded-Proto');
  return forwarded === 'https';
}

export function sessionCookie(request, token, { maxAge = SESSION_TTL_MS / 1000 } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(request)) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(request) {
  return sessionCookie(request, '', { maxAge: 0 });
}

/**
 * Returns a session payload when the request is authenticated, either via the
 * session cookie or a proactively supplied Basic Authorization header. The
 * Basic header is still accepted so scripts/curl keep working, but no
 * WWW-Authenticate challenge is issued by the caller, which prevents the
 * browser's native credential dialog from appearing.
 */
export async function authenticateRequest(request, env) {
  const cookieToken = readSessionCookie(request);
  if (cookieToken) {
    const session = await verifySession(env, cookieToken);
    if (session) return session;
  }

  const auth = request.headers.get('Authorization') || '';
  if (auth) {
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
      try {
        const decoded = new TextDecoder().decode(
          Uint8Array.from(atob(encoded), c => c.charCodeAt(0)),
        ).normalize();
        const idx = decoded.indexOf(':');
        if (idx >= 0) {
          const user = decoded.slice(0, idx);
          const pass = decoded.slice(idx + 1);
          if (credentialsMatch(env, user, pass)) {
            return { user, basic: true };
          }
        }
      } catch (_) { /* malformed */ }
    }
  }
  return null;
}
