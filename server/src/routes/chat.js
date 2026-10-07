import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError, validate } from '../lib/errors.js';
import { findSession, SESSION_COOKIE } from '../lib/session.js';
import { createRequire } from 'node:module';
import { chatLimiter, chatHandoffLimiter } from '../middleware/rateLimit.js';
import { email } from '../validation/auth.js';
import { requireAuth } from '../middleware/auth.js';

// The FAQ list and matcher live in data/chat/faq.js — the browser loads the very same file.
const { answerMessage, FAQS, POPULAR_FAQ_IDS } = createRequire(import.meta.url)('../../../data/chat/faq.js');

const router = Router();

const text = z
  .string({ required_error: 'Please type a message' })
  .trim()
  .min(1, 'Please type a message')
  .max(1000, 'Please keep your message under 1000 characters');

const messageSchema = z.object({ message: text });
const handoffSchema = z.object({
  message: text,
  email: email.optional(), // not needed when the visitor is logged in
  name: z.string().trim().max(100).optional(),
});

/** The logged-in user, if any. Chat is open to guests, so a bad/missing session is simply "no user". */
async function optionalUser(req) {
  try {
    const found = await findSession(req.cookies?.[SESSION_COOKIE]);
    return found?.user ?? null;
  } catch {
    return null;
  }
}

/** Saves the visitor's question for the admin's Messages tab (one row per message, grouped per client by email). */
function saveForAdmin({ message, user, guestEmail, guestName }) {
  return prisma.chatMessage.create({
    data: {
      userId: user?.id ?? null,
      name: user?.name ?? guestName ?? '',
      email: (user?.email ?? guestEmail).toLowerCase(),
      message,
    },
  });
}

router.get('/faqs', (req, res) => {
  const popular = POPULAR_FAQ_IDS.map((id) => FAQS.find((f) => f.id === id)).map((f) => ({ id: f.id, question: f.q }));
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ popular });
});

router.post('/message', chatLimiter, async (req, res) => {
  const { message } = validate(messageSchema, req.body);
  const result = answerMessage(message);

  if (result.type === 'greeting' || result.type === 'thanks') return res.json({ type: result.type, answer: result.answer });
  if (result.type === 'faq') return res.json({ type: 'faq', ...result.faq, related: result.related });
  if (result.type === 'clarify') return res.json({ type: 'clarify' });

  // Not covered by the FAQs → straight to the admin panel.
  const user = await optionalUser(req);
  if (!user) return res.json({ type: 'need_email' }); // the visitor must tell us where to reply
  await saveForAdmin({ message, user });
  res.json({ type: 'sent' });
});

/** Sends a question to the admin panel (unanswered question, or an FAQ answer that didn't help). */
router.post('/handoff', chatHandoffLimiter, async (req, res) => {
  const data = validate(handoffSchema, req.body);
  const user = await optionalUser(req);
  if (!user && !data.email) {
    throw new HttpError(400, 'Please enter your email so the team can reply.', { code: 'VALIDATION_ERROR', fields: { email: 'Email is required' } });
  }
  await saveForAdmin({ message: data.message, user, guestEmail: data.email, guestName: data.name });
  res.json({ ok: true });
});

// ── Client inbox (logged-in clients): the conversation with the team, shown on the dashboard ──
// (account notices — sender SYSTEM — are for the admin only)
const inboxWhere = (user) => ({ OR: [{ userId: user.id }, { email: user.email.toLowerCase() }], sender: { not: 'SYSTEM' } });

router.get('/inbox', requireAuth, async (req, res) => {
  const rows = await prisma.chatMessage.findMany({ where: inboxWhere(req.user), orderBy: { createdAt: 'asc' }, take: 200 });
  const messages = rows.map((m) => ({ id: m.id, from: m.sender === 'ADMIN' ? 'team' : 'me', message: m.message, isNew: m.sender === 'ADMIN' && m.status === 'NEW', createdAt: m.createdAt }));
  res.json({ messages, unread: messages.filter((m) => m.isNew).length });
});

/** Opening the inbox marks the team's replies as read. */
router.post('/inbox/read', requireAuth, async (req, res) => {
  await prisma.chatMessage.updateMany({ where: { ...inboxWhere(req.user), sender: 'ADMIN', status: 'NEW' }, data: { status: 'READ' } });
  res.json({ ok: true });
});

router.post('/inbox', requireAuth, chatHandoffLimiter, async (req, res) => {
  const { message } = validate(messageSchema, req.body);
  await saveForAdmin({ message, user: req.user });
  res.json({ ok: true });
});

export default router;
