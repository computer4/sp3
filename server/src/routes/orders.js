import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError, validate } from '../lib/errors.js';
import { toPublicOrder, toPublicUpgrade, OPEN_UPGRADE_STATUSES } from '../lib/serialize.js';
import { CLOSED_ORDER_STATUSES, isActiveOrder, stageIndex } from '../lib/constants.js';
import { parseProofImage } from '../lib/proof.js';
import { requireAuth } from '../middleware/auth.js';
import { emails } from '../services/email/index.js';
import { settings } from '../config/env.js';
import { resolveDiscount, ensureReferralCode, priceAfter, NEW_STAR_CODE, NEW_STAR_PERCENT, REFERRAL_PERCENT } from '../lib/discounts.js';

const router = Router();
router.use(requireAuth);

// Only `planId` is read from the body. Any amount, price, user id, stage or status sent by the browser is ignored.
const applySchema = z.object({ planId: z.string().trim().min(1, 'Choose a plan').max(50), code: z.string().max(40).optional() });

const fullInclude = { plan: true, payment: true, upgrades: { orderBy: { createdAt: 'desc' } } };

/**
 * Take a plan = apply. Creates the project at stage "Applied" (work state "Review"). No payment yet —
 * the client pays once STAR PRODUCTION moves the project to "Payment Pending".
 */
router.post('/', async (req, res) => {
  const { planId, code } = validate(applySchema, req.body);

  const plan = await prisma.plan.findFirst({ where: { id: planId, active: true } });
  if (!plan) throw new HttpError(404, 'This plan is no longer available.', { code: 'PLAN_NOT_FOUND' });

  const current = await prisma.order.findFirst({
    where: { userId: req.user.id, stage: { not: 'COMPLETED' }, status: { notIn: CLOSED_ORDER_STATUSES } },
    include: { plan: true },
  });
  if (current) {
    throw new HttpError(409, `You already have an active plan (${current.plan.name}). You can take a new plan once it is completed.`, {
      code: 'ACTIVE_PLAN_EXISTS',
    });
  }

  // A discount code (NEW-STAR / a friend's referral code) or an earned reward. The price is worked out here, never taken from the browser.
  const discount = await resolveDiscount(prisma, req.user, code);
  const amount = discount ? priceAfter(plan.price, discount.percent) : plan.price;
  const order = await prisma.$transaction(async (tx) => {
    if (discount?.kind === 'REWARD') {
      const used = await tx.user.updateMany({ where: { id: req.user.id, rewardCredits: { gt: 0 } }, data: { rewardCredits: { decrement: 1 } } });
      if (used.count !== 1) throw new HttpError(409, 'Your reward was already used.', { code: 'REWARD_USED' });
    }
    return tx.order.create({
      data: {
        userId: req.user.id, planId: plan.id, amount, status: 'PENDING', stage: 'APPLIED', workState: 'REVIEW',
        ...(discount ? { listPrice: plan.price, discountPercent: discount.percent, discountCode: discount.code, discountKind: discount.kind, referrerId: discount.referrerId } : {}),
      },
      include: fullInclude,
    });
  });
  res.status(201).json({ order: toPublicOrder(order) });
});

/** Live check for the checkout box: is this code valid for me, and what would the plan cost? (Nothing is saved.) */
router.post('/check-code', async (req, res) => {
  const { code, planId } = validate(z.object({ code: z.string().max(40).optional(), planId: z.string().trim().max(50).optional() }), req.body);
  const discount = await resolveDiscount(prisma, req.user, code);
  const plan = planId ? await prisma.plan.findFirst({ where: { id: planId, active: true } }) : null;
  res.json({
    discount: discount ? { percent: discount.percent, code: discount.code, kind: discount.kind, label: discount.label } : null,
    amount: plan && discount ? priceAfter(plan.price, discount.percent) : plan?.price ?? null,
  });
});

/** The client's own referral code and how their referrals are doing. */
router.get('/referral', async (req, res) => {
  const code = await ensureReferralCode(prisma, req.user);
  const [me, referred] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.user.id }, select: { rewardCredits: true } }),
    prisma.order.findMany({ where: { referrerId: req.user.id, status: { not: 'CANCELLED' } }, select: { rewardGiven: true } }),
  ]);
  res.json({
    referral: {
      code,
      percent: REFERRAL_PERCENT,
      rewardCredits: me?.rewardCredits ?? 0, // unused 10% rewards (applied automatically to the next plan)
      friends: referred.length, // friends who used the code
      earned: referred.filter((o) => o.rewardGiven).length, // of those, how many paid (= rewards earned)
    },
    newStar: { code: NEW_STAR_CODE, percent: NEW_STAR_PERCENT },
  });
});

/**
 * Change the plan.
 * • Not paid yet → the client may switch to ANY other plan until the admin sets the project to "Payment Pending"
 *   (after that the plan is locked). The price follows the plan.
 * • Already paid → upgrade only (a higher plan), before production starts: a second QR payment of the difference
 *   (same 5-minute timer + screenshot) that the admin confirms; only then does the plan change.
 */
router.post('/:id/upgrade', async (req, res) => {
  const { planId } = validate(applySchema, req.body);
  const order = await prisma.order.findFirst({ where: { id: req.params.id, userId: req.user.id }, include: fullInclude });
  if (!order) throw new HttpError(404, 'Order not found.', { code: 'ORDER_NOT_FOUND' });
  if (!isActiveOrder(order)) throw new HttpError(409, 'This plan is no longer active.', { code: 'ORDER_CLOSED' });
  const target = await prisma.plan.findFirst({ where: { id: planId, active: true } });
  if (!target) throw new HttpError(404, 'This plan is no longer available.', { code: 'PLAN_NOT_FOUND' });

  if (order.status === 'PAID') {
    if (stageIndex(order.stage) >= stageIndex('IN_PRODUCTION')) {
      throw new HttpError(409, 'Upgrades are only possible before production starts.', { code: 'UPGRADE_TOO_LATE' });
    }
    const targetAmount = priceAfter(target.price, order.discountPercent); // the order's discount carries over to the new plan
    if (targetAmount <= order.amount) throw new HttpError(400, 'Please choose a higher plan to upgrade.', { code: 'NOT_AN_UPGRADE' });
    const open = order.upgrades.find((u) => OPEN_UPGRADE_STATUSES.includes(u.status));
    if (open?.status === 'PENDING') {
      throw new HttpError(409, 'Your upgrade payment is being verified. Please wait for the confirmation.', { code: 'UPGRADE_IN_PROGRESS' });
    }
    const data = { fromPlanId: order.planId, toPlanId: target.id, amount: targetAmount - order.amount, status: 'CREATED', note: null, reference: null, submittedAt: null, reviewedAt: null };
    const upgrade = open
      ? await prisma.upgrade.update({ where: { id: open.id }, data }) // changed their mind before paying → re-priced
      : await prisma.upgrade.create({ data: { orderId: order.id, ...data } });
    return res.json({ requested: true, remaining: upgrade.amount, upgrade: toPublicUpgrade(upgrade) });
  }

  // Not paid yet: free to switch until payment is requested.
  if (stageIndex(order.stage) >= stageIndex('PAYMENT_PENDING') || order.status === 'PAYMENT_PROCESSING') {
    throw new HttpError(409, 'Your plan can’t be changed once payment has been requested.', { code: 'PLAN_LOCKED' });
  }
  if (target.id === order.planId) throw new HttpError(400, 'You are already on this plan.', { code: 'ALREADY_ON_PLAN' });
  const updated = await prisma.order.update({ where: { id: order.id }, data: { planId: target.id, amount: priceAfter(target.price, order.discountPercent), ...(order.discountPercent ? { listPrice: target.price } : {}) }, include: fullInclude });
  res.json({ applied: true, order: toPublicOrder(updated) });
});
/** Paying needs a verified email: the invoice is sent there, and the admin can trust the contact address. */
const requireVerifiedEmail = (req) => {
  if (settings.requireEmailVerification && !req.user.emailVerifiedAt) {
    throw new HttpError(403, 'Please verify your email address first — open the verification link we sent to your inbox (you can resend it from your dashboard).', { code: 'EMAIL_NOT_VERIFIED' });
  }
};

const proofSchema = z.object({
  screenshot: z.string({ required_error: 'Attach the payment screenshot' }).min(100, 'Attach the payment screenshot').max(3_000_000, 'The screenshot is too large'),
  reference: z.string().trim().max(60, 'Transaction ID is too long').optional(),
});

const ownUpgrade = async (req) => {
  const upgrade = await prisma.upgrade.findFirst({ where: { id: req.params.uid, order: { userId: req.user.id } }, include: { order: { include: { plan: true } } } });
  if (!upgrade) throw new HttpError(404, 'Upgrade not found.', { code: 'NOT_FOUND' });
  return upgrade;
};

/** One upgrade (the upgrade payment page). */
router.get('/upgrades/:uid', async (req, res) => {
  const up = await ownUpgrade(req);
  res.json({
    upgrade: toPublicUpgrade(up),
    order: { id: up.order.id, stage: up.order.stage, status: up.order.status, amount: up.order.amount, plan: { id: up.order.plan.id, name: up.order.plan.name } },
    client: { name: req.user.name, email: req.user.email, mobile: req.user.mobile },
  });
});

/** Changed their mind: drop an upgrade that hasn't been paid (or was rejected). */
router.delete('/upgrades/:uid', async (req, res) => {
  const up = await ownUpgrade(req);
  if (!['CREATED', 'FAILED'].includes(up.status)) throw new HttpError(409, 'This upgrade can no longer be cancelled.', { code: 'NOT_CANCELLABLE' });
  await prisma.upgrade.update({ where: { id: up.id }, data: { status: 'CANCELLED' } });
  res.json({ ok: true });
});

/** "I have paid" for an upgrade — screenshot (+ optional UTR), verified by the admin like the first payment. */
router.post('/upgrades/:uid/payment-proof', async (req, res) => {
  requireVerifiedEmail(req);
  const data = validate(proofSchema, req.body);
  const image = parseProofImage(data.screenshot);
  if (!image) {
    throw new HttpError(400, 'Please attach a PNG, JPG or WEBP screenshot (up to 2 MB).', { code: 'VALIDATION_ERROR', fields: { screenshot: 'Attach a PNG, JPG or WEBP screenshot (up to 2 MB)' } });
  }
  const up = await ownUpgrade(req);
  if (up.status === 'PENDING') throw new HttpError(409, 'You have already sent your payment details. We will verify them within 24 hours.', { code: 'ALREADY_SUBMITTED' });
  if (!['CREATED', 'FAILED'].includes(up.status)) throw new HttpError(409, 'This upgrade is already finished.', { code: 'UPGRADE_CLOSED' });
  if (up.order.status !== 'PAID' || !isActiveOrder(up.order)) throw new HttpError(409, 'This plan is no longer active.', { code: 'ORDER_CLOSED' });

  const updated = await prisma.upgrade.update({
    where: { id: up.id },
    data: { status: 'PENDING', reference: data.reference || null, submittedAt: new Date(), reviewedAt: null, note: null },
  });
  await prisma.upgradeProof.upsert({ where: { upgradeId: up.id }, update: { data: data.screenshot }, create: { upgradeId: up.id, data: data.screenshot } });
  const plans = await prisma.plan.findMany({ where: { id: { in: [up.fromPlanId, up.toPlanId] } } });
  const nameOf = (id) => plans.find((p) => p.id === id)?.name ?? id;
  emails.upgradeSubmitted({ user: req.user, amount: updated.amount, from: nameOf(up.fromPlanId), to: nameOf(up.toPlanId) });
  res.status(201).json({ upgrade: toPublicUpgrade(updated) });
});

router.get('/upgrades/:uid/proof', async (req, res) => {
  const up = await ownUpgrade(req);
  const proof = await prisma.upgradeProof.findUnique({ where: { upgradeId: up.id } });
  const image = parseProofImage(proof?.data);
  if (!image) throw new HttpError(404, 'No screenshot found.', { code: 'NOT_FOUND' });
  res.set({ 'Content-Type': image.mime, 'Cache-Control': 'private, max-age=60' }).send(image.bytes);
});
/**
 * "I have paid" — the client sends the payment screenshot (and optionally the UTR / transaction id).
 * Only allowed once the admin has moved the project to "Payment Pending". The order then waits as
 * "payment under verification" until the admin confirms or rejects it. Nothing here marks an order paid.
 */

router.post('/:id/payment-proof', async (req, res) => {
  requireVerifiedEmail(req);
  const data = validate(proofSchema, req.body);
  const image = parseProofImage(data.screenshot);
  if (!image) {
    throw new HttpError(400, 'Please attach a PNG, JPG or WEBP screenshot (up to 2 MB).', { code: 'VALIDATION_ERROR', fields: { screenshot: 'Attach a PNG, JPG or WEBP screenshot (up to 2 MB)' } });
  }

  const order = await prisma.order.findFirst({ where: { id: req.params.id, userId: req.user.id }, include: fullInclude });
  if (!order) throw new HttpError(404, 'Order not found.', { code: 'ORDER_NOT_FOUND' });
  if (order.status === 'PAID') throw new HttpError(409, 'This plan is already paid.', { code: 'ALREADY_PAID' });
  if (!isActiveOrder(order)) throw new HttpError(409, 'This plan is no longer active.', { code: 'ORDER_CLOSED' });
  if (order.stage !== 'PAYMENT_PENDING') {
    throw new HttpError(409, 'Payment is not requested yet. STAR PRODUCTION will ask for payment after verification.', { code: 'PAYMENT_NOT_REQUESTED' });
  }
  if (order.status === 'PAYMENT_PROCESSING') {
    throw new HttpError(409, 'You have already sent your payment details. We will verify them within 24 hours.', { code: 'ALREADY_SUBMITTED' });
  }

  const now = new Date();
  const fields = { gateway: 'upi-qr', amount: order.amount, status: 'PENDING', reference: data.reference || null, submittedAt: now, reviewedAt: null, note: null };
  const payment = await prisma.payment.upsert({ where: { orderId: order.id }, update: fields, create: { orderId: order.id, ...fields } });
  await prisma.paymentProof.upsert({ where: { paymentId: payment.id }, update: { data: data.screenshot }, create: { paymentId: payment.id, data: data.screenshot } });
  const updated = await prisma.order.update({ where: { id: order.id }, data: { status: 'PAYMENT_PROCESSING' }, include: { ...fullInclude, user: true } });

  emails.paymentSubmitted(updated);
  res.status(201).json({ order: toPublicOrder(updated) });
});

/** The client's own screenshot (shown on the payment page). */
router.get('/:id/proof', async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, userId: req.user.id }, include: { payment: { include: { proof: true } } } });
  const image = parseProofImage(order?.payment?.proof?.data);
  if (!image) throw new HttpError(404, 'No screenshot found.', { code: 'NOT_FOUND' });
  res.set({ 'Content-Type': image.mime, 'Cache-Control': 'private, max-age=60' }).send(image.bytes);
});

/** The logged-in user's own orders only (active plan + past subscriptions). */
router.get('/', async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user.id },
    include: fullInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json({ orders: orders.map(toPublicOrder) });
});

/** One order with full details (the payment page). */
router.get('/:id/status', async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, userId: req.user.id }, include: fullInclude }); // ownership enforced in the query
  if (!order) throw new HttpError(404, 'Order not found.', { code: 'ORDER_NOT_FOUND' });
  res.json({
    order: {
      ...toPublicOrder(order),
      plan: { id: order.plan.id, name: order.plan.name, price: order.plan.price, originalPrice: order.plan.originalPrice },
      client: { name: req.user.name, email: req.user.email, mobile: req.user.mobile },
    },
  });
});

export default router;
