import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { isTest } from '../config/env.js';

const message = (msg) => ({ error: { message: msg, code: 'RATE_LIMITED' } });

function limiter(options) {
  return rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    ...options,
  });
}

/** Brute-force protection on login: per IP + email. */
export const loginLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.email ?? '').toLowerCase()}`,
  message: message('Too many login attempts. Please wait a few minutes and try again.'),
});

/** Changing the password needs the old one — still, stop guessing: per IP + account. */
export const changePasswordLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${req.user?.id ?? ''}`,
  message: message('Too many attempts. Please wait a few minutes and try again.'),
});

export const signupLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: message('Too many sign-up attempts from this network. Please try again later.'),
});

export const passwordResetLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: message('Too many password reset requests. Please try again later.'),
});

export const chatLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 30,
  message: message('You\'re sending messages too fast. Please wait a moment.'),
});

/** Every hand-off is an email to the team, so keep it tight. */
export const chatHandoffLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  message: message('You\'ve sent several questions already. Please email us at starprod.in@gmail.com instead.'),
});

export const apiLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 120,
  message: message('Too many requests. Please slow down.'),
});
