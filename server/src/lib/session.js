import { prisma } from './prisma.js';
import { generateToken, hashToken } from './tokens.js';
import { isProd } from '../config/env.js';

export const SESSION_COOKIE = isProd ? '__Host-star_session' : 'star_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000; // slide the expiry at most once a day

function cookieOptions(expires) {
  return {
    httpOnly: true, // not readable from JavaScript
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    expires,
  };
}

export async function createSession(req, res, userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
      ip: req.ip ?? null,
    },
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

/** Returns { session, user } for a valid token, otherwise null. Expired sessions are removed. */
export async function findSession(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return { expired: true };
  }
  return { session, user: session.user };
}

/** Sliding expiration: active users stay signed in. */
export async function touchSession(res, session, token) {
  if (Date.now() - session.lastUsedAt.getTime() < REFRESH_AFTER_MS) return;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.update({ where: { id: session.id }, data: { expiresAt, lastUsedAt: new Date() } });
  res.cookie(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), expires: undefined });
}

export function revokeAllSessions(userId) {
  return prisma.session.deleteMany({ where: { userId } });
}
