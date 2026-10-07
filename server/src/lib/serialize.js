// Every object sent to the browser goes through one of these functions.
// They whitelist fields, so password hashes and session tokens never leak.
import { isActiveOrder, isPaymentIncomplete } from './constants.js';
import { publicDiscount } from './discounts.js';

export function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerifiedAt != null, // the client clicked the link in the verification email
    createdAt: user.createdAt,
  };
}

function parseFeatures(features) {
  try {
    const list = JSON.parse(features);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function toPublicPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    originalPrice: plan.originalPrice,
    unit: 'song',
    description: plan.description,
    features: parseFeatures(plan.features),
    finalOutput: plan.finalOutput,
    isFeatured: plan.isFeatured,
  };
}

export function toPublicPayment(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    method: 'UPI QR',
    gateway: payment.gateway,
    reference: payment.reference ?? null, // the UTR / transaction id the client typed (optional)
    amount: payment.amount,
    status: payment.status, // CREATED | PENDING (sent, waiting for the admin) | SUCCESS | FAILED (rejected)
    note: payment.note, // the admin's reason when a payment was rejected
    hasProof: payment.submittedAt != null,
    submittedAt: payment.submittedAt ?? null,
    reviewedAt: payment.reviewedAt ?? null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

export const OPEN_UPGRADE_STATUSES = ['CREATED', 'PENDING', 'FAILED']; // not finished, not cancelled

/** A second QR payment for moving a paid plan up to a higher one. Plan names are resolved by the page from the plan list. */
export function toPublicUpgrade(up) {
  if (!up) return null;
  return {
    id: up.id,
    orderId: up.orderId,
    fromPlanId: up.fromPlanId,
    toPlanId: up.toPlanId,
    amount: up.amount, // the difference to pay (₹)
    status: up.status, // CREATED (not paid yet) | PENDING (screenshot sent) | SUCCESS | FAILED (rejected) | CANCELLED
    note: up.note,
    reference: up.reference ?? null,
    hasProof: up.submittedAt != null,
    submittedAt: up.submittedAt ?? null,
    reviewedAt: up.reviewedAt ?? null,
    createdAt: up.createdAt,
    updatedAt: up.updatedAt,
  };
}

export function toPublicOrder(order) {
  const payment = order.payment ?? null;
  const openUpgrade = (order.upgrades ?? []).find((u) => OPEN_UPGRADE_STATUSES.includes(u.status)) ?? null;
  return {
    id: order.id,
    plan: order.plan ? { id: order.plan.id, name: order.plan.name } : { id: order.planId },
    amount: order.amount,
    discount: publicDiscount(order), // null, or { percent, code, kind, listPrice, saved }
    status: order.status,
    stage: order.stage,
    workState: order.workState,
    paymentStatus: payment?.status ?? 'UNPAID', // UNPAID = no payment requested/started yet
    paymentIncomplete: isPaymentIncomplete(order),
    active: isActiveOrder(order),
    payment: toPublicPayment(payment),
    upgrade: toPublicUpgrade(openUpgrade), // an upgrade in progress (needs paying / being verified / rejected), if any
    paidAt: order.status === 'PAID' && payment ? payment.updatedAt : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

// ── Admin views (all clients' data, still no secrets) ────────
const clientRef = (u) => (u ? { id: u.id, name: u.name, email: u.email, mobile: u.mobile } : null);

export function toAdminUser(user) {
  return {
    ...toPublicUser(user),
    updatedAt: user.updatedAt,
    orderCount: user._count?.orders ?? user.orders?.length ?? 0,
  };
}

export function toAdminOrder(order) {
  return { ...toPublicOrder(order), client: clientRef(order.user) };
}

export function toAdminPayment(payment) {
  return {
    ...toPublicPayment(payment),
    kind: 'PLAN',
    screenshotUrl: payment.submittedAt ? `/api/admin/payments/${payment.id}/screenshot` : null,
    order: payment.order
      ? {
          id: payment.order.id,
          status: payment.order.status,
          amount: payment.order.amount,
          plan: payment.order.plan?.name,
          client: clientRef(payment.order.user),
        }
      : null,
  };
}

/** An upgrade payment shown in the admin's payment list (plans = id → plan row, to name the plans). */
export function toAdminUpgrade(up, plans) {
  const name = (id) => plans.get(id)?.name ?? id;
  return {
    ...toPublicUpgrade(up),
    kind: 'UPGRADE',
    method: 'UPI QR',
    screenshotUrl: up.submittedAt ? `/api/admin/upgrades/${up.id}/screenshot` : null,
    order: up.order
      ? { id: up.order.id, status: up.order.status, amount: up.order.amount, plan: `Upgrade: ${name(up.fromPlanId)} → ${name(up.toPlanId)}`, client: clientRef(up.order.user) }
      : null,
  };
}
