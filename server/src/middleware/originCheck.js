import { allowedOrigins } from '../config/env.js';
import { HttpError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CORS for the allow-listed origins only (the site itself, plus e.g. VS Code Live Server in dev).
 * Credentials (the session cookie) are only ever shared with these origins.
 */
export function cors(req, res, next) {
  const origin = req.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Max-Age': '600',
    });
    res.vary('Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

/**
 * CSRF defence (in addition to SameSite=Lax cookies): state-changing requests coming from a
 * browser must originate from an allowed origin. Requests without Origin/Referer are not from a
 * browser page and therefore cannot carry a CSRF attack.
 */
export function originCheck(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  let source = origin;
  if (!source && referer) {
    try {
      source = new URL(referer).origin;
    } catch {
      source = 'invalid';
    }
  }
  if (source && !allowedOrigins.has(source)) {
    throw new HttpError(403, 'Request blocked for security reasons.', { code: 'BAD_ORIGIN' });
  }
  next();
}
