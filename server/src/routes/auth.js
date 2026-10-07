import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { createSession, destroySession, revokeAllSessions } from '../lib/session.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { toPublicUser } from '../lib/serialize.js';
import { HttpError, validate } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { loginLimiter, signupLimiter, passwordResetLimiter, changePasswordLimiter } from '../middleware/rateLimit.js';
import { signupSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema } from '../validation/auth.js';
import { emails } from '../services/email/index.js';
import { env, settings } from '../config/env.js';
import { isStaff } from '../lib/constants.js';

export const MSG_EMAIL_TAKEN = 'This Email is already registered';
export const MSG_EMAIL_UNKNOWN = "This Email isn't registered";
export const MSG_WRONG_PASSWORD = 'Password is wrong';
export const MSG_EMAIL_BLOCKED = 'This email has been blocked. Please contact STAR PRODUCTION.';

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

/** Creates a fresh one-time verification link and emails it. Older unused links stop working. */
async function sendVerification(user) {
  const token = generateToken();
  await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) } });
  // Wait (briefly) for the send, so sign-up can tell the client when the email could not go out.
  const sent = await Promise.race([
    emails.verifyEmail(user, `${env.APP_URL}/verify.html?token=${encodeURIComponent(token)}`),
    new Promise((resolve) => setTimeout(() => resolve(null), 9000)), // slow provider: carry on, it may still arrive
  ]);
  return sent !== false;
}

const router = Router();

router.post('/signup', signupLimiter, async (req, res) => {
  const data = validate(signupSchema, req.body);

  // Check the database for an existing account before creating a new one.
  const existing = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true, status: true } });
  if (existing?.status === 'BLOCKED') {
    throw new HttpError(403, MSG_EMAIL_BLOCKED, { code: 'EMAIL_BLOCKED', fields: { email: MSG_EMAIL_BLOCKED } });
  }
  if (existing) {
    throw new HttpError(409, MSG_EMAIL_TAKEN, { code: 'EMAIL_TAKEN', fields: { email: MSG_EMAIL_TAKEN } });
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        mobile: data.mobile,
        passwordHash: await hashPassword(data.password),
        role: 'CLIENT', // always — a role sent by the browser is ignored (the schema doesn't even read it)
        status: 'ACTIVE',
      },
    });
  } catch (err) {
    // Unique constraint — two simultaneous signups with the same email.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, MSG_EMAIL_TAKEN, { code: 'EMAIL_TAKEN', fields: { email: MSG_EMAIL_TAKEN } });
    }
    throw err;
  }

  if (!settings.requireEmailVerification) {
    // No way to email a link (or verification switched off): the account is usable straight away.
    const verified = await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await createSession(req, res, verified.id);
    return res.status(201).json({ user: toPublicUser(verified) });
  }

  // Flow: sign up → verification email → click the link → only then can they log in. No session until then.
  const emailSent = await sendVerification(user); // goes to the address they signed up with
  res.status(201).json({ user: toPublicUser(user), needsVerification: true, emailSent });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = validate(loginSchema, req.body);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new HttpError(404, MSG_EMAIL_UNKNOWN, { code: 'EMAIL_NOT_REGISTERED', fields: { email: MSG_EMAIL_UNKNOWN } });
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw new HttpError(401, MSG_WRONG_PASSWORD, { code: 'WRONG_PASSWORD', fields: { password: MSG_WRONG_PASSWORD } });
  }
  if (user.status === 'BLOCKED') {
    throw new HttpError(403, 'This account has been blocked. Please contact STAR PRODUCTION.', { code: 'ACCOUNT_BLOCKED' });
  }
  // Only after the password is right (so the address isn't revealed to guessers): unverified clients can't enter yet.
  if (settings.requireEmailVerification && user.role === 'CLIENT' && !user.emailVerifiedAt) {
    throw new HttpError(403, 'Please verify your email address first. We sent a link to your inbox — open it, then log in.', { code: 'EMAIL_NOT_VERIFIED' });
  }

  await createSession(req, res, user.id);
  res.json({ user: toPublicUser(user) });
});

router.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

/**
 * A signed-in client (or admin) changes their own password by entering the current one correctly.
 * Other devices are signed out, the client gets a security email, and the admin is informed
 * (a notice in the admin's Messages + an email).
 */
router.post('/change-password', requireAuth, changePasswordLimiter, async (req, res) => {
  const { currentPassword, newPassword } = validate(changePasswordSchema, req.body);
  if (!(await verifyPassword(req.user.passwordHash, currentPassword))) {
    throw new HttpError(400, 'Current password is wrong', { code: 'WRONG_PASSWORD', fields: { currentPassword: 'Current password is wrong' } });
  }
  if (currentPassword === newPassword) {
    throw new HttpError(400, 'Choose a password different from your current one', { code: 'VALIDATION_ERROR', fields: { newPassword: 'Choose a password different from your current one' } });
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await hashPassword(newPassword) } }),
    prisma.session.deleteMany({ where: { userId: req.user.id, id: { not: req.session.id } } }), // sign out every other device
    // Clients: tell the admin in Messages. (Staff changing their own password need no notice to themselves.)
    ...(isStaff(req.user.role) ? [] : [prisma.chatMessage.create({
      data: { userId: req.user.id, name: req.user.name, email: req.user.email.toLowerCase(), sender: 'SYSTEM', message: 'Changed their account password.' },
    })]),
  ]);
  emails.passwordChanged(req.user);
  res.json({ ok: true, message: isStaff(req.user.role) ? 'Your password has been changed.' : 'Your password has been changed. Our team has been informed.' });
});

/** The link in the verification email. Works without being logged in (the token is the proof). */
router.post('/verify-email', passwordResetLimiter, async (req, res) => {
  const { token } = validate(z.object({ token: z.string().min(10).max(200) }), req.body);
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!record || record.expiresAt.getTime() < Date.now() || (record.usedAt && !record.user.emailVerifiedAt)) {
    throw new HttpError(400, 'This verification link is invalid or has expired.', { code: 'VERIFY_TOKEN_INVALID' });
  }
  if (!record.user.emailVerifiedAt) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
      prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
  }
  res.json({ ok: true, email: record.user.email });
});

/**
 * "Resend verification email" for someone who isn't logged in (the link expired, or the email got lost).
 * Always the same answer, so it can't be used to find out which addresses have accounts; at most one new link a minute.
 */
router.post('/resend-verification-public', passwordResetLimiter, async (req, res) => {
  const { email } = validate(forgotPasswordSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.role === 'CLIENT' && user.status === 'ACTIVE' && !user.emailVerifiedAt) {
    const latest = await prisma.emailVerificationToken.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
    if (!latest || Date.now() - latest.createdAt.getTime() > 60_000) await sendVerification(user);
  }
  res.json({ ok: true, message: 'If this address has an account that is waiting for verification, we have sent it a new link.' });
});
router.post('/resend-verification', requireAuth, passwordResetLimiter, async (req, res) => {
  if (req.user.emailVerifiedAt) return res.json({ ok: true, alreadyVerified: true });
  const sent = await sendVerification(req.user);
  if (!sent) throw new HttpError(502, 'We couldn’t send the email right now. Please try again in a moment, or contact STAR PRODUCTION.', { code: 'EMAIL_FAILED' });
  res.json({ ok: true, message: `We sent a new verification link to ${req.user.email}.` });
});
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  const { email } = validate(forgotPasswordSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email } });

  // Admin accounts are never reset by email: the admin address could belong to anyone's mailbox.
  // (Staff have no reset-by-email; they change their password in the admin panel with the current one.)
  if (user && user.status !== 'BLOCKED' && !isStaff(user.role)) {
    const token = generateToken();
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    emails.passwordReset(user, `${env.APP_URL}/?reset_token=${encodeURIComponent(token)}`);
  }

  // Same response either way.
  res.json({ ok: true, message: 'If an account exists for this email, a reset link is on its way.' });
});

router.post('/reset-password', passwordResetLimiter, async (req, res) => {
  const { token, password } = validate(resetPasswordSchema, req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.', {
      code: 'RESET_TOKEN_INVALID',
    });
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(password) } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  await revokeAllSessions(record.userId); // sign out everywhere after a password change
  res.json({ ok: true, message: 'Your password has been reset. You can now log in.' });
});

export default router;
