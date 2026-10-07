import { SESSION_COOKIE, findSession, touchSession } from '../lib/session.js';
import { HttpError } from '../lib/errors.js';
import { isStaff } from '../lib/constants.js';

/**
 * Real server-side authentication: the session cookie is looked up in the database on every
 * request and the user is loaded fresh, so role/blocked changes apply immediately.
 */
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    throw new HttpError(401, 'Please log in to continue.', { code: 'UNAUTHENTICATED' });
  }
  const found = await findSession(token);
  if (!found || found.expired) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    throw new HttpError(401, 'Your session has expired. Please log in again.', { code: 'SESSION_EXPIRED' });
  }
  if (found.user.status === 'BLOCKED') {
    throw new HttpError(403, 'This account has been blocked. Please contact STAR PRODUCTION.', {
      code: 'ACCOUNT_BLOCKED',
    });
  }
  await touchSession(res, found.session, token);
  req.user = found.user;
  req.session = found.session;
  next();
}

/** Any staff account (main admin or payments admin). The role is read from the database-loaded user — never from anything the client sends. */
export function requireStaff(req, res, next) {
  if (!req.user) throw new HttpError(401, 'Please log in to continue.', { code: 'UNAUTHENTICATED' });
  if (!isStaff(req.user.role)) throw new HttpError(403, 'You do not have access to this area.', { code: 'FORBIDDEN' });
  next();
}

/** Only the listed staff roles, e.g. requireRole('PAYMENTS') for confirming payments. */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) throw new HttpError(401, 'Please log in to continue.', { code: 'UNAUTHENTICATED' });
  if (!roles.includes(req.user.role)) {
    throw new HttpError(403, req.user.role === 'ADMIN' && roles.includes('PAYMENTS')
      ? 'Payments are confirmed by the payments admin.'
      : 'You do not have access to this action.', { code: 'FORBIDDEN' });
  }
  next();
};