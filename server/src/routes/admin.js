// Admin API — every route requires a logged-in user whose role in the DATABASE is ADMIN.
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError, validate } from '../lib/errors.js';
import { revokeAllSessions } from '../lib/session.js';
import { isStaff, ACCOUNT_STATUSES, CLOSED_ORDER_STATUSES, ORDER_STATUSES, STAGES, WORK_STATES, stageIndex } from '../lib/constants.js';
import { toAdminOrder, toAdminPayment, toAdminUpgrade, toAdminUser, toPublicPlan, toPublicOrder } from '../lib/serialize.js';
import { requireAuth, requireStaff, requireRole } from '../middleware/auth.js';
import { hashPassword } from '../lib/password.js';
import { password as passwordRule } from '../validation/auth.js';
import { emails } from '../services/email/index.js';
import { deliver, checkEmailSetup } from '../services/email/transport.js';
import { env, emailProvider } from '../config/env.js';
import { parseProofImage } from '../lib/proof.js';
import { priceAfter, REWARD_PERCENT } from '../lib/discounts.js';

const router = Router();
// Staff only. Main admin (ADMIN): every client detail, projects, messages — but NOT payment confirmation.
// Payments admin (PAYMENTS): payments (and confirming them), messages, the overview numbers.
router.use(requireAuth, requireStaff);
const mainOnly = requireRole('ADMIN');
const paymentsOnly = requireRole('PAYMENTS');

const orderInclude = { user: true, plan: true, payment: true };
const liveOrder = { status: { notIn: CLOSED_ORDER_STATUSES } }; // cancelled/refunded orders don't count as projects

// ── Overview counters ─────────────────────────────────────
router.get('/stats', async (req, res) => {
  const [totalClients, review, process, completed, incomplete, revenue, unreadMessages, paymentRequests, upgradeRevenue, upgradeRequests] = await Promise.all([
    prisma.user.count({ where: { role: 'CLIENT' } }),
    prisma.order.count({ where: { ...liveOrder, workState: 'REVIEW' } }),
    prisma.order.count({ where: { ...liveOrder, workState: 'PROCESS' } }),
    prisma.order.count({ where: { ...liveOrder, workState: 'COMPLETED' } }),
    prisma.order.count({
      where: { ...liveOrder, status: { not: 'PAID' }, stage: { in: STAGES.slice(stageIndex('PAYMENT_PENDING')) } },
    }),
    prisma.payment.aggregate({ where: { status: 'SUCCESS', order: { status: 'PAID' } }, _sum: { amount: true } }),
    prisma.chatMessage.count({ where: { status: 'NEW', sender: { in: ['CLIENT', 'SYSTEM'] } } }), // client messages + account notices not opened yet
    prisma.payment.count({ where: { status: 'PENDING', order: { status: 'PAYMENT_PROCESSING' } } }), // payment screenshots waiting for the admin
    prisma.upgrade.aggregate({ where: { status: 'SUCCESS' }, _sum: { amount: true } }),
    prisma.upgrade.count({ where: { status: 'PENDING' } }), // upgrade payments waiting for the admin
  ]);
  res.json({
    stats: { totalClients, inReview: review, inProcess: process, completed, paymentIncomplete: incomplete, totalRevenue: (revenue._sum.amount ?? 0) + (upgradeRevenue._sum.amount ?? 0), unreadMessages, paymentRequests: paymentRequests + upgradeRequests },
  });
});

// ── Clients ────────────────────────────────────────────────
router.get('/clients', mainOnly, async (req, res) => {
  const users = await prisma.user.findMany({
    where: { role: 'CLIENT' },
    include: { _count: { select: { orders: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ clients: users.map(toAdminUser) });
});

router.get('/clients/:id', mainOnly, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { orders: { include: { plan: true, payment: true }, orderBy: { createdAt: 'desc' } } },
  });
  if (!user) throw new HttpError(404, 'Client not found.');
  res.json({ client: { ...toAdminUser(user), orders: user.orders.map(toPublicOrder) } });
});

async function findClient(id) {
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, 'Client not found.');
  if (isStaff(target.role)) throw new HttpError(400, 'Staff accounts cannot be changed here.');
  return target;
}

/** Fallback when a client can't receive the verification email: the admin confirms the address by hand. */
router.post('/clients/:id/verify-email', mainOnly, async (req, res) => {
  const target = await findClient(req.params.id);
  const user = await prisma.user.update({ where: { id: target.id }, data: { emailVerifiedAt: target.emailVerifiedAt ?? new Date() }, include: { _count: { select: { orders: true } } } });
  res.json({ client: toAdminUser(user) });
});

/** Block / unblock. A blocked client is signed out at once and that email can't log in or sign up again. */
router.patch('/clients/:id', mainOnly, async (req, res) => {
  const { status } = validate(z.object({ status: z.enum(ACCOUNT_STATUSES) }), req.body);
  const target = await findClient(req.params.id);
  const user = await prisma.user.update({
    where: { id: target.id },
    data: { status },
    include: { _count: { select: { orders: true } } },
  });
  if (status === 'BLOCKED') await revokeAllSessions(user.id);
  res.json({ client: toAdminUser(user) });
});

/**
 * Delete a client completely: account, sessions, subscriptions (orders) and payments.
 * The email becomes free again — signing up with it starts from zero.
 */
router.delete('/clients/:id', mainOnly, async (req, res) => {
  const target = await findClient(req.params.id);
  await prisma.$transaction([
    prisma.payment.deleteMany({ where: { order: { userId: target.id } } }),
    prisma.order.deleteMany({ where: { userId: target.id } }),
    prisma.session.deleteMany({ where: { userId: target.id } }),
    prisma.chatMessage.deleteMany({ where: { userId: target.id } }),
    prisma.passwordResetToken.deleteMany({ where: { userId: target.id } }),
    prisma.user.delete({ where: { id: target.id } }),
  ]);
  res.json({ ok: true, deleted: { id: target.id, email: target.email } });
});

// ── Messages: the conversation with each client (their questions from the chat/dashboard + our replies) ──
router.get('/messages', async (req, res) => {
  const where = req.query.email ? { email: String(req.query.email).toLowerCase() } : {};
  const rows = await prisma.chatMessage.findMany({ where, orderBy: { createdAt: 'asc' }, include: { user: { select: { id: true, status: true } } } });
  const byClient = new Map();
  for (const m of rows) {
    const c = byClient.get(m.email) ?? { key: m.email, email: m.email, name: '', userId: null, accountStatus: null, total: 0, unread: 0, lastAt: null, messages: [] };
    if (m.name && m.sender !== 'ADMIN') c.name = m.name;
    if (m.user) { c.userId = m.user.id; c.accountStatus = m.user.status; }
    c.total += 1;
    if (m.sender !== 'ADMIN' && m.status === 'NEW') c.unread += 1; // unread = client messages / account notices the admin hasn't opened
    c.lastAt = m.createdAt;
    c.messages.push({ id: m.id, from: m.sender === 'ADMIN' ? 'team' : m.sender === 'SYSTEM' ? 'system' : 'client', message: m.message, status: m.status, createdAt: m.createdAt });
    byClient.set(m.email, c);
  }
  const conversations = [...byClient.values()].sort((a, b) => b.lastAt - a.lastAt);
  res.json({ conversations });
});

/** Mark one message (by id) or all of a client's messages (by email) as read / unread. */
router.post('/messages/status', async (req, res) => {
  const body = validate(
    z.object({ id: z.string().max(50).optional(), email: z.string().max(254).optional(), status: z.enum(['NEW', 'READ']) })
      .refine((d) => d.id || d.email, { message: 'Nothing to update' }),
    req.body,
  );
  const where = body.id ? { id: body.id } : { email: body.email.toLowerCase(), sender: { in: ['CLIENT', 'SYSTEM'] } };
  await prisma.chatMessage.updateMany({ where, data: { status: body.status } });
  res.json({ ok: true });
});

/** Answer a client. Registered clients see it on their dashboard; everyone also gets it by email. */
router.post('/messages/reply', async (req, res) => {
  const { email, message } = validate(
    z.object({
      email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
      message: z.string({ required_error: 'Write a reply' }).trim().min(1, 'Write a reply').max(2000, 'Please keep the reply under 2000 characters'),
    }),
    req.body,
  );
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
  const last = user ? null : await prisma.chatMessage.findFirst({ where: { email }, orderBy: { createdAt: 'desc' }, select: { name: true } });
  await prisma.$transaction([
    prisma.chatMessage.create({ data: { userId: user?.id ?? null, name: user?.name ?? last?.name ?? '', email, message, sender: 'ADMIN', status: 'NEW' } }),
    prisma.chatMessage.updateMany({ where: { email, sender: { in: ['CLIENT', 'SYSTEM'] }, status: 'NEW' }, data: { status: 'READ' } }), // answering = handled
  ]);
  emails.teamReply(email, { name: user?.name ?? last?.name, message, registered: Boolean(user) });
  res.status(201).json({ ok: true });
});

router.delete('/messages/:id', async (req, res) => {
  await prisma.chatMessage.deleteMany({ where: { id: req.params.id } });
  res.json({ ok: true });
});

/**
 * Passwords are stored as one-way hashes, so nobody (including the admin) can read a client's password.
 * What the admin can do: set a new one. It is shown once here, and the client is signed out everywhere.
 */
router.post('/clients/:id/password', mainOnly, async (req, res) => {
  const target = await findClient(req.params.id);
  const body = validate(z.object({ password: passwordRule.optional() }), req.body ?? {});
  const password = body.password ?? crypto.randomBytes(9).toString('base64url') + 'a1'; // always has a letter and a number
  await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await hashPassword(password) } });
  await revokeAllSessions(target.id);
  res.json({ password });
});
// ── Projects (orders) ─────────────────────────────────────
router.get('/orders', async (req, res) => {
  const where = {};
  if (WORK_STATES.includes(req.query.workState)) Object.assign(where, liveOrder, { workState: req.query.workState });
  if (STAGES.includes(req.query.stage)) where.stage = req.query.stage;
  if (ORDER_STATUSES.includes(req.query.status)) where.status = req.query.status;
  if (req.query.paymentIncomplete === '1') {
    Object.assign(where, liveOrder, { status: { not: 'PAID' }, stage: { in: STAGES.slice(stageIndex('PAYMENT_PENDING')) } });
  }
  const orders = await prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' } });
  res.json({ orders: orders.map(toAdminOrder) });
});

router.get('/orders/:id', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: orderInclude });
  if (!order) throw new HttpError(404, 'Order not found.');
  res.json({
    order: {
      ...toAdminOrder(order),
      plan: { id: order.plan.id, name: order.plan.name, price: order.plan.price, originalPrice: order.plan.originalPrice },
    },
  });
});

const updateOrderSchema = z
  .object({
    stage: z.enum(STAGES).optional(), // move along the project list
    workState: z.enum(WORK_STATES).optional(), // Run (PROCESS) / Complete (COMPLETED) / Back to review (REVIEW)
    status: z.enum(ORDER_STATUSES).optional(), // manual money status (backup only; payments are verified automatically)
    planId: z.string().trim().min(1).max(50).optional(), // upgrade / change the plan (the price follows the plan)
  })
  .refine((d) => d.stage || d.workState || d.status || d.planId, { message: 'Nothing to update' });

router.patch('/orders/:id', mainOnly, async (req, res) => {
  const data = validate(updateOrderSchema, req.body);
  const exists = await prisma.order.findUnique({ where: { id: req.params.id }, select: { id: true, discountPercent: true } });
  if (!exists) throw new HttpError(404, 'Order not found.');
  if (data.planId) {
    const plan = await prisma.plan.findFirst({ where: { id: data.planId, active: true } });
    if (!plan) throw new HttpError(404, 'That plan is not available.');
    data.amount = priceAfter(plan.price, exists.discountPercent); // the order is re-priced to the new plan (its discount, if any, carries over)
    if (exists.discountPercent) data.listPrice = plan.price;
  }
  const order = await prisma.order.update({ where: { id: exists.id }, data, include: orderInclude });
  res.json({ order: toAdminOrder(order) });
});

// ── Payments (manual UPI-QR: the client sends a screenshot, the admin confirms or rejects it) ──
router.get('/payments', async (req, res) => {
  const [payments, upgrades, plans] = await Promise.all([
    prisma.payment.findMany({ include: { order: { include: { user: true, plan: true } } } }),
    prisma.upgrade.findMany({ where: { submittedAt: { not: null } }, include: { order: { include: { user: true } } } }), // only upgrades the client actually paid / sent
    prisma.plan.findMany(),
  ]);
  const planMap = new Map(plans.map((p) => [p.id, p]));
  const rows = [...payments.map(toAdminPayment), ...upgrades.map((u) => toAdminUpgrade(u, planMap))];
  const when = (r) => new Date(r.submittedAt ?? r.createdAt).getTime();
  res.json({ payments: rows.sort((a, b) => when(b) - when(a)) });
});
/** The client's payment screenshot (an image, so the admin panel can show it with a plain <img>). */
router.get('/payments/:id/screenshot', async (req, res) => {
  const proof = await prisma.paymentProof.findUnique({ where: { paymentId: req.params.id } });
  const image = parseProofImage(proof?.data);
  if (!image) throw new HttpError(404, 'No screenshot found.');
  res.set({ 'Content-Type': image.mime, 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline' }).send(image.bytes);
});

const reviewInclude = { order: { include: { user: true, plan: true, payment: true } } };

/** Confirm the payment → the order is PAID and the project moves on to "Invoice Issued"; the client's dashboard updates. */
router.post('/payments/:id/approve', paymentsOnly, async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id }, include: { order: true } });
  if (!payment) throw new HttpError(404, 'Payment not found.');
  if (payment.status !== 'PENDING' || payment.order.status !== 'PAYMENT_PROCESSING') {
    throw new HttpError(409, 'This payment is not waiting for verification.', { code: 'NOT_PENDING' });
  }
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCESS', reviewedAt: new Date(), note: null } });
    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: 'PAID', ...(stageIndex(payment.order.stage) <= stageIndex('PAYMENT_PENDING') ? { stage: 'INVOICE_ISSUED' } : {}) },
    });
    // A friend's referral code was used on this order and it is now paid, so the friend who shared it earns a 10% reward (once per order).
    if (payment.order.referrerId && !payment.order.rewardGiven) {
      const referrerExists = await tx.user.count({ where: { id: payment.order.referrerId } });
      if (referrerExists) {
        await tx.user.update({ where: { id: payment.order.referrerId }, data: { rewardCredits: { increment: 1 } } });
        await tx.order.update({ where: { id: payment.orderId }, data: { rewardGiven: true } });
      }
    }
  });
  const fresh = await prisma.order.findUnique({ where: { id: payment.orderId }, include: { user: true, plan: true, payment: true } });
  emails.paymentConfirmed(fresh);
  if (payment.order.referrerId && !payment.order.rewardGiven) {
    const referrer = await prisma.user.findUnique({ where: { id: payment.order.referrerId } });
    if (referrer) emails.referralReward({ referrer, friend: fresh.user, percent: REWARD_PERCENT });
  }
  res.json({ payment: toAdminPayment({ ...fresh.payment, order: fresh }) });
});

/** Reject the payment (wrong amount, unreadable screenshot…) → the client sees the reason and can send it again. */
router.post('/payments/:id/reject', paymentsOnly, async (req, res) => {
  const { reason } = validate(z.object({ reason: z.string().trim().min(1, 'Write a short reason').max(300) }), req.body);
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id }, include: { order: true } });
  if (!payment) throw new HttpError(404, 'Payment not found.');
  if (payment.status !== 'PENDING' || payment.order.status !== 'PAYMENT_PROCESSING') {
    throw new HttpError(409, 'This payment is not waiting for verification.', { code: 'NOT_PENDING' });
  }
  await prisma.$transaction([
    prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', reviewedAt: new Date(), note: reason } }),
    prisma.order.update({ where: { id: payment.orderId }, data: { status: 'PENDING' } }),
  ]);
  const fresh = await prisma.order.findUnique({ where: { id: payment.orderId }, include: { user: true, plan: true, payment: true } });
  // Flow: payment not confirmed → order rejected, NO invoice, and the client is told why.
  emails.paymentRejected({ user: fresh.user, label: fresh.plan.name, amount: fresh.amount, reason, payUrl: `${env.APP_URL}/pay.html?order_id=${encodeURIComponent(fresh.id)}` });
  res.json({ payment: toAdminPayment({ ...fresh.payment, order: fresh }) });
});

// ── Upgrade payments (a paid plan moving to a higher one): same screenshot check as the first payment ──
router.get('/upgrades/:id/screenshot', async (req, res) => {
  const proof = await prisma.upgradeProof.findUnique({ where: { upgradeId: req.params.id } });
  const image = parseProofImage(proof?.data);
  if (!image) throw new HttpError(404, 'No screenshot found.');
  res.set({ 'Content-Type': image.mime, 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline' }).send(image.bytes);
});

const pendingUpgrade = async (id) => {
  const up = await prisma.upgrade.findUnique({ where: { id }, include: { order: { include: { user: true } } } });
  if (!up) throw new HttpError(404, 'Upgrade not found.');
  if (up.status !== 'PENDING') throw new HttpError(409, 'This payment is not waiting for verification.', { code: 'NOT_PENDING' });
  return up;
};
const upgradeRow = async (id) => {
  const [up, plans] = await Promise.all([prisma.upgrade.findUnique({ where: { id }, include: { order: { include: { user: true } } } }), prisma.plan.findMany()]);
  return toAdminUpgrade(up, new Map(plans.map((p) => [p.id, p])));
};

/** Confirm → the order switches to the higher plan (and its new price). */
router.post('/upgrades/:id/approve', paymentsOnly, async (req, res) => {
  const up = await pendingUpgrade(req.params.id);
  const target = await prisma.plan.findUnique({ where: { id: up.toPlanId } });
  const from = await prisma.plan.findUnique({ where: { id: up.fromPlanId } });
  if (!target) throw new HttpError(404, 'The upgrade plan no longer exists.');
  await prisma.$transaction([
    prisma.upgrade.update({ where: { id: up.id }, data: { status: 'SUCCESS', reviewedAt: new Date(), note: null } }),
    prisma.order.update({ where: { id: up.orderId }, data: { planId: target.id, amount: { increment: up.amount }, ...(up.order.discountPercent ? { listPrice: target.price } : {}) } }), // paid so far + the difference just paid
  ]);
  const confirmed = await prisma.upgrade.findUnique({ where: { id: up.id } });
  emails.upgradeConfirmed({ user: up.order.user, order: up.order, upgrade: confirmed, from: from?.name ?? up.fromPlanId, to: target.name, toPlan: target });
  res.json({ payment: await upgradeRow(up.id) });
});

router.post('/upgrades/:id/reject', paymentsOnly, async (req, res) => {
  const { reason } = validate(z.object({ reason: z.string().trim().min(1, 'Write a short reason').max(300) }), req.body);
  const up = await pendingUpgrade(req.params.id);
  await prisma.upgrade.update({ where: { id: up.id }, data: { status: 'FAILED', reviewedAt: new Date(), note: reason } });
  emails.paymentRejected({ user: up.order.user, label: 'your plan upgrade', amount: up.amount, reason, payUrl: `${env.APP_URL}/pay.html?upgrade_id=${encodeURIComponent(up.id)}` });
  res.json({ payment: await upgradeRow(up.id) });
});

// ── Emails: is mail leaving the server? (main admin) ──
router.get('/emails', mainOnly, async (req, res) => {
  const [logs, setup] = await Promise.all([prisma.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take: 60 }), checkEmailSetup()]);
  res.json({ provider: emailProvider, from: env.EMAIL_FROM, setup, logs });
});

/** Sends a real test message and reports exactly what happened (provider error text included). */
router.post('/emails/test', mainOnly, async (req, res) => {
  const { to } = validate(z.object({ to: z.string().trim().toLowerCase().email('Enter a valid email address').max(254) }), req.body);
  const result = await deliver({
    to,
    subject: 'Test email from STAR PRODUCTION',
    text: 'If you can read this, STAR PRODUCTION can send email. — sent from the admin panel.',
    html: '<p>If you can read this, <b>STAR PRODUCTION</b> can send email.</p><p style="color:#6b7280;font-size:13px">Sent from the admin panel.</p>',
  });
  res.json({ result });
});
// ── Plans (read-only; edit data/plans.js and run the seed) ──
router.get('/plans', async (req, res) => {
  const plans = await prisma.plan.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { orders: { where: { status: 'PAID' } } } } },
  });
  res.json({ plans: plans.map((p) => ({ ...toPublicPlan(p), active: p.active, paidOrders: p._count.orders })) });
});

export default router;
