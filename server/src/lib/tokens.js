import crypto from 'node:crypto';
import { env } from '../config/env.js';

/** A random, URL-safe token for the client. Only its hash is stored in the database. */
export function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Keyed hash (HMAC with SESSION_SECRET) so a leaked database alone cannot be used to forge tokens. */
export function hashToken(token) {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
